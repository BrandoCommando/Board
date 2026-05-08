import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_PROXY ?? "http://127.0.0.1:8040";
const shouldStripApiPrefix = process.env.VERCEL !== "1" && process.env.VERCEL !== "true";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ["board.brandonbowles.com", "localhost"],
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        rewrite: shouldStripApiPrefix ? (path) => path.replace(/^\/api/, "") : undefined,
      },
      "/api/ws": {
        target: apiTarget.replace(/^http/, "ws"),
        ws: true,
        rewrite: shouldStripApiPrefix ? (path) => path.replace(/^\/api/, "") : undefined,
      },
    },
  },
});
