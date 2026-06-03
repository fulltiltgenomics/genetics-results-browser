import type { AttachmentType } from "./chat.types";

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

export async function createSession(phenotypeCode?: string): Promise<ChatSession> {
  const response = await fetch(`${chatUrl}/v1/chat/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ phenotype_code: phenotypeCode }),
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
): Promise<ChatMessageRecord> {
  const payload = {
    id: messageId,
    role,
    content,
    content_json: contentJson,
    literature_backend: literatureBackend,
    tool_profile: toolProfile,
    tool_results_json: toolResultsJson,
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
