import type { Project } from "./chat.types";

const apiUrl = import.meta.env.VITE_CHAT_URL;

const projectsUrl = `${apiUrl}/v1/projects`;

/** carries the HTTP status so callers can distinguish 400 (blank name, or past the per-user
 * cap) from a plain fetch failure; the server's `detail` string is the message to show. */
export class ProjectApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ProjectApiError";
    this.status = status;
  }
}

/** shared with chatHistoryApi.ts, whose project-scoped endpoints (moveSession,
 * listProjectSessions) need the same status+detail on a 404 to tell "session gone" from
 * "project gone". */
export async function toError(response: Response): Promise<ProjectApiError> {
  let detail = "";
  try {
    const data = await response.json();
    if (typeof data?.detail === "string") {
      detail = data.detail;
    }
  } catch {
    // non-JSON error body, fall back to the status
  }
  return new ProjectApiError(response.status, detail || `HTTP ${response.status}`);
}

/** the caller's own projects, most recently active first. */
export async function listProjects(): Promise<Project[]> {
  const response = await fetch(projectsUrl, { credentials: "include" });
  if (!response.ok) {
    throw await toError(response);
  }
  const data = await response.json();
  return data.map(mapProject);
}

/** 400 (ProjectApiError) on a blank name or past the per-user cap. */
export async function createProject(name: string): Promise<Project> {
  const response = await fetch(projectsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw await toError(response);
  }
  return mapProject(await response.json());
}

/** 400 (ProjectApiError) on a blank name, 404 if the project isn't the caller's. */
export async function renameProject(projectId: string, name: string): Promise<Project> {
  const response = await fetch(`${projectsUrl}/${encodeURIComponent(projectId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw await toError(response);
  }
  return mapProject(await response.json());
}

/** withSessions=true also deletes every session filed in the project; false (default) leaves
 * them, unfiled. */
export async function deleteProject(
  projectId: string,
  options: { withSessions?: boolean } = {},
): Promise<void> {
  const withSessions = options.withSessions ?? false;
  const response = await fetch(
    `${projectsUrl}/${encodeURIComponent(projectId)}?with_sessions=${withSessions}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!response.ok) {
    const error = await toError(response);
    // "Project not found" is the same 404 a re-delete of an already-gone project gets, so
    // treat it as already-deleted; any other detail (e.g. the identity 404 a non-identifiable
    // caller gets before the DB is touched) is a real failure and must throw.
    if (response.status === 404 && error.message === "Project not found") {
      return;
    }
    throw error;
  }
}

function mapProject(data: any): Project {
  return {
    id: data.id,
    name: data.name,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    lastActivityAt: data.last_activity_at ?? null,
  };
}
