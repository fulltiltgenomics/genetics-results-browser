import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import {
  createSession,
  getSession,
  listSessions,
  listProjectSessions,
  moveSession,
} from "./chatHistoryApi";
import { ProjectApiError } from "./projectsApi";

describe("createSession with a project", () => {
  it("sends project_id and maps it back from the response", async () => {
    let body: unknown = null;
    server.use(
      http.post("*/v1/chat/sessions", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          id: "sess-1",
          created_at: "2026-01-01T00:00:00Z",
          project_id: "proj-1",
        });
      }),
    );

    const session = await createSession("T2D", "proj-1");

    expect(body).toEqual({ phenotype_code: "T2D", project_id: "proj-1" });
    expect(session.projectId).toBe("proj-1");
  });

  it("omits project_id as undefined (not sent) when the session is unfiled", async () => {
    let body: unknown = null;
    server.use(
      http.post("*/v1/chat/sessions", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "sess-2", created_at: "2026-01-01T00:00:00Z" });
      }),
    );

    const session = await createSession("T2D");

    expect(Object.keys(body as object)).toEqual(["phenotype_code"]);
    expect(session.projectId).toBeNull();
  });
});

describe("listSessions", () => {
  it("maps project_id onto each session, defaulting a missing one to null", async () => {
    server.use(
      http.get("*/v1/chat/sessions", () =>
        HttpResponse.json([
          {
            id: "sess-1",
            title: "IBD notes",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            project_id: "proj-1",
          },
          {
            id: "sess-2",
            title: "Unfiled",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ]),
      ),
    );

    const sessions = await listSessions();

    expect(sessions.map((s) => s.projectId)).toEqual(["proj-1", null]);
  });
});

describe("getSession", () => {
  it("carries project_id through to the session detail", async () => {
    server.use(
      http.get("*/v1/chat/sessions/sess-1", () =>
        HttpResponse.json({
          id: "sess-1",
          title: "IBD notes",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          is_owner: true,
          shared: false,
          project_id: "proj-1",
          messages: [],
        }),
      ),
    );

    const detail = await getSession("sess-1");

    expect(detail.projectId).toBe("proj-1");
  });
});

describe("listProjectSessions", () => {
  it("fetches the project's sessions and maps them like listSessions", async () => {
    server.use(
      http.get("*/v1/projects/proj-1/sessions", () =>
        HttpResponse.json([
          {
            id: "sess-1",
            title: "IBD notes",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            project_id: "proj-1",
          },
        ]),
      ),
    );

    const sessions = await listProjectSessions("proj-1");

    expect(sessions).toHaveLength(1);
    expect(sessions[0].projectId).toBe("proj-1");
  });

  it("throws ProjectApiError on a 404 (project gone)", async () => {
    server.use(
      http.get("*/v1/projects/proj-1/sessions", () =>
        HttpResponse.json({ detail: "Project not found" }, { status: 404 }),
      ),
    );

    await expect(listProjectSessions("proj-1")).rejects.toMatchObject({
      name: "ProjectApiError",
      status: 404,
      message: "Project not found",
    });
    await expect(listProjectSessions("proj-1")).rejects.toBeInstanceOf(ProjectApiError);
  });
});

describe("moveSession", () => {
  it("puts the target project_id to the session's project endpoint", async () => {
    let body: unknown = null;
    server.use(
      http.put("*/v1/chat/sessions/sess-1/project", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "sess-1", project_id: "proj-2" });
      }),
    );

    await moveSession("sess-1", "proj-2");

    expect(body).toEqual({ project_id: "proj-2" });
  });

  it("sends project_id: null to unfile a session", async () => {
    let body: unknown = null;
    server.use(
      http.put("*/v1/chat/sessions/sess-1/project", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "sess-1", project_id: null });
      }),
    );

    await moveSession("sess-1", null);

    expect(body).toEqual({ project_id: null });
  });

  it("throws ProjectApiError on a 404 (foreign session or project)", async () => {
    server.use(
      http.put("*/v1/chat/sessions/sess-1/project", () =>
        HttpResponse.json({ detail: "Session or project not found" }, { status: 404 }),
      ),
    );

    await expect(moveSession("sess-1", "proj-9")).rejects.toMatchObject({
      name: "ProjectApiError",
      status: 404,
      message: "Session or project not found",
    });
    await expect(moveSession("sess-1", "proj-9")).rejects.toBeInstanceOf(ProjectApiError);
  });
});
