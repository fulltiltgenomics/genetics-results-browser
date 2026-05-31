import { defineConfig, devices } from "@playwright/test";

// headless E2E + screenshot harness for the no-GUI Cloud VM (refactor.md §8).
// full dev data flow needs three processes — genetics-results-api on :2000,
// the BFF on :5000 (npm run bff:dev), and vite on :3000 (npm run dev) — but
// specs must assert only on the app shell so they stay deterministic without live data.

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // gitignored output dir for screenshots/traces/reports
  outputDir: "./e2e/.output",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],
  use: {
    baseURL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // reuse an already-running vite dev server if present; otherwise start one.
  // data calls fail without the API+BFF, so specs assert on shell elements only.
  webServer: {
    // pin the public target via --mode dev.public so the smoke test renders
    // deterministically (AuthProvider returns children without an auth round-trip
    // only when VITE_TARGET=public) even on a clean checkout. vite reads VITE_TARGET
    // from the loaded .env file, not process.env, so a bare env var wouldn't reach
    // import.meta.env; dev.public maps to .env.dev.public which sets VITE_TARGET=public
    // plus the api/chat urls. .env.local (gitignored) is not required.
    command: "npm run dev -- --mode dev.public",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
