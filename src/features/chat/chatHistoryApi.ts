import type { AttachmentType } from "./chat.types";
import { toError } from "./projectsApi";

const chatUrl = import.meta.env.VITE_CHAT_URL;

export interface UploadedAttachment {
  id: string;
  name: string;
  size: number;
  type: AttachmentType;
  mimeType: string;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  preview?: string;
  rating?: number;
  comment?: string;
  phenotypeCode?: string;
  // optional: older backends omit it on the session-list response, which reads as unpinned
  pinned?: boolean;
  // the project this session is filed into; null when unfiled
  projectId?: string | null;
}

export interface ChatMessageRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  thumbsUp: boolean | null;
  contentJson: string | null;
  literatureBackend: string | null;
  toolProfile: string | null;
  toolResultsJson: string | null;
  instructionSetId: string | null;
  verbosity: string | null;
}

export interface SessionDetail extends ChatSession {
  messages: ChatMessageRecord[];
  isOwner: boolean;
  shared: boolean;
}

export async function listSessions(): Promise<ChatSession[]> {
  const response = await fetch(`${chatUrl}/v1/chat/sessions`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.map(mapSession);
}

export async function createSession(
  phenotypeCode?: string,
  projectId?: string,
): Promise<ChatSession> {
  const response = await fetch(`${chatUrl}/v1/chat/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ phenotype_code: phenotypeCode, project_id: projectId }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return {
    id: data.id,
    title: null,
    createdAt: data.created_at,
    updatedAt: data.created_at,
    projectId: data.project_id ?? null,
  };
}

export async function getSession(sessionId: string): Promise<SessionDetail> {
  const response = await fetch(`${chatUrl}/v1/chat/sessions/${sessionId}`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return {
    id: data.id,
    title: data.title,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    rating: data.rating,
    comment: data.comment,
    phenotypeCode: data.phenotype_code,
    isOwner: data.is_owner,
    shared: data.shared,
    projectId: data.project_id ?? null,
    messages: data.messages.map(mapMessage),
  };
}

export async function updateSession(
  sessionId: string,
  updates: { title?: string; rating?: number; comment?: string }
): Promise<void> {
  const response = await fetch(`${chatUrl}/v1/chat/sessions/${sessionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(`${chatUrl}/v1/chat/sessions/${sessionId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`HTTP ${response.status}`);
  }
}

export async function shareSession(
  sessionId: string,
  shared: boolean
): Promise<void> {
  const response = await fetch(`${chatUrl}/v1/chat/sessions/${sessionId}/share`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ shared }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

/** secret chats have no server row and so are never a valid sessionId here; the caller hides
 * the pin control for them rather than relying on this 404ing */
export async function pinSession(sessionId: string, pinned: boolean): Promise<void> {
  const response = await fetch(`${chatUrl}/v1/chat/sessions/${sessionId}/pin`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ pinned }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

/** files sessionId into projectId, or unfiles it with projectId=null. Owner-only on both ends;
 * a session that is not the caller's, or a project_id naming another user's project, 404s. */
export async function moveSession(sessionId: string, projectId: string | null): Promise<void> {
  const response = await fetch(`${chatUrl}/v1/chat/sessions/${sessionId}/project`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ project_id: projectId }),
  });
  if (!response.ok) {
    throw await toError(response);
  }
}

/** the caller's own sessions filed into this project, most recent first. */
export async function listProjectSessions(projectId: string): Promise<ChatSession[]> {
  const response = await fetch(`${chatUrl}/v1/projects/${projectId}/sessions`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw await toError(response);
  }
  const data = await response.json();
  return data.map(mapSession);
}

export async function forkSession(sessionId: string): Promise<ChatSession> {
  const response = await fetch(`${chatUrl}/v1/chat/sessions/${sessionId}/fork`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return mapSession(data);
}

export async function saveMessage(
  sessionId: string,
  messageId: string,
  role: string,
  content: string,
  contentJson?: string | null,
  literatureBackend?: string | null,
  toolProfile?: string | null,
  toolResultsJson?: string | null,
  instructionSetId?: string | null,
  verbosity?: string | null,
): Promise<ChatMessageRecord> {
  const payload = {
    id: messageId,
    role,
    content,
    content_json: contentJson,
    literature_backend: literatureBackend,
    tool_profile: toolProfile,
    tool_results_json: toolResultsJson,
    // the server's upsert does ON CONFLICT DO UPDATE SET instruction_set_id = excluded.…, so a
    // re-save that omits the key would clear it — null explicitly rather than letting
    // JSON.stringify drop an undefined
    instruction_set_id: instructionSetId ?? null,
    verbosity: verbosity ?? null,
  };
  console.log("[saveMessage] Saving with payload:", payload);
  const response = await fetch(`${chatUrl}/v1/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return mapMessage(await response.json());
}

export async function rateMessage(
  messageId: string,
  thumbsUp: boolean | null
): Promise<void> {
  const response = await fetch(`${chatUrl}/v1/chat/messages/${messageId}/rating`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ thumbs_up: thumbsUp }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

export async function generateTitle(sessionId: string): Promise<string> {
  const response = await fetch(`${chatUrl}/v1/chat/sessions/${sessionId}/generate-title`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.title;
}

function mapSession(data: any): ChatSession {
  return {
    id: data.id,
    title: data.title,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    preview: data.preview,
    rating: data.rating,
    pinned: Boolean(data.pinned),
    projectId: data.project_id ?? null,
  };
}

function mapMessage(data: any): ChatMessageRecord {
  return {
    id: data.id,
    role: data.role,
    content: data.content,
    createdAt: data.created_at,
    thumbsUp: data.thumbs_up,
    contentJson: data.content_json,
    literatureBackend: data.literature_backend,
    toolProfile: data.tool_profile,
    toolResultsJson: data.tool_results_json,
    instructionSetId: data.instruction_set_id,
    verbosity: data.verbosity,
  };
}

export async function uploadAttachment(
  sessionId: string,
  file: File
): Promise<UploadedAttachment> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${chatUrl}/v1/chat/sessions/${sessionId}/attachments`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return {
    id: data.id,
    name: data.name,
    size: data.size,
    type: data.type,
    mimeType: data.mime_type,
    createdAt: data.created_at,
  };
}

export async function deleteAttachment(
  sessionId: string,
  attachmentId: string
): Promise<void> {
  const response = await fetch(
    `${chatUrl}/v1/chat/sessions/${sessionId}/attachments/${attachmentId}`,
    {
      method: "DELETE",
      credentials: "include",
    }
  );

  if (!response.ok && response.status !== 404) {
    throw new Error(`HTTP ${response.status}`);
  }
}

export async function getAttachment(
  sessionId: string,
  attachmentId: string
): Promise<Blob> {
  const response = await fetch(
    `${chatUrl}/v1/chat/sessions/${sessionId}/attachments/${attachmentId}`,
    {
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.blob();
}

/**
 * Fetch the model-ready text of a data-file attachment: parsed TSV for Excel,
 * the original text for TSV/CSV. Used to restore the inlined file content when a
 * session is reopened and the local File object is long gone.
 */
export async function getAttachmentText(
  sessionId: string,
  attachmentId: string
): Promise<string> {
  const response = await fetch(
    `${chatUrl}/v1/chat/sessions/${sessionId}/attachments/${attachmentId}?as=text`,
    {
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

export function getAttachmentType(mimeType: string, fileName: string): AttachmentType {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (
    mimeType === "text/tab-separated-values" ||
    mimeType === "text/csv" ||
    fileName.endsWith(".tsv") ||
    fileName.endsWith(".csv")
  ) {
    return "tsv";
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel" ||
    fileName.endsWith(".xlsx") ||
    fileName.endsWith(".xls")
  ) {
    return "excel";
  }
  throw new Error(`Unsupported file type: ${mimeType}`);
}

export function isValidAttachmentType(mimeType: string, fileName: string): boolean {
  try {
    getAttachmentType(mimeType, fileName);
    return true;
  } catch {
    return false;
  }
}
