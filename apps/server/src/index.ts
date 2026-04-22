import "dotenv/config";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { randomUUID } from "crypto";
import { asc, eq } from "drizzle-orm";
import Fastify from "fastify";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { WebSocket as WsWebSocket } from "ws";
import { z } from "zod";
import {
  hashPassword,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from "./auth.js";
import { boards, strokes, users } from "./db/schema.js";
import { createDb } from "./db/index.js";
import {
  strokePayloadSchema,
  wsClientMessageSchema,
  type StrokePayload,
} from "./payload.js";

const PORT = Number(process.env.PORT ?? 3000);
const JWT_SECRET_RAW = process.env.JWT_SECRET;
const DATABASE_URL_RAW = process.env.DATABASE_URL ?? "./data/app.sqlite";

if (!JWT_SECRET_RAW || JWT_SECRET_RAW.length < 16) {
  throw new Error("JWT_SECRET must be set to a string of at least 16 characters");
}

const JWT_SECRET = JWT_SECRET_RAW;

const dbPath = DATABASE_URL_RAW.startsWith("file:")
  ? DATABASE_URL_RAW.slice("file:".length)
  : DATABASE_URL_RAW;
const resolvedDbPath = resolve(dbPath);
mkdirSync(dirname(resolvedDbPath), { recursive: true });

const db = createDb(resolvedDbPath);

function ensureBoards() {
  const desiredNames = ["Main", "Scribbles", "Doodles", "Other"] as const;

  // Back-compat with earlier scaffold name
  const legacy = db.select().from(boards).where(eq(boards.name, "Main board")).get();
  if (legacy) {
    db.update(boards).set({ name: "Main" }).where(eq(boards.id, legacy.id)).run();
  }

  const existing = db.select().from(boards).all();
  const existingNames = new Set(existing.map((b) => b.name));

  for (const name of desiredNames) {
    if (!existingNames.has(name)) {
      db.insert(boards)
        .values({
          id: randomUUID(),
          name,
          createdAt: new Date(),
        })
        .run();
    }
  }
}

ensureBoards();

function ensureAdminEmails() {
  const adminEmails = ["brandroid64@gmail.com"];
  for (const emailRaw of adminEmails) {
    const email = emailRaw.trim().toLowerCase();
    db.update(users).set({ role: "Admin" }).where(eq(users.email, email)).run();
  }
}

ensureAdminEmails();

const registerBody = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(72),
});

const loginBody = registerBody;

const roleSchema = z.enum(["User", "Admin", "View-Only"]);
type Role = z.infer<typeof roleSchema>;

type SocketMeta = { userId: string; boardId: string | null; role: Role };
const socketMeta = new WeakMap<WsWebSocket, SocketMeta>();
const boardRoom = new Map<string, Set<WsWebSocket>>();

function getRoleForUserId(userId: string): Role {
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  const role = row?.role;
  const parsed = roleSchema.safeParse(role);
  return parsed.success ? parsed.data : "User";
}

function addToRoom(boardId: string, ws: WsWebSocket) {
  let set = boardRoom.get(boardId);
  if (!set) {
    set = new Set();
    boardRoom.set(boardId, set);
  }
  set.add(ws);
}

function removeFromRoom(boardId: string, ws: WsWebSocket) {
  const set = boardRoom.get(boardId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) boardRoom.delete(boardId);
}

function removeFromAllRooms(ws: WsWebSocket) {
  const meta = socketMeta.get(ws);
  if (meta?.boardId) removeFromRoom(meta.boardId, ws);
}

function broadcastStroke(
  boardId: string,
  message: unknown,
  except?: WsWebSocket,
) {
  const set = boardRoom.get(boardId);
  if (!set) return;
  const data = JSON.stringify(message);
  for (const peer of set) {
    if (peer === except) continue;
    if (peer.readyState === WsWebSocket.OPEN) peer.send(data);
  }
}

async function requireUser(req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing bearer token" });
  }
  const token = header.slice("Bearer ".length).trim();
  try {
    const { sub } = verifyAccessToken(token, JWT_SECRET);
    req.userId = sub;
  } catch {
    return reply.code(401).send({ error: "Invalid token" });
  }
}

const fastify = Fastify({ logger: true });

await fastify.register(cors, {
  origin: true,
  credentials: true,
});

await fastify.register(websocket);

fastify.post("/api/auth/register", async (req, reply) => {
  const parsed = registerBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const email = parsed.data.email.trim().toLowerCase();
  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) {
    return reply.code(409).send({ error: "Email already registered" });
  }
  const id = randomUUID();
  const passwordHash = await hashPassword(parsed.data.password);
  db.insert(users)
    .values({ id, email, passwordHash, role: "User", createdAt: new Date() })
    .run();
  const token = signAccessToken(id, JWT_SECRET);
  return { token, user: { id, email, role: "User" as const } };
});

fastify.post("/api/auth/login", async (req, reply) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const email = parsed.data.email.trim().toLowerCase();
  const user = db.select().from(users).where(eq(users.email, email)).get();
  if (!user) {
    return reply.code(401).send({ error: "Invalid credentials" });
  }
  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    return reply.code(401).send({ error: "Invalid credentials" });
  }
  const token = signAccessToken(user.id, JWT_SECRET);
  const role = roleSchema.safeParse(user.role).success ? (user.role as Role) : ("User" as const);
  return { token, user: { id: user.id, email: user.email, role } };
});

fastify.get(
  "/api/boards",
  { preHandler: requireUser },
  async (req) => {
    const rows = db.select().from(boards).all();
    return { boards: rows };
  },
);

fastify.get("/api/me", { preHandler: requireUser }, async (req, reply) => {
  const userId = req.userId;
  if (!userId) return reply.code(401).send({ error: "Unauthorized" });
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return reply.code(401).send({ error: "Unauthorized" });
  const role = roleSchema.safeParse(user.role).success ? (user.role as Role) : ("User" as const);
  return { user: { id: user.id, email: user.email, role } };
});

fastify.get<{ Params: { boardId: string } }>(
  "/api/boards/:boardId/strokes",
  { preHandler: requireUser },
  async (req, reply) => {
    const { boardId } = req.params;
    const board = db.select().from(boards).where(eq(boards.id, boardId)).get();
    if (!board) {
      return reply.code(404).send({ error: "Board not found" });
    }
    const rows = db
      .select()
      .from(strokes)
      .where(eq(strokes.boardId, boardId))
      .orderBy(asc(strokes.createdAt))
      .all();
    const normalized = rows.map((r) => ({
      id: r.id,
      boardId: r.boardId,
      userId: r.userId,
      payload: r.payload as StrokePayload,
      createdAt: r.createdAt?.toISOString() ?? null,
    }));
    return { strokes: normalized };
  },
);

fastify.delete<{ Params: { strokeId: string } }>(
  "/api/strokes/:strokeId",
  { preHandler: requireUser },
  async (req, reply) => {
    const userId = req.userId;
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const role = getRoleForUserId(userId);

    const stroke = db.select().from(strokes).where(eq(strokes.id, req.params.strokeId)).get();
    if (!stroke) return reply.code(404).send({ error: "Stroke not found" });
    if (stroke.userId !== userId && role !== "Admin") return reply.code(403).send({ error: "Forbidden" });

    db.delete(strokes).where(eq(strokes.id, stroke.id)).run();
    broadcastStroke(stroke.boardId, { type: "deleteStroke", boardId: stroke.boardId, strokeId: stroke.id });
    return { ok: true };
  },
);

fastify.get("/ws", { websocket: true }, (socket, _req) => {
  let authed = false;

  socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
    let data: unknown;
    try {
      data = JSON.parse(String(raw));
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    const parsed = wsClientMessageSchema.safeParse(data);
    if (!parsed.success) {
      socket.send(
        JSON.stringify({
          type: "error",
          message: "Invalid message",
          details: parsed.error.flatten(),
        }),
      );
      return;
    }

    const msg = parsed.data;

    if (msg.type === "auth") {
      if (authed) {
        socket.send(JSON.stringify({ type: "error", message: "Already authenticated" }));
        return;
      }
      try {
        const { sub } = verifyAccessToken(msg.token, JWT_SECRET);
        authed = true;
        socketMeta.set(socket, { userId: sub, boardId: null, role: getRoleForUserId(sub) });
        socket.send(JSON.stringify({ type: "auth_ok" }));
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "Invalid token" }));
        socket.close();
      }
      return;
    }

    if (!authed) {
      socket.send(JSON.stringify({ type: "error", message: "Authenticate first" }));
      return;
    }

    const meta = socketMeta.get(socket);
    if (!meta) {
      socket.close();
      return;
    }

    if (msg.type === "joinBoard") {
      if (meta.boardId) removeFromRoom(meta.boardId, socket);
      const board = db.select().from(boards).where(eq(boards.id, msg.boardId)).get();
      if (!board) {
        socket.send(JSON.stringify({ type: "error", message: "Board not found" }));
        return;
      }
      meta.boardId = msg.boardId;
      addToRoom(msg.boardId, socket);
      socket.send(JSON.stringify({ type: "joinedBoard", boardId: msg.boardId }));
      return;
    }

    if (msg.type === "stroke") {
      if (!meta.boardId || meta.boardId !== msg.boardId) {
        socket.send(JSON.stringify({ type: "error", message: "Join a board first" }));
        return;
      }
      if (meta.role === "View-Only") {
        socket.send(JSON.stringify({ type: "error", message: "View-Only users cannot draw" }));
        return;
      }
      const board = db.select().from(boards).where(eq(boards.id, msg.boardId)).get();
      if (!board) {
        socket.send(JSON.stringify({ type: "error", message: "Board not found" }));
        return;
      }

      const payloadCheck = strokePayloadSchema.safeParse(msg.payload);
      if (!payloadCheck.success) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Invalid stroke payload",
            details: payloadCheck.error.flatten(),
          }),
        );
        return;
      }

      const id = randomUUID();
      const createdAt = new Date();
      db.insert(strokes)
        .values({
          id,
          boardId: msg.boardId,
          userId: meta.userId,
          payload: payloadCheck.data,
          createdAt,
        })
        .run();

      const outgoing = {
        type: "stroke" as const,
        stroke: {
          id,
          boardId: msg.boardId,
          userId: meta.userId,
          payload: payloadCheck.data,
          createdAt: createdAt.toISOString(),
        },
        clientStrokeId: msg.clientStrokeId,
      };

      broadcastStroke(msg.boardId, outgoing);
      return;
    }

    if (msg.type === "deleteStroke") {
      if (!meta.boardId || meta.boardId !== msg.boardId) {
        socket.send(JSON.stringify({ type: "error", message: "Join a board first" }));
        return;
      }
      const stroke = db.select().from(strokes).where(eq(strokes.id, msg.strokeId)).get();
      if (!stroke) {
        socket.send(JSON.stringify({ type: "error", message: "Stroke not found" }));
        return;
      }
      if (stroke.boardId !== msg.boardId) {
        socket.send(JSON.stringify({ type: "error", message: "Stroke does not belong to board" }));
        return;
      }
      if (stroke.userId !== meta.userId && meta.role !== "Admin") {
        socket.send(JSON.stringify({ type: "error", message: "Forbidden" }));
        return;
      }
      db.delete(strokes).where(eq(strokes.id, stroke.id)).run();
      broadcastStroke(stroke.boardId, { type: "deleteStroke", boardId: stroke.boardId, strokeId: stroke.id });
      return;
    }
  });

  socket.on("close", () => {
    removeFromAllRooms(socket);
    socketMeta.delete(socket);
  });
});

await fastify.listen({ port: PORT, host: "0.0.0.0" });
