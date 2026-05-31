import { setupServer } from "msw/node";
import { handlers } from "./handlers";

// node-side request interception for vitest; lifecycle is wired in src/test/setup.ts
export const server = setupServer(...handlers);
