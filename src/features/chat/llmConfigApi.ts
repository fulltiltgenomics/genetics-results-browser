const apiUrl = import.meta.env.VITE_CHAT_URL;

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
