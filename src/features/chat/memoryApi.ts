import type { MemorySession, MemoryState } from "./chat.types";

const apiUrl = import.meta.env.VITE_CHAT_URL;

const memoryUrl = `${apiUrl}/v1/memory`;
const projectsUrl = `${apiUrl}/v1/projects`;
const settingsUrl = `${apiUrl}/v1/llm-config/user/settings`;

export const MEMORY_ENABLED_KEY = "chat_memory";

export type { MemorySession, MemoryState };

/** thrown for a 404, which means either an older backend with no memory route, or a caller that
 * is not a real user — both render the dialog disabled rather than as an error */
export class MemoryUnavailableError extends Error {
  constructor() {
    super("Memory is not available on this server yet");
    this.name = "MemoryUnavailableError";
  }
}

/** hits the retired global memory endpoint, which will 404 once the projects router ships. Kept
 * only because the existing MemoryDialog still calls it and already maps the 404 to
 * MemoryUnavailableError, until the memory dialog is scoped to a project and calls
 * getProjectMemory instead. */
export async function getMemory(): Promise<MemoryState> {
  const response = await fetch(memoryUrl, { credentials: "include" });
  if (response.status === 404) {
    throw new MemoryUnavailableError();
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return mapMemoryState(await response.json());
}

/** what the next session filed into projectId will be seeded with, not what an existing
 * session carries: a session's digest is frozen on its first turn. 404 (MemoryUnavailableError)
 * for a caller with no identifiable user (same gate as the old GET /v1/memory), or for a
 * project_id that isn't the caller's. */
export async function getProjectMemory(projectId: string): Promise<MemoryState> {
  const response = await fetch(`${projectsUrl}/${encodeURIComponent(projectId)}/memory`, {
    credentials: "include",
  });
  if (response.status === 404) {
    throw new MemoryUnavailableError();
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return mapMemoryState(await response.json());
}

function mapMemoryState(data: any): MemoryState {
  return {
    enabled: Boolean(data.enabled),
    digest: data.digest ?? "",
    sessions: (data.sessions ?? []).map(mapMemorySession),
    charCap: typeof data.char_cap === "number" ? data.char_cap : 0,
  };
}

export async function setMemoryEnabled(on: boolean): Promise<void> {
  const response = await fetch(`${settingsUrl}/${encodeURIComponent(MEMORY_ENABLED_KEY)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ setting_value: on ? "on" : "off" }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

function mapMemorySession(data: any): MemorySession {
  return {
    id: data.id,
    title: data.title,
    pinned: Boolean(data.pinned),
    createdAt: data.created_at,
  };
}
