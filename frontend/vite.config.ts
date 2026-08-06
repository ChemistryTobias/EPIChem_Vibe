import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies /api to the FastAPI backend so the browser only
// ever talks to one origin — that is why the backend needs no CORS config
// for local development (see epichem/api/app.py). Override the target with
// EPICHEM_API_URL if the API runs somewhere other than :8000.
const API_TARGET = process.env.EPICHEM_API_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
    },
  },
});
