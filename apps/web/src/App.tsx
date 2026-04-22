import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiBoards, apiLogin, apiRegister, apiStrokes } from "./api";
import { drawStroke, redrawStrokes, resizeCanvasToContainer } from "./canvas/draw";
import type { Point, StrokePayload, StrokeRecord } from "./types";
import { connectWhiteboardSocket } from "./ws";

const TOKEN_KEY = "board_token";

type DashPreset = "solid" | "dashed" | "dotted";

function dashArrayForPreset(preset: DashPreset): number[] {
  if (preset === "solid") return [];
  if (preset === "dashed") return [0.045, 0.028];
  return [0.012, 0.018];
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function App() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authError, setAuthError] = useState<string | null>(null);

  const [boardId, setBoardId] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<StrokeRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [color, setColor] = useState("#1c2433");
  const [widthSlider, setWidthSlider] = useState(6);
  const [dashPreset, setDashPreset] = useState<DashPreset>("solid");

  const [draftPoints, setDraftPoints] = useState<Point[] | null>(null);
  const [wsStatus, setWsStatus] = useState<"idle" | "connecting" | "open" | "closed" | "error">(
    "idle",
  );
  const [wsDiag, setWsDiag] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<ReturnType<typeof connectWhiteboardSocket> | null>(null);
  const latestDraftRef = useRef<Point[] | null>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  latestDraftRef.current = draftPoints;

  const persistToken = useCallback((t: string | null) => {
    setToken(t);
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  }, []);

  const submitAuth = useCallback(
    async (ev: React.FormEvent) => {
      ev.preventDefault();
      setAuthError(null);
      try {
        const res =
          authMode === "register"
            ? await apiRegister(email, password)
            : await apiLogin(email, password);
        persistToken(res.token);
      } catch (e) {
        setAuthError(e instanceof Error ? e.message : "Authentication failed");
      }
    },
    [authMode, email, password, persistToken],
  );

  const logout = useCallback(() => {
    persistToken(null);
    setBoardId(null);
    setStrokes([]);
    setLoadError(null);
  }, [persistToken]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoadError(null);
      try {
        const boards = await apiBoards(token);
        if (cancelled) return;
        const first = boards[0];
        if (!first) {
          setLoadError("No boards available");
          return;
        }
        setBoardId(first.id);
        const remote = await apiStrokes(token, first.id);
        if (cancelled) return;
        setStrokes(remote);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Failed to load board");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const paint = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { cssWidth, cssHeight } = resizeCanvasToContainer(canvas, wrap);
    redrawStrokes(ctx, cssWidth, cssHeight, strokesRef.current);

    if (draftPoints && draftPoints.length >= 2) {
      const minSide = Math.min(cssWidth, cssHeight);
      const payload: StrokePayload = {
        points: draftPoints,
        color,
        strokeWidthNorm: clamp(widthSlider / minSide, 0.0005, 0.2),
        lineCap: "round",
        lineJoin: "round",
        lineDash: dashArrayForPreset(dashPreset),
      };
      drawStroke(ctx, cssWidth, cssHeight, minSide, payload);
    }
  }, [color, dashPreset, draftPoints, widthSlider]);

  useEffect(() => {
    paint();
  }, [paint, strokes]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => paint());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [paint]);

  const drawingActive = useRef(false);

  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (!token || !boardId) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((ev.clientY - rect.top) / rect.height, 0, 1);
    drawingActive.current = true;
    setDraftPoints([{ x, y }]);
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingActive.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((ev.clientY - rect.top) / rect.height, 0, 1);
    setDraftPoints((prev) => {
      if (!prev || prev.length === 0) return [{ x, y }];
      const last = prev[prev.length - 1]!;
      const dx = x - last.x;
      const dy = y - last.y;
      if (dx * dx + dy * dy < 1e-8) return prev;
      return [...prev, { x, y }];
    });
  };

  useEffect(() => {
    if (!token || !boardId) {
      socketRef.current = null;
      return;
    }
    const sock = connectWhiteboardSocket(
      () => sessionStorage.getItem(TOKEN_KEY),
      {
        onStatus: (s) => {
          if (s === "connecting") setWsStatus("connecting");
          if (s === "open") setWsStatus("open");
          if (s === "closed") setWsStatus("closed");
          if (s === "error") setWsStatus("error");
        },
        onAuthOk: () => setWsDiag(null),
        onJoinedBoard: () => setWsDiag(null),
        onStroke: (stroke) => {
          setStrokes((prev) => {
            if (prev.some((p) => p.id === stroke.id)) return prev;
            return [...prev, stroke];
          });
        },
        onError: (m) => setWsDiag(m),
      },
    );
    sock.joinBoard(boardId);
    socketRef.current = sock;
    return () => {
      sock.close();
      socketRef.current = null;
    };
  }, [token, boardId]);

  const flushStroke = useCallback(() => {
    if (!boardId) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const minSide = Math.min(Math.max(1, wrap.clientWidth), Math.max(1, wrap.clientHeight));
    const prev = latestDraftRef.current;
    if (!prev || prev.length < 2) {
      drawingActive.current = false;
      setDraftPoints(null);
      return;
    }
    const payload: StrokePayload = {
      points: prev,
      color,
      strokeWidthNorm: clamp(widthSlider / minSide, 0.0005, 0.2),
      lineCap: "round",
      lineJoin: "round",
      lineDash: dashArrayForPreset(dashPreset),
    };
    const localId = `local:${crypto.randomUUID()}`;
    const stroke: StrokeRecord = {
      id: localId,
      boardId,
      userId: "local",
      payload,
      createdAt: null,
    };
    setStrokes((s) => [...s, stroke]);
    socketRef.current?.sendStroke(boardId, payload);
    drawingActive.current = false;
    setDraftPoints(null);
  }, [boardId, color, dashPreset, widthSlider]);

  const onPointerUp = () => {
    if (!drawingActive.current) return;
    flushStroke();
  };

  const wsLabel = useMemo(() => {
    if (wsStatus === "open") return { text: "Live", cls: "ok" as const };
    if (wsStatus === "connecting") return { text: "Connecting…", cls: "warn" as const };
    if (wsStatus === "error") return { text: "Socket error", cls: "err" as const };
    if (wsStatus === "closed") return { text: "Reconnecting…", cls: "warn" as const };
    return { text: "Idle", cls: "" as const };
  }, [wsStatus]);

  if (!token) {
    return (
      <div className="appShell">
        <div className="authPanel">
          <h1>Board</h1>
          <p style={{ marginTop: 0, color: "#9aa3b5", textAlign: "center", fontSize: "0.95rem" }}>
            {authMode === "register"
              ? "Create an account to join the canvas."
              : "Sign in to open the shared canvas."}
          </p>
          <div className="authTabs">
            <button
              type="button"
              className={`authTab ${authMode === "login" ? "active" : ""}`}
              onClick={() => {
                setAuthMode("login");
                setAuthError(null);
              }}
            >
              Login
            </button>
            <button
              type="button"
              className={`authTab ${authMode === "register" ? "active" : ""}`}
              onClick={() => {
                setAuthMode("register");
                setAuthError(null);
              }}
            >
              Register
            </button>
          </div>
          <form onSubmit={submitAuth}>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            {authError ? <div className="authError">{authError}</div> : null}
            <button type="submit">{authMode === "register" ? "Create account" : "Sign in"}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="appShell">
      <div className="toolbar">
        <span className={`statusPill ${wsLabel.cls}`}>{wsLabel.text}</span>
        {wsDiag ? <span className="authError">{wsDiag}</span> : null}
        <label>
          Color
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <label>
          Width
          <input
            type="range"
            min={1}
            max={40}
            value={widthSlider}
            onChange={(e) => setWidthSlider(Number(e.target.value))}
          />
          <span style={{ color: "#9aa3b5" }}>{widthSlider}px</span>
        </label>
        <fieldset className="dashFieldset">
          <legend>Dash</legend>
          <label className="radioPill">
            <input
              type="radio"
              name="dashPreset"
              value="solid"
              checked={dashPreset === "solid"}
              onChange={() => setDashPreset("solid")}
            />
            Solid
          </label>
          <label className="radioPill">
            <input
              type="radio"
              name="dashPreset"
              value="dashed"
              checked={dashPreset === "dashed"}
              onChange={() => setDashPreset("dashed")}
            />
            Dashed
          </label>
          <label className="radioPill">
            <input
              type="radio"
              name="dashPreset"
              value="dotted"
              checked={dashPreset === "dotted"}
              onChange={() => setDashPreset("dotted")}
            />
            Dotted
          </label>
        </fieldset>
        <button type="button" onClick={logout}>
          Log out
        </button>
      </div>
      {loadError ? (
        <div className="authError" style={{ padding: "0.75rem 1rem" }}>
          {loadError}
        </div>
      ) : null}
      <div ref={wrapRef} className="canvasWrap">
        <canvas
          ref={canvasRef}
          className="boardCanvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </div>
  );
}
