import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

const okFetch = () =>
  vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  );

const sentHeaders = (fetchMock: ReturnType<typeof okFetch>): Record<string, string> => {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
    out[k.toLowerCase()] = v;
  }
  return out;
};

let prevToken: string;

beforeEach(() => {
  prevToken = config.apiToken;
});

afterEach(() => {
  config.apiToken = prevToken;
  vi.restoreAllMocks();
});

describe("passthrough trusted-proxy marker", () => {
  it("attaches the internal bearer when a token is configured", async () => {
    config.apiToken = "internal-secret";
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    await request(app).get("/api/v1/resources");

    expect(sentHeaders(fetchMock)["authorization"]).toBe("Bearer internal-secret");
  });

  it("keeps forwarding the identity header alongside the bearer", async () => {
    // this is the shape genetics-results-api needs: the marker proves the hop, the header
    // names the user. dropping either one 401s every browser request.
    config.apiToken = "internal-secret";
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    await request(app)
      .get("/api/v1/credible_sets_by_region/1:1000-2000")
      .set("X-Goog-Authenticated-User-Email", "accounts.google.com:user@finngen.fi");

    const headers = sentHeaders(fetchMock);
    expect(headers["authorization"]).toBe("Bearer internal-secret");
    expect(headers["x-goog-authenticated-user-email"]).toBe(
      "accounts.google.com:user@finngen.fi"
    );
  });

  it("never overwrites a Bearer the caller already sent", async () => {
    config.apiToken = "internal-secret";
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    await request(app).get("/api/v1/resources").set("Authorization", "Bearer caller-token");

    expect(sentHeaders(fetchMock)["authorization"]).toBe("Bearer caller-token");
  });

  it("treats a lower-case bearer as a bearer, matching nginx's case-insensitive test", async () => {
    config.apiToken = "internal-secret";
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    await request(app).get("/api/v1/resources").set("Authorization", "bearer caller-token");

    expect(sentHeaders(fetchMock)["authorization"]).toBe("bearer caller-token");
  });

  it("replaces a non-Bearer Authorization with the internal bearer", async () => {
    // nginx only diverts `^Bearer ` to the raw results-api, so a Basic credential reaches this
    // hop; results-api has no Basic path, so keeping it would only cost the trusted-proxy marker.
    config.apiToken = "internal-secret";
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    await request(app).get("/api/v1/resources").set("Authorization", "Basic abc");

    expect(sentHeaders(fetchMock)["authorization"]).toBe("Bearer internal-secret");
  });

  it("does not treat a scheme without the trailing space as a bearer", async () => {
    config.apiToken = "internal-secret";
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    await request(app).get("/api/v1/resources").set("Authorization", "BearerX caller-token");

    expect(sentHeaders(fetchMock)["authorization"]).toBe("Bearer internal-secret");
  });

  it("omits the bearer entirely when no token is configured (dev)", async () => {
    config.apiToken = "";
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    await request(app).get("/api/v1/resources");

    expect(sentHeaders(fetchMock)["authorization"]).toBeUndefined();
  });
});
