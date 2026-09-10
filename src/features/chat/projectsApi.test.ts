import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { listProjects, createProject, renameProject, deleteProject } from "./projectsApi";

const PROJECT = {
  id: "proj-1",
  name: "IBD",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  last_activity_at: "2026-01-03T00:00:00Z",
  session_count: 2,
};

describe("listProjects", () => {
  it("maps the list, camelCasing fields and defaulting a missing last_activity_at and count", async () => {
    server.use(
      http.get("*/v1/projects", () =>
        HttpResponse.json([
          PROJECT,
          { ...PROJECT, id: "proj-2", last_activity_at: null, session_count: undefined },
        ]),
      ),
    );

    const projects = await listProjects();

    expect(projects).toEqual([
      {
        id: "proj-1",
        name: "IBD",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        lastActivityAt: "2026-01-03T00:00:00Z",
        sessionCount: 2,
      },
      {
        id: "proj-2",
        name: "IBD",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        lastActivityAt: null,
        sessionCount: 0,
      },
    ]);
  });
});

describe("createProject", () => {
  it("posts the name and returns the created project", async () => {
    let body: unknown = null;
    server.use(
      http.post("*/v1/projects", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(PROJECT);
      }),
    );

    const project = await createProject("IBD");

    expect(body).toEqual({ name: "IBD" });
    expect(project.id).toBe("proj-1");
    expect(project.lastActivityAt).toBe("2026-01-03T00:00:00Z");
  });

  it("throws ProjectApiError with the server's detail on a blank name (400)", async () => {
    server.use(
      http.post("*/v1/projects", () =>
        HttpResponse.json({ detail: "project name must not be empty" }, { status: 400 }),
      ),
    );

    await expect(createProject("")).rejects.toMatchObject({
      name: "ProjectApiError",
      status: 400,
      message: "project name must not be empty",
    });
  });

  it("throws ProjectApiError with the cap message once the per-user limit is hit", async () => {
    server.use(
      http.post("*/v1/projects", () =>
        HttpResponse.json({ detail: "at most 20 projects per user" }, { status: 400 }),
      ),
    );

    await expect(createProject("One too many")).rejects.toMatchObject({
      status: 400,
      message: "at most 20 projects per user",
    });
  });

  it("falls back to a generic message when the error body isn't JSON", async () => {
    server.use(http.post("*/v1/projects", () => new HttpResponse("oops", { status: 500 })));

    await expect(createProject("IBD")).rejects.toMatchObject({
      name: "ProjectApiError",
      status: 500,
      message: "HTTP 500",
    });
  });
});

describe("renameProject", () => {
  it("puts the new name to the project's own URL and returns the updated project", async () => {
    let body: unknown = null;
    server.use(
      http.put("*/v1/projects/proj-1", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...PROJECT, name: "IBD renamed" });
      }),
    );

    const project = await renameProject("proj-1", "IBD renamed");

    expect(body).toEqual({ name: "IBD renamed" });
    expect(project.name).toBe("IBD renamed");
  });

  it("throws ProjectApiError on 404 when the project isn't the caller's", async () => {
    server.use(
      http.put("*/v1/projects/proj-1", () =>
        HttpResponse.json({ detail: "Project not found" }, { status: 404 }),
      ),
    );

    await expect(renameProject("proj-1", "x")).rejects.toMatchObject({
      status: 404,
      message: "Project not found",
    });
  });
});

describe("deleteProject", () => {
  it("defaults with_sessions to false", async () => {
    let query = "";
    server.use(
      http.delete("*/v1/projects/proj-1", ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json({ deleted: true });
      }),
    );

    await deleteProject("proj-1");

    expect(query).toBe("?with_sessions=false");
  });

  it("passes with_sessions=true through when asked to cascade", async () => {
    let query = "";
    server.use(
      http.delete("*/v1/projects/proj-1", ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json({ deleted: true });
      }),
    );

    await deleteProject("proj-1", { withSessions: true });

    expect(query).toBe("?with_sessions=true");
  });

  it("treats a 'Project not found' 404 as already-deleted rather than throwing", async () => {
    server.use(
      http.delete("*/v1/projects/proj-1", () =>
        HttpResponse.json({ detail: "Project not found" }, { status: 404 }),
      ),
    );

    await expect(deleteProject("proj-1")).resolves.toBeUndefined();
  });

  it("throws on a 404 with a different detail (e.g. the identity 404 before the DB is touched)", async () => {
    server.use(
      http.delete("*/v1/projects/proj-1", () =>
        HttpResponse.json({ detail: "No identifiable user" }, { status: 404 }),
      ),
    );

    await expect(deleteProject("proj-1")).rejects.toMatchObject({
      name: "ProjectApiError",
      status: 404,
      message: "No identifiable user",
    });
  });
});
