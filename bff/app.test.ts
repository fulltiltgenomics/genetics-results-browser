import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

const app = createApp();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("healthz", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("passthrough", () => {
  it("forwards GET to the upstream with the path and returns its body", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ resources: ["finngen"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).get("/api/v1/resources");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ resources: ["finngen"] });
    // default upstream base is http://localhost:2000/api; the /api mount segment is stripped
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:2000/api/v1/resources");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
  });

  it("forwards POST bodies to the upstream", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await request(app)
      .post("/api/v1/credible_sets_by_variant")
      .send({ variants: ["1-1-A-G"] });

    const init = fetchMock.mock.calls[0][1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ variants: ["1-1-A-G"] });
  });

  it("returns 502 when the upstream is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }));

    const res = await request(app).get("/api/v1/resources");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("bad_gateway");
  });
});
