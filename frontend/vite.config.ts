/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies /api to the FastAPI backend so the browser only
// ever talks to one origin — that is why the backend needs no CORS config
// for local development (see epichem/api/app.py). Override the target with
// EPICHEM_API_URL if the API runs somewhere other than :8000.
const API_TARGET = process.env.EPICHEM_API_URL ?? "http://127.0.0.1:8000";

// Bind mounts don't reliably deliver inotify events on macOS and Windows, so
// the container stack sets this to fall back to polling. Left off on Linux
// and outside Docker, where polling is just wasted CPU.
const USE_POLLING = process.env.CHOKIDAR_USEPOLLING === "true";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 0.0.0.0, not localhost: inside a container, a server bound to the
    // loopback interface is unreachable from the host no matter how the port
    // is published.
    host: true,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
    },
    watch: USE_POLLING ? { usePolling: true, interval: 300 } : undefined,
  },
  test: {
    // jsdom, because the things worth testing here touch the DOM or
    // localStorage. No global test APIs: `import { test } from "vitest"` is
    // one more line and one less piece of magic.
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
