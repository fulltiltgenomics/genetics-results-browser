import type { MemorySession, MemoryState } from "./chat.types";

const apiUrl = import.meta.env.VITE_CHAT_URL;

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

/** the global opt-in flag: whether memory is built for the caller's sessions at all. Read
 * from the same key-value settings store setMemoryEnabled writes, since the memory feature
 * has no per-user identity gate of its own the way the (now project-scoped) digest routes do. */
export async function getMemoryEnabled(): Promise<boolean> {
  const response = await fetch(settingsUrl, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return data?.[MEMORY_ENABLED_KEY]?.setting_value === "on";
}

/** what the next session filed into projectId will be seeded with, not what an existing
 * session carries: a session's digest is frozen on the first turn it takes in the project.
 * 404 (MemoryUnavailableError) for a caller with no identifiable user, or for a project_id
 * that isn't the caller's. */
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
