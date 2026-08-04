import type { InstructionSet, InstructionSetVersion } from "./chat.types";

const apiUrl = import.meta.env.VITE_CHAT_URL;

const setsUrl = `${apiUrl}/v1/llm-config/user/instruction-sets`;
const settingsUrl = `${apiUrl}/v1/llm-config/user/settings`;

/** which set is selected is a plain user setting, not part of the instruction-set resource */
export const SELECTED_INSTRUCTION_SET_KEY = "selected_instruction_set";

// mirrors INSTRUCTION_SET_MAX_BODY_CHARS / INSTRUCTION_SET_MAX_PER_USER in the server's
// llm_config_db.py. Kept here so the editor can warn before a write instead of only after a
// 413/409; the server stays the authority.
export const MAX_BODY_CHARS = 4000;
export const MAX_SETS_PER_USER = 20;

/** carries the HTTP status so callers can distinguish 413 (too long) from 409 (too many). */
export class InstructionSetApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "InstructionSetApiError";
    this.status = status;
  }
}

async function toError(response: Response): Promise<InstructionSetApiError> {
  let detail = "";
  try {
    const data = await response.json();
    if (typeof data?.detail === "string") {
      detail = data.detail;
    }
  } catch {
    // non-JSON error body, fall back to the status
  }
  return new InstructionSetApiError(response.status, detail || `HTTP ${response.status}`);
}

export async function listInstructionSets(): Promise<InstructionSet[]> {
  const response = await fetch(setsUrl, { credentials: "include" });
  if (!response.ok) {
    throw await toError(response);
  }
  const data = await response.json();
  return data.map(mapInstructionSet);
}

export async function createInstructionSet(
  name: string,
  body: string,
  comment?: string,
): Promise<InstructionSet> {
  const response = await fetch(setsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name, body, comment }),
  });
  if (!response.ok) {
    throw await toError(response);
  }
  return mapInstructionSet(await response.json());
}

/** omitted fields keep their stored value; a set that is archived or not owned gives a 404. */
export async function updateInstructionSet(
  setId: string,
  changes: { name?: string; body?: string; comment?: string },
): Promise<InstructionSet> {
  const response = await fetch(`${setsUrl}/${encodeURIComponent(setId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(changes),
  });
  if (!response.ok) {
    throw await toError(response);
  }
  return mapInstructionSet(await response.json());
}

/** archives rather than deletes, so messages that recorded this set stay resolvable. */
export async function archiveInstructionSet(setId: string): Promise<void> {
  const response = await fetch(`${setsUrl}/${encodeURIComponent(setId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok && response.status !== 404) {
    throw await toError(response);
  }
}

export async function getInstructionSetHistory(
  setId: string,
  limit = 20,
): Promise<InstructionSetVersion[]> {
  const response = await fetch(
    `${setsUrl}/${encodeURIComponent(setId)}/history?limit=${limit}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw await toError(response);
  }
  const data = await response.json();
  return data.map(mapInstructionSetVersion);
}

/** null when the user has never chosen a set, or cleared their choice. */
export async function getSelectedInstructionSetId(): Promise<string | null> {
  const response = await fetch(
    `${settingsUrl}/${encodeURIComponent(SELECTED_INSTRUCTION_SET_KEY)}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw await toError(response);
  }
  const data = await response.json();
  return data?.setting_value ?? null;
}

export async function setSelectedInstructionSetId(setId: string): Promise<void> {
  const response = await fetch(
    `${settingsUrl}/${encodeURIComponent(SELECTED_INSTRUCTION_SET_KEY)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ setting_value: setId }),
    },
  );
  if (!response.ok) {
    throw await toError(response);
  }
}

export async function clearSelectedInstructionSet(): Promise<void> {
  const response = await fetch(
    `${settingsUrl}/${encodeURIComponent(SELECTED_INSTRUCTION_SET_KEY)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!response.ok && response.status !== 404) {
    throw await toError(response);
  }
}

function mapInstructionSet(data: any): InstructionSet {
  return {
    id: data.id,
    name: data.name,
    body: data.body,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    bodyOverCap: Boolean(data.body_over_cap),
  };
}

function mapInstructionSetVersion(data: any): InstructionSetVersion {
  return {
    id: data.id,
    setId: data.set_id,
    name: data.name,
    body: data.body,
    changedAt: data.changed_at,
    comment: data.comment ?? null,
  };
}
