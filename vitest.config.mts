import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// tsconfigPaths resolves the "@/*" alias used throughout src so it works in tests too
const plugins = () => [react(), tsconfigPaths()];

// vitest's mode is "test" and there is no .env.test — the six .env files are deploy targets —
// so import.meta.env.VITE_API_URL was undefined, the axios client got an undefined baseURL,
// and requests went out as "/v1/…". The MSW handlers match "*/api/v1/…", so they all missed.
// The value mirrors .env.dev and nothing is actually fetched; only the shape matters.
//
// VITE_CHAT_URL is deliberately NOT set here. The chat features build fetch URLs from it
// directly rather than through the axios client, and their tests match the shape that
// produces, so defining it moves requests they do handle out from under their handlers.
const env = {
  VITE_API_URL: "http://localhost:5000/api",
};

const LOGIC_TESTS = "src/store/*.test.ts";

export default defineConfig({
  plugins: plugins(),
  test: {
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/test/**"],
    },
    projects: [
      {
        plugins: plugins(),
        test: {
          name: "logic",
          env,
          globals: true,
          // zustand stores and pure munging: no DOM, no MSW, and no module state one file
          // could leave behind for the next, so these skip both the jsdom environment and
          // the per-file isolation the UI tests need.
          environment: "node",
          isolate: false,
          include: [LOGIC_TESTS],
        },
      },
      {
        plugins: plugins(),
        test: {
          name: "ui",
          env,
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/test/setup.ts"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          // e2e/ specs use @playwright/test, not vitest — keep them out of `npm test`
          exclude: ["node_modules/**", "e2e/**", "bff/**", LOGIC_TESTS],
        },
      },
    ],
  },
});
