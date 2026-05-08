import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_PROXY ?? "http://127.0.0.1:8040";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ["board.brandonbowles.com", "localhost"],
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/api/ws": {
        target: apiTarget.replace(/^http/, "ws"),
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
