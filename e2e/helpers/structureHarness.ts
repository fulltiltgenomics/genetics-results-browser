import type { Page, Request } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The production bundle in `static/`, served by route interception under the
 * Content-Security-Policy read out of nginx.prod.conf, with the chat backend and the
 * protein-structure route mocked. No server and no port.
 */

const root = path.resolve(__dirname, "..", "..");
export const STATIC = path.join(root, "static");
export const ORIGIN = "https://anno.test";

const cspMatch = readFileSync(path.join(root, "nginx.prod.conf"), "utf8").match(/set \$csp "([^"]+)"/);
if (!cspMatch) throw new Error("nginx.prod.conf no longer sets $csp");
const CSP = cspMatch[1];

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export const fileMarker = (name: string, body: string) =>
  `[FILE:application/json:${encodeURIComponent(name)}:${Buffer.from(body).toString("base64")}]`;

const session = (id: string, content: string) => ({
  id,
  title: "structure",
  created_at: "2026-11-12T00:00:00Z",
  updated_at: "2026-11-12T00:00:00Z",
  is_owner: true,
  shared: false,
  messages: [
    { id: "m1", role: "user", content: "Show the structure.", created_at: "2026-11-12T00:00:00Z" },
    { id: "m2", role: "assistant", content, created_at: "2026-11-12T00:00:01Z" },
  ],
});

export interface Harness {
  requested: string[];
  consoleViolations: string[];
  violations: () => Promise<string[]>;
  molstarChunks: () => string[];
}

/** an `/api` answer for one request, or undefined to leave it to the harness's own routes */
export type ApiMock = (
  pathname: string,
  request: Request,
) => { status?: number; contentType: string; body: string; headers?: Record<string, string> } | undefined;

export const serve = async (
  page: Page,
  /** session id → the assistant message's content */
  sessions: Record<string, string>,
  /** model file id → PDB bytes; any other id is a 404 */
  models: Record<string, Buffer>,
  api?: ApiMock,
): Promise<Harness> => {
  if (!existsSync(path.join(STATIC, "index.html"))) {
    throw new Error("no production build in static/ — run `npx vite build --mode prod` first");
  }
  const requested: string[] = [];
  const consoleViolations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy/i.test(msg.text())) consoleViolations.push(msg.text());
  });
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener("securitypolicyviolation", (e) =>
      seen.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });

  await page.route(`${ORIGIN}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    requested.push(pathname);
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    // AuthProvider hard-redirects to /oauth2/sign_in unless both of these answer
    if (pathname === "/chat/v1/auth") {
      return json({ authenticated: true, user: "e2e@example.org", is_admin: false });
    }
    if (pathname === "/chat/v1/me") return json({ user: "e2e@example.org" });
    if (pathname === "/chat/v1/chat/sessions") return json([]);
    const detail = pathname.match(/^\/chat\/v1\/chat\/sessions\/([^/]+)$/);
    if (detail && sessions[detail[1]]) return json(session(detail[1], sessions[detail[1]]));
    // every other chat-backend call (options, tools, memory, projects) is decoration here
    if (pathname.startsWith("/chat/v1/")) return json({ detail: "not mocked" }, 404);

    const mocked = pathname.startsWith("/api/") ? api?.(pathname, route.request()) : undefined;
    if (mocked) {
      return route.fulfill({
        status: mocked.status ?? 200,
        headers: { ...mocked.headers, "content-type": mocked.contentType },
        body: mocked.body,
      });
    }
    const model = pathname.match(/^\/api\/v1\/protein_structure\/structure\/([^/]+)$/);
    if (model && models[model[1]]) {
      return route.fulfill({
        status: 200,
        headers: { "content-type": "chemical/x-pdb", "cache-control": "no-cache", etag: '"e2e"' },
        body: models[model[1]],
      });
    }
    if (pathname.startsWith("/api/")) return json({ detail: "not mocked" }, 404);

    // nginx.prod.conf: a file if there is one, else the SPA's index.html, the policy on both
    const candidate = path.join(STATIC, pathname);
    const file =
      candidate.startsWith(STATIC) && existsSync(candidate) && statSync(candidate).isFile()
        ? candidate
        : path.join(STATIC, "index.html");
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
        "content-security-policy": CSP,
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
      },
      body: readFileSync(file),
    });
  });

  return {
    requested,
    consoleViolations,
    violations: () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp),
    molstarChunks: () => requested.filter((p) => /molstarScene/.test(p)),
  };
};
