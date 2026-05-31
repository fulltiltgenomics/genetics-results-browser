import { defineConfig } from "vitest/config";

// the BFF runs under node, not jsdom, and must not pull in the frontend MSW setup;
// a dedicated config keeps it isolated from the src/** test run
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["bff/**/*.{test,spec}.ts"],
  },
});
