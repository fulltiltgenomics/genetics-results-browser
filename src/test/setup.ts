import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// unmount rendered trees between tests to avoid cross-test leakage
afterEach(() => {
  cleanup();
});
