import type { StrokePayload, StrokeRecord } from "./types";

type ServerMessage =
  | { type: "auth_ok" }
  | { type: "joinedBoard"; boardId: string }
  | { type: "stroke"; stroke: StrokeRecord }
  | { type: "error"; message: string };

export type WhiteboardSocket = {
  joinBoard: (boardId: string) => void;
  sendStroke: (boardId: string, payload: StrokePayload) => void;
  close: () => void;
};

export function connectWhiteboardSocket(
  getToken: () => string | null,
  handlers: {
    onStatus?: (status: "connecting" | "open" | "closed" | "error") => void;
    onAuthOk?: () => void;
    onJoinedBoard?: (boardId: string) => void;
    onStroke?: (stroke: StrokeRecord) => void;
    onError?: (message: string) => void;
  },
): WhiteboardSocket {
  let ws: WebSocket | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let joinedBoardId: string | null = null;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/ws`;

  function clearTimer() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }

  function send(obj: unknown) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function connect() {
    if (stopped) return;
    handlers.onStatus?.("connecting");
    ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      handlers.onStatus?.("open");
      const token = getToken();
      if (!token) {
        handlers.onError?.("Missing token");
        ws?.close();
        return;
      }
      send({ type: "auth", token });
    });

    ws.addEventListener("message", (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        handlers.onError?.("Malformed server message");
        return;
      }
      if (msg.type === "auth_ok") {
        handlers.onAuthOk?.();
        if (joinedBoardId) {
          send({ type: "joinBoard", boardId: joinedBoardId });
        }
        return;
      }
      if (msg.type === "joinedBoard") {
        handlers.onJoinedBoard?.(msg.boardId);
        return;
      }
      if (msg.type === "stroke") {
        handlers.onStroke?.(msg.stroke);
        return;
      }
      if (msg.type === "error") {
        handlers.onError?.(msg.message);
      }
    });

    ws.addEventListener("close", () => {
      handlers.onStatus?.("closed");
      if (stopped) return;
      clearTimer();
      reconnectTimer = setTimeout(connect, 1200);
    });

    ws.addEventListener("error", () => {
      handlers.onStatus?.("error");
    });
  }

  connect();

  return {
    joinBoard(boardId: string) {
      joinedBoardId = boardId;
      send({ type: "joinBoard", boardId });
    },
    sendStroke(boardId: string, payload: StrokePayload) {
      send({ type: "stroke", boardId, payload });
    },
    close() {
      stopped = true;
      clearTimer();
      ws?.close();
      ws = null;
    },
  };
}
