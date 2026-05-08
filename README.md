# Digital whiteboard

Collaborative drawing app using Fastify + Postgres API and a Vite + React canvas client. Drawings sync in real time over WebSockets; strokes are persisted per board.

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io) 9+

## Setup

```bash
pnpm install
cp .env.example apps/server/.env
# Edit apps/server/.env:
# - set JWT_SECRET to a long random value
# - set DATABASE_URL to your Postgres connection string
```

## Development

From the repo root:

```bash
pnpm dev
```

- **Web app**: [http://localhost:5173](http://localhost:5173) (Vite)
- **API / WebSocket**: [http://localhost:3000](http://localhost:3000) (proxied from the web app as `/api` and `/api/ws`)

The server runs `drizzle-kit push` on each `pnpm dev` in `apps/server` so the Postgres schema stays in sync.

Register a user in the UI, then draw. Open a second browser window (or incognito) with another user to see live updates.

## Production build

```bash
pnpm build
```

Run the server with `NODE_ENV=production` and serve the web `dist` behind the same host, or configure CORS and WebSocket URLs accordingly.

## Scripts

| Command        | Description                          |
|----------------|--------------------------------------|
| `pnpm dev`     | Server + client in watch mode        |
| `pnpm build`   | Build server and web packages        |
| `pnpm db:push` | Apply Drizzle schema to Postgres     |
