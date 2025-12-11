import type { ToolDescriptionVersion } from "./configEditor.types";

const apiUrl = import.meta.env.VITE_API_URL;

export interface LLMConfigDefaults {
  toolDescriptions: { toolName: string; description: string }[];
}

export interface UserInstructions {
  id: number;
  instructions: string;
  changedAt: string;
  comment?: string;
}

export interface UserToolDescription {
  id: number;
  toolName: string;
  description: string;
  changedAt: string;
  comment?: string;
}

export async function getDefaults(): Promise<LLMConfigDefaults> {
  const response = await fetch(`${apiUrl}/v1/llm-config/defaults`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return {
    toolDescriptions: data.tool_descriptions.map((t: any) => ({
      toolName: t.tool_name,
      description: t.description,
    })),
  };
}

// user instructions (replaces system prompt editing)
export async function getUserInstructions(): Promise<UserInstructions | null> {
  const response = await fetch(`${apiUrl}/v1/llm-config/user/instructions`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return data ? mapUserInstructions(data) : null;
}

export async function updateUserInstructions(
  instructions: string,
  comment?: string
): Promise<UserInstructions> {
  const response = await fetch(`${apiUrl}/v1/llm-config/user/instructions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ instructions, comment }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return mapUserInstructions(await response.json());
}

export async function deleteUserInstructions(): Promise<void> {
  const response = await fetch(`${apiUrl}/v1/llm-config/user/instructions`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`HTTP ${response.status}`);
  }
}

// user tool description overrides
export async function getUserToolDescriptions(): Promise<
  Record<string, UserToolDescription>
> {
  const response = await fetch(`${apiUrl}/v1/llm-config/user/tool-descriptions`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  const result: Record<string, UserToolDescription> = {};
  for (const [name, value] of Object.entries(data)) {
    result[name] = mapUserToolDescription(value as any);
  }
  return result;
}

export async function updateUserToolDescription(
  toolName: string,
  description: string,
  comment?: string
): Promise<UserToolDescription> {
  const response = await fetch(
    `${apiUrl}/v1/llm-config/user/tool-descriptions/${encodeURIComponent(toolName)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ description, comment }),
    }
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return mapUserToolDescription(await response.json());
}

export async function deleteUserToolDescription(toolName: string): Promise<void> {
  const response = await fetch(
    `${apiUrl}/v1/llm-config/user/tool-descriptions/${encodeURIComponent(toolName)}`,
    {
      method: "DELETE",
      credentials: "include",
    }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`HTTP ${response.status}`);
  }
}

// user comments
export interface UserComment {
  id: number;
  comment: string;
  createdAt: string;
}

export async function getUserComments(): Promise<UserComment[]> {
  const response = await fetch(`${apiUrl}/v1/llm-config/user/comments`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.map(mapUserComment);
}

export async function addUserComment(comment: string): Promise<UserComment> {
  const response = await fetch(`${apiUrl}/v1/llm-config/user/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ comment }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return mapUserComment(await response.json());
}

export async function deleteUserComment(commentId: number): Promise<void> {
  const response = await fetch(`${apiUrl}/v1/llm-config/user/comments/${commentId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`HTTP ${response.status}`);
  }
}

function mapUserComment(data: any): UserComment {
  return {
    id: data.id,
    comment: data.comment,
    createdAt: data.created_at,
  };
}

// legacy global endpoints (deprecated, kept for compatibility)
export async function getToolDescriptions(): Promise<
  Record<string, ToolDescriptionVersion>
> {
  const response = await fetch(`${apiUrl}/v1/llm-config/tool-descriptions`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  const result: Record<string, ToolDescriptionVersion> = {};
  for (const [name, value] of Object.entries(data)) {
    result[name] = mapToolDescription(value as any);
  }
  return result;
}

export async function getToolDescriptionHistory(
  toolName: string,
  limit = 20
): Promise<ToolDescriptionVersion[]> {
  const response = await fetch(
    `${apiUrl}/v1/llm-config/tool-descriptions/${encodeURIComponent(toolName)}/history?limit=${limit}`,
    { credentials: "include" }
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.map(mapToolDescription);
}

function mapUserInstructions(data: any): UserInstructions {
  return {
    id: data.id,
    instructions: data.instructions,
    changedAt: data.changed_at,
    comment: data.comment,
  };
}

function mapUserToolDescription(data: any): UserToolDescription {
  return {
    id: data.id,
    toolName: data.tool_name,
    description: data.description,
    changedAt: data.changed_at,
    comment: data.comment,
  };
}

function mapToolDescription(data: any): ToolDescriptionVersion {
  return {
    id: data.id,
    toolName: data.tool_name,
    description: data.description,
    changedBy: data.changed_by,
    changedAt: data.changed_at,
    comment: data.comment,
  };
}
