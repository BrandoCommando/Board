import "dotenv/config";
import "./fastify-augment.js";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { randomUUID } from "crypto";
import { asc, eq } from "drizzle-orm";
import Fastify from "fastify";
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
const DATABASE_URL = process.env.DATABASE_URL;

if (!JWT_SECRET_RAW || JWT_SECRET_RAW.length < 16) {
  throw new Error("JWT_SECRET must be set to a string of at least 16 characters");
}
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const JWT_SECRET = JWT_SECRET_RAW;
const db = createDb(DATABASE_URL);

async function ensureBoards() {
  const desiredNames = ["Main", "Scribbles", "Doodles", "Other"] as const;

  // Back-compat with earlier scaffold name
  const legacyRows = await db.select().from(boards).where(eq(boards.name, "Main board")).limit(1);
  const legacy = legacyRows[0];
  if (legacy) {
    await db.update(boards).set({ name: "Main" }).where(eq(boards.id, legacy.id));
  }

  const existing = await db.select().from(boards);
  const existingNames = new Set(existing.map((b) => b.name));

  for (const name of desiredNames) {
    if (!existingNames.has(name)) {
      await db.insert(boards)
        .values({
          id: randomUUID(),
          name,
          createdAt: new Date(),
        });
    }
  }
}

await ensureBoards();

async function ensureAdminEmails() {
  const adminEmails = ["brandroid64@gmail.com"];
  for (const emailRaw of adminEmails) {
    const email = emailRaw.trim().toLowerCase();
    await db.update(users).set({ role: "Admin" }).where(eq(users.email, email));
  }
}

await ensureAdminEmails();

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

async function getRoleForUserId(userId: string): Promise<Role> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const row = rows[0];
  const role = row?.role;
  const parsed = roleSchema.safeParse(role);
  return parsed.success ? parsed.data : "User";
}

async function requireAdmin(
  req: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
) {
  const userId = req.userId;
  if (!userId) {
    reply.code(401).send({ error: "Unauthorized" });
    return;
  }
  const role = await getRoleForUserId(userId);
  if (role !== "Admin") {
    reply.code(403).send({ error: "Admin required" });
    return;
  }
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

async function requireUser(
  req: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing bearer token" });
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  try {
    const { sub } = verifyAccessToken(token, JWT_SECRET);
    req.userId = sub;
  } catch {
    reply.code(401).send({ error: "Invalid token" });
    return;
  }
}

const fastify = Fastify({ logger: true });

await fastify.register(cors, {
  origin: true,
  credentials: true,
});

await fastify.register(websocket);

fastify.post("/auth/register", async (req, reply) => {
  const parsed = registerBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const email = parsed.data.email.trim().toLowerCase();
  const existingRows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const existing = existingRows[0];
  if (existing) {
    return reply.code(409).send({ error: "Email already registered" });
  }
  const id = randomUUID();
  const passwordHash = await hashPassword(parsed.data.password);
  await db.insert(users)
    .values({ id, email, passwordHash, role: "User", createdAt: new Date() })
    ;
  const token = signAccessToken(id, JWT_SECRET);
  return { token, user: { id, email, role: "User" as const } };
});

fastify.post("/auth/login", async (req, reply) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const email = parsed.data.email.trim().toLowerCase();
  const userRows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = userRows[0];
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

fastify.get("/boards", async () => {
  const rows = await db.select().from(boards);
  return { boards: rows };
});

fastify.get("/me", { preHandler: requireUser }, async (req, reply) => {
  const userId = req.userId;
  if (!userId) return reply.code(401).send({ error: "Unauthorized" });
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) return reply.code(401).send({ error: "Unauthorized" });
  const role = roleSchema.safeParse(user.role).success ? (user.role as Role) : ("User" as const);
  return { user: { id: user.id, email: user.email, role } };
});

fastify.get<{ Params: { boardId: string } }>(
  "/boards/:boardId/strokes",
  async (req, reply) => {
    const { boardId } = req.params;
    const boardRows = await db.select().from(boards).where(eq(boards.id, boardId)).limit(1);
    const board = boardRows[0];
    if (!board) {
      return reply.code(404).send({ error: "Board not found" });
    }
    const rows = await db
      .select()
      .from(strokes)
      .where(eq(strokes.boardId, boardId))
      .orderBy(asc(strokes.createdAt));
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
  "/strokes/:strokeId",
  { preHandler: requireUser },
  async (req, reply) => {
    const userId = req.userId;
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const role = await getRoleForUserId(userId);

    const strokeRows = await db.select().from(strokes).where(eq(strokes.id, req.params.strokeId)).limit(1);
    const stroke = strokeRows[0];
    if (!stroke) return reply.code(404).send({ error: "Stroke not found" });
    if (stroke.userId !== userId && role !== "Admin") return reply.code(403).send({ error: "Forbidden" });

    await db.delete(strokes).where(eq(strokes.id, stroke.id));
    broadcastStroke(stroke.boardId, { type: "deleteStroke", boardId: stroke.boardId, strokeId: stroke.id });
    return { ok: true };
  },
);

fastify.get("/admin/users", { preHandler: [requireUser, requireAdmin] }, async () => {
  const rows = await db.select().from(users);
  const normalized = rows
    .map((u) => ({
      id: u.id,
      email: u.email,
      role: roleSchema.safeParse(u.role).success ? (u.role as Role) : ("User" as const),
      createdAt: u.createdAt?.toISOString() ?? null,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
  return { users: normalized };
});

fastify.patch<{ Params: { userId: string } }>(
  "/admin/users/:userId",
  { preHandler: [requireUser, requireAdmin] },
  async (req, reply) => {
    const bodyParsed = z.object({ role: roleSchema }).safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.code(400).send({ error: "Invalid body", details: bodyParsed.error.flatten() });
    }
    const adminId = req.userId;
    if (!adminId) return reply.code(401).send({ error: "Unauthorized" });
    if (req.params.userId === adminId && bodyParsed.data.role !== "Admin") {
      return reply.code(400).send({ error: "Cannot remove your own Admin role" });
    }
    const existingRows = await db.select().from(users).where(eq(users.id, req.params.userId)).limit(1);
    const existing = existingRows[0];
    if (!existing) return reply.code(404).send({ error: "User not found" });
    await db.update(users).set({ role: bodyParsed.data.role }).where(eq(users.id, req.params.userId));
    return { ok: true };
  },
);

fastify.get("/ws", { websocket: true }, (socket, _req) => {
  let authed = false;

  socket.on("message", async (raw: Buffer | ArrayBuffer | Buffer[]) => {
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
        socketMeta.set(socket, { userId: sub, boardId: null, role: await getRoleForUserId(sub) });
        socket.send(JSON.stringify({ type: "auth_ok" }));
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "Invalid token" }));
        socket.close();
      }
      return;
    }

    if (msg.type === "anon") {
      if (authed) {
        socket.send(JSON.stringify({ type: "error", message: "Already authenticated" }));
        return;
      }
      authed = true;
      socketMeta.set(socket, { userId: `anon:${msg.anonId}`, boardId: null, role: "View-Only" });
      socket.send(JSON.stringify({ type: "auth_ok" }));
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
      const boardRows = await db.select().from(boards).where(eq(boards.id, msg.boardId)).limit(1);
      const board = boardRows[0];
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
      const boardRows = await db.select().from(boards).where(eq(boards.id, msg.boardId)).limit(1);
      const board = boardRows[0];
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
      await db.insert(strokes)
        .values({
          id,
          boardId: msg.boardId,
          userId: meta.userId,
          payload: payloadCheck.data,
          createdAt,
        });

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
      const strokeRows = await db.select().from(strokes).where(eq(strokes.id, msg.strokeId)).limit(1);
      const stroke = strokeRows[0];
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
      await db.delete(strokes).where(eq(strokes.id, stroke.id));
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
