import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./msw/server";

// onUnhandledRequest:'error' surfaces any request that escapes the mock layer so tests stay offline
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  // unmount rendered trees between tests to avoid cross-test leakage
  cleanup();
  // drop per-test handler overrides so each test starts from the shared baseline
  server.resetHandlers();
});

afterAll(() => server.close());
