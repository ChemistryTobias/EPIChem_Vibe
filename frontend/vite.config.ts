import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Proxies /api to the backend so the browser only ever talks to one origin.
const API_TARGET = process.env.EPICHEM_API_URL ?? "http://127.0.0.1:8000";
const USE_POLLING = process.env.CHOKIDAR_USEPOLLING === "true";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
    },
    watch: USE_POLLING ? { usePolling: true, interval: 300 } : undefined,
  },
});
