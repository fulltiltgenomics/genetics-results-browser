import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

const app = createApp();

const LD_BODY = {
  ld: [{ variation1: "15:90883330:G:A", variation2: "15:90885291:CT:C", d_prime: 0.99, r2: 0.87 }],
};

const okFetch = () =>
  vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(LD_BODY), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/v1/ld", () => {
  it("proxies the query to the LD API and returns its body", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/api/v1/ld")
      .query({ variant: "15:90883330:G:A", window: 1000000, panel: "sisu42", r2_thresh: 0.05 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(LD_BODY);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://api.finngen.fi/api/ld");
    expect(url.searchParams.get("variant")).toBe("15:90883330:G:A");
    expect(url.searchParams.get("window")).toBe("1000000");
    expect(url.searchParams.get("panel")).toBe("sisu42");
    expect(url.searchParams.get("r2_thresh")).toBe("0.05");
  });

  it("is matched before the generic passthrough (never hits genetics-results-api)", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    await request(app).get("/api/v1/ld").query({ variant: "15:90883330:G:A" });

    expect(fetchMock.mock.calls[0][0]).not.toContain("localhost:2000");
  });

  it("rejects a missing variant without calling upstream", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).get("/api/v1/ld");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["window", { variant: "1:1:A:G", window: "abc" }],
    ["window over the maximum", { variant: "1:1:A:G", window: 6_000_000 }],
    ["window under the minimum", { variant: "1:1:A:G", window: 50_000 }],
    ["panel", { variant: "1:1:A:G", panel: "sisu42&variant=evil" }],
    ["r2_thresh", { variant: "1:1:A:G", r2_thresh: 2 }],
  ])("rejects an invalid %s", async (_label, query) => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).get("/api/v1/ld").query(query);

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([400, 404])("passes an upstream %i through", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status }))
    );

    const res = await request(app).get("/api/v1/ld").query({ variant: "1:1:A:G" });

    expect(res.status).toBe(status);
  });

  it("collapses other upstream failures to 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 }))
    );

    const res = await request(app).get("/api/v1/ld").query({ variant: "1:1:A:G" });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("bad_gateway");
  });

  it("returns 502 when the LD API is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<Response> => {
        throw new Error("ECONNREFUSED");
      })
    );

    const res = await request(app).get("/api/v1/ld").query({ variant: "1:1:A:G" });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("bad_gateway");
  });

  it("returns 504 when the LD API times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<Response> => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      })
    );

    const res = await request(app).get("/api/v1/ld").query({ variant: "1:1:A:G" });

    expect(res.status).toBe(504);
    expect(res.body.error).toBe("gateway_timeout");
  });
});
