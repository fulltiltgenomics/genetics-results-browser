const apiUrl = import.meta.env.VITE_API_URL;

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
}

export interface SessionDetail extends ChatSession {
  messages: ChatMessageRecord[];
}

export async function listSessions(): Promise<ChatSession[]> {
  const response = await fetch(`${apiUrl}/v1/chat/sessions`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.map(mapSession);
}

export async function createSession(phenotypeCode?: string): Promise<ChatSession> {
  const response = await fetch(`${apiUrl}/v1/chat/sessions`, {
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
  const response = await fetch(`${apiUrl}/v1/chat/sessions/${sessionId}`, {
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
    messages: data.messages.map(mapMessage),
  };
}

export async function updateSession(
  sessionId: string,
  updates: { title?: string; rating?: number; comment?: string }
): Promise<void> {
  const response = await fetch(`${apiUrl}/v1/chat/sessions/${sessionId}`, {
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
  const response = await fetch(`${apiUrl}/v1/chat/sessions/${sessionId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`HTTP ${response.status}`);
  }
}

export async function saveMessage(
  sessionId: string,
  messageId: string,
  role: string,
  content: string,
  contentJson?: string | null,
  literatureBackend?: string | null
): Promise<ChatMessageRecord> {
  const payload = {
    id: messageId,
    role,
    content,
    content_json: contentJson,
    literature_backend: literatureBackend,
  };
  console.log("[saveMessage] Saving with payload:", payload);
  const response = await fetch(`${apiUrl}/v1/chat/sessions/${sessionId}/messages`, {
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
  const response = await fetch(`${apiUrl}/v1/chat/messages/${messageId}/rating`, {
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
  const response = await fetch(`${apiUrl}/v1/chat/sessions/${sessionId}/generate-title`, {
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
  };
}
