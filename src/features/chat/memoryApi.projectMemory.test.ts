import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { getProjectMemory, MemoryUnavailableError } from "./memoryApi";

const MEMORY_BODY = {
  enabled: true,
  digest: "Earlier: asked about APOE and lipid traits.",
  sessions: [{ id: "s1", title: "APOE and lipids", pinned: false, created_at: "2026-01-01T00:00:00Z" }],
  char_cap: 4000,
  session_cap: 20,
};

describe("getProjectMemory", () => {
  it("fetches the project's memory endpoint and maps the response", async () => {
    server.use(http.get("*/v1/projects/proj-1/memory", () => HttpResponse.json(MEMORY_BODY)));

    const memory = await getProjectMemory("proj-1");

    expect(memory).toEqual({
      enabled: true,
      digest: "Earlier: asked about APOE and lipid traits.",
      sessions: [{ id: "s1", title: "APOE and lipids", pinned: false, createdAt: "2026-01-01T00:00:00Z" }],
      charCap: 4000,
      sessionCap: 20,
    });
  });

  it("reads a missing session_cap as null rather than a number", async () => {
    const older: Partial<typeof MEMORY_BODY> = { ...MEMORY_BODY };
    delete older.session_cap;
    server.use(http.get("*/v1/projects/proj-1/memory", () => HttpResponse.json(older)));

    const memory = await getProjectMemory("proj-1");

    expect(memory.sessionCap).toBeNull();
  });

  it("maps a 404 (anonymous/service identity, or a foreign project) to MemoryUnavailableError", async () => {
    server.use(
      http.get("*/v1/projects/proj-1/memory", () =>
        HttpResponse.json({ detail: "Project not found" }, { status: 404 }),
      ),
    );

    await expect(getProjectMemory("proj-1")).rejects.toBeInstanceOf(MemoryUnavailableError);
  });

  it("throws a plain error on other failures", async () => {
    server.use(
      http.get("*/v1/projects/proj-1/memory", () => new HttpResponse(null, { status: 500 })),
    );

    await expect(getProjectMemory("proj-1")).rejects.toThrow("HTTP 500");
  });
});
