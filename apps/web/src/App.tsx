import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiAdminSetUserRole,
  apiAdminUsers,
  apiBoards,
  apiDeleteStroke,
  apiLogin,
  apiMe,
  apiRegister,
  apiStrokes,
  type AdminUser,
} from "./api";
import { drawStroke, drawStrokeBoundingBox, redrawStrokes, resizeCanvasToContainer } from "./canvas/draw";
import type { Point, StrokePayload, StrokeRecord } from "./types";
import { connectWhiteboardSocket } from "./ws";

const TOKEN_KEY = "board_token";
const ANON_KEY = "board_anon_id";

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
  const [me, setMe] = useState<{ id: string; email: string; role: "User" | "Admin" | "View-Only" } | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [boardId, setBoardId] = useState<string | null>(null);
  const [boards, setBoards] = useState<{ id: string; name: string }[]>([]);
  const [strokes, setStrokes] = useState<StrokeRecord[]>([]);
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[] | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);

  const [color, setColor] = useState("#1c2433");
  const [widthSlider, setWidthSlider] = useState(6);
  const [dashPreset, setDashPreset] = useState<DashPreset>("solid");

  const [draftPoints, setDraftPoints] = useState<Point[] | null>(null);
  const [wsStatus, setWsStatus] = useState<"idle" | "connecting" | "open" | "closed" | "error">(
    "idle",
  );
  const [wsDiag, setWsDiag] = useState<string | null>(null);
  const [mobileToolbarOpen, setMobileToolbarOpen] = useState(false);
  const [mobileActivityOpen, setMobileActivityOpen] = useState(false);

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

  const anonId = useMemo(() => {
    const existing = sessionStorage.getItem(ANON_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    sessionStorage.setItem(ANON_KEY, created);
    return created;
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
        setMe(res.user);
        setShowAuthModal(false);
        setAuthError(null);
      } catch (e) {
        setAuthError(e instanceof Error ? e.message : "Authentication failed");
      }
    },
    [authMode, email, password, persistToken],
  );

  const logout = useCallback(() => {
    persistToken(null);
    setMe(null);
    setBoardId(null);
    setStrokes([]);
    setLoadError(null);
    setAdminUsers(null);
    setAdminError(null);
  }, [persistToken]);

  useEffect(() => {
    if (!token) {
      setMe({ id: `anon:${anonId}`, email: "Guest", role: "View-Only" });
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadError(null);
      try {
        const currentUser = await apiMe(token);
        if (cancelled) return;
        setMe(currentUser);

        const remoteBoards = await apiBoards(token);
        if (cancelled) return;
        const ordered = ["Main", "Scribbles", "Doodles", "Other"] as const;
        const mapped = remoteBoards.map((b) => ({ id: b.id, name: b.name }));
        mapped.sort((a, b) => ordered.indexOf(a.name as never) - ordered.indexOf(b.name as never));
        const filtered = mapped.filter((b) => ordered.includes(b.name as never));
        setBoards(filtered);

        const first = filtered[0];
        if (!first) {
          setLoadError("No boards available");
          return;
        }
        setBoardId((prev) => prev ?? first.id);
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

  useEffect(() => {
    if (token) return;
    let cancelled = false;
    (async () => {
      try {
        setLoadError(null);
        const remoteBoards = await apiBoards(null);
        if (cancelled) return;
        const ordered = ["Main", "Scribbles", "Doodles", "Other"] as const;
        const mapped = remoteBoards.map((b) => ({ id: b.id, name: b.name }));
        mapped.sort((a, b) => ordered.indexOf(a.name as never) - ordered.indexOf(b.name as never));
        const filtered = mapped.filter((b) => ordered.includes(b.name as never));
        setBoards(filtered);
        const first = filtered[0];
        if (first) setBoardId((prev) => prev ?? first.id);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load boards");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!boardId) return;
    setSelectedStrokeId(null);
    let cancelled = false;
    (async () => {
      try {
        const remote = await apiStrokes(token, boardId);
        if (cancelled) return;
        setStrokes(remote);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Failed to load strokes");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, boardId]);

  useEffect(() => {
    if (!selectedStrokeId) return;
    if (!strokes.some((s) => s.id === selectedStrokeId)) {
      setSelectedStrokeId(null);
    }
  }, [selectedStrokeId, strokes]);

  useEffect(() => {
    if (!token || me?.role !== "Admin") {
      setAdminUsers(null);
      setAdminError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setAdminError(null);
        const users = await apiAdminUsers(token);
        if (!cancelled) setAdminUsers(users);
      } catch (e) {
        if (!cancelled) setAdminError(e instanceof Error ? e.message : "Failed to load users");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, me?.role]);

  const setUserRole = useCallback(
    async (userId: string, role: "User" | "Admin" | "View-Only") => {
      if (!token) return;
      try {
        await apiAdminSetUserRole(token, userId, role);
        setAdminUsers((prev) => (prev ? prev.map((u) => (u.id === userId ? { ...u, role } : u)) : prev));
        if (me?.id === userId) setMe((m) => (m ? { ...m, role } : m));
      } catch (e) {
        setAdminError(e instanceof Error ? e.message : "Failed to update role");
      }
    },
    [me?.id, token],
  );

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

    if (selectedStrokeId) {
      const selected = strokesRef.current.find((s) => s.id === selectedStrokeId);
      if (selected) drawStrokeBoundingBox(ctx, cssWidth, cssHeight, selected.payload);
    }
  }, [color, dashPreset, draftPoints, selectedStrokeId, widthSlider]);

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
    setMobileToolbarOpen(false);
    setMobileActivityOpen(false);
    if (!boardId) return;
    if (!token) {
      setAuthMode("login");
      setShowAuthModal(true);
      return;
    }
    if (me?.role === "View-Only") return;
    setSelectedStrokeId(null);
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
    if (!token || me?.role === "View-Only") return;
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
    if (!boardId) {
      socketRef.current = null;
      return;
    }
    const sock = connectWhiteboardSocket(
      () => sessionStorage.getItem(TOKEN_KEY),
      () => anonId,
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
        onStrokeAck: (clientStrokeId, stroke) => {
          setStrokes((prev) => {
            const idx = prev.findIndex((s) => s.id === clientStrokeId);
            if (idx === -1) {
              if (prev.some((p) => p.id === stroke.id)) return prev;
              return [...prev, stroke];
            }
            const next = prev.slice();
            next[idx] = stroke;
            return next;
          });
        },
        onDeleteStroke: (strokeId) => {
          setStrokes((prev) => prev.filter((s) => s.id !== strokeId));
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
  }, [anonId, boardId, token]);

  const flushStroke = useCallback(() => {
    if (!boardId) return;
    if (!token || me?.role === "View-Only") return;
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
      userId: me?.id ?? "local",
      payload,
      createdAt: null,
    };
    setStrokes((s) => [...s, stroke]);
    socketRef.current?.sendStroke(boardId, localId, payload);
    drawingActive.current = false;
    setDraftPoints(null);
  }, [boardId, color, dashPreset, me?.id, token, widthSlider]);

  const undoMyLastStroke = useCallback(async () => {
    if (!token || !boardId || !me || me.role === "View-Only") return;
    const mine = [...strokesRef.current]
      .filter((s) => s.boardId === boardId && s.userId === me.id && !s.id.startsWith("local:"))
      .pop();
    if (!mine) return;
    try {
      await apiDeleteStroke(token, mine.id);
      setStrokes((prev) => prev.filter((s) => s.id !== mine.id));
    } catch (e) {
      setWsDiag(e instanceof Error ? e.message : "Failed to delete stroke");
    }
  }, [boardId, me, token]);

  const deleteMyStroke = useCallback(
    async (strokeId: string) => {
      if (!token) return;
      try {
        await apiDeleteStroke(token, strokeId);
        setStrokes((prev) => prev.filter((s) => s.id !== strokeId));
      } catch (e) {
        setWsDiag(e instanceof Error ? e.message : "Failed to delete stroke");
      }
    },
    [token],
  );

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

  const authModal = showAuthModal ? (
    <div className="modalOverlay" onClick={() => setShowAuthModal(false)}>
      <div className="modalContent" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="modalClose"
          onClick={() => setShowAuthModal(false)}
          aria-label="Close"
        >
          &times;
        </button>
        <div className="authPanel" style={{ margin: 0, width: "100%" }}>
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
    </div>
  ) : null;

  return (
    <div className="appShell">
      {authModal}
      <div className={`toolbar ${mobileToolbarOpen ? "mobileOpen" : ""}`}>
        <span className={`statusPill ${wsLabel.cls}`}>{wsLabel.text}</span>
        {wsDiag ? <span className="authError">{wsDiag}</span> : null}
        <label>
          Board
          <select
            value={boardId ?? ""}
            onChange={(e) => setBoardId(e.target.value)}
            disabled={boards.length === 0}
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        {!token ? (
          <button
            type="button"
            onClick={() => {
              setAuthMode("login");
              setShowAuthModal(true);
            }}
          >
            Log In
          </button>
        ) : null}
        {me?.role === "View-Only" ? (
          <span className="viewOnlyHint">View-only</span>
        ) : (
          <>
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
            <button
              type="button"
              onClick={undoMyLastStroke}
              disabled={!me || strokesRef.current.every((s) => s.userId !== me.id)}
              title="Remove your most recent stroke"
            >
              Undo
            </button>
          </>
        )}
      </div>
      {loadError ? (
        <div className="authError" style={{ padding: "0.75rem 1rem" }}>
          {loadError}
        </div>
      ) : null}
      <div className="boardLayout">
        <div className="canvasViewport">
          <div ref={wrapRef} className="canvasWrap">
            <canvas
              ref={canvasRef}
              className={`boardCanvas ${!token || me?.role === "View-Only" ? "disabled" : ""}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>
        </div>
        {!token || me?.role === "View-Only" ? (
          <aside className={`strokePanel ${mobileActivityOpen ? "mobileOpen" : ""}`}>
            <div className="strokePanelHeader">
              <div className="strokePanelHeaderRow">
                <div className="strokePanelTitle">Account</div>
                {token ? (
                  <button type="button" className="strokePanelLogout" onClick={logout}>
                    Log out
                  </button>
                ) : (
                  <button
                    type="button"
                    className="strokePanelLogout"
                    onClick={() => {
                      setAuthMode("login");
                      setShowAuthModal(true);
                    }}
                  >
                    Login
                  </button>
                )}
              </div>
              <div className="strokePanelSub">{me ? me.email : "Loading..."} · View-only</div>
            </div>
          </aside>
        ) : (
          <aside className={`strokePanel ${mobileActivityOpen ? "mobileOpen" : ""}`}>
            <div className="strokePanelHeader">
              <div className="strokePanelHeaderRow">
                <div className="strokePanelTitle">Activity</div>
                <button type="button" className="strokePanelLogout" onClick={logout}>
                  Log out
                </button>
              </div>
              <div className="strokePanelSub">{me ? me.email : "Unknown user"} · {strokes.length}</div>
            </div>
            <div className="strokeList" role="list">
              {[...strokes].reverse().map((s) => {
                const isLocal = s.id.startsWith("local:");
                const isMine = !!me && s.userId === me.id && !isLocal;
                const canDelete = !!me && !isLocal && (isMine || me.role === "Admin");
              const created = s.createdAt ? new Date(s.createdAt) : null;
              const activityLabel =
                isMine
                  ? "You"
                  : me?.role === "Admin"
                    ? (adminUsers?.find((u) => u.id === s.userId)?.email ?? "User")
                    : "User";
                return (
                  <div
                    className={`strokeRow ${selectedStrokeId === s.id ? "selected" : ""}`}
                    role="listitem"
                    key={s.id}
                    onClick={() => setSelectedStrokeId((prev) => (prev === s.id ? null : s.id))}
                  >
                    <div className="strokeMeta">
                      <div className="strokePrimary">
                        <span className="strokeColor" style={{ background: s.payload.color }} />
                      <span className="strokeName">{activityLabel}</span>
                        {isLocal ? <span className="strokeBadge">sending</span> : null}
                      </div>
                    {me?.role === "Admin" ? (
                      <div className="strokeSecondary">{created ? created.toLocaleString() : "—"}</div>
                    ) : null}
                    </div>
                    <button
                      type="button"
                      className="strokeDelete"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMyStroke(s.id);
                      }}
                      disabled={!canDelete}
                      title={canDelete ? "Delete this stroke" : "You can only delete your own strokes"}
                    >
                    X
                    </button>
                  </div>
                );
              })}
            </div>
            {me?.role === "Admin" ? (
              <div className="adminPanel">
                <div className="adminPanelHeader">Users</div>
                {adminError ? <div className="adminError">{adminError}</div> : null}
                <div className="adminUserList" role="list">
                  {(adminUsers ?? []).map((u) => (
                    <div className="adminUserRow" role="listitem" key={u.id}>
                      <div className="adminUserMeta">
                        <div className="adminUserEmail">{u.email}</div>
                        <div className="adminUserSub">{u.id.slice(0, 8)}</div>
                      </div>
                      <select
                        className="adminRoleSelect"
                        value={u.role}
                        onChange={(e) => setUserRole(u.id, e.target.value as AdminUser["role"])}
                      >
                        <option value="User">User</option>
                        <option value="Admin">Admin</option>
                        <option value="View-Only">View-Only</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        )}
      </div>
      <div className="mobileFabContainer">
        <button
          type="button"
          className={`mobileFab ${mobileToolbarOpen ? "active" : ""}`}
          onClick={() => {
            setMobileToolbarOpen((prev) => !prev);
            setMobileActivityOpen(false);
          }}
        >
          Tools
        </button>
        <button
          type="button"
          className={`mobileFab ${mobileActivityOpen ? "active" : ""}`}
          onClick={() => {
            setMobileActivityOpen((prev) => !prev);
            setMobileToolbarOpen(false);
          }}
        >
          Activity
        </button>
      </div>
    </div>
  );
}
