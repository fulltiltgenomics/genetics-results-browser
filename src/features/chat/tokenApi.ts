const apiUrl = import.meta.env.VITE_CHAT_URL;

export interface TokenInfo {
  id: number;
  prefix: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  isActive: boolean;
}

export interface TokenCreateResult {
  id: number;
  token: string;
  prefix: string;
  name: string | null;
  createdAt: string;
}

export async function createToken(name?: string): Promise<TokenCreateResult> {
  const response = await fetch(`${apiUrl}/v1/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name: name || null }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return {
    id: data.id,
    token: data.token,
    prefix: data.prefix,
    name: data.name,
    createdAt: data.created_at,
  };
}

export async function listTokens(): Promise<TokenInfo[]> {
  const response = await fetch(`${apiUrl}/v1/tokens`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.map((t: any) => ({
    id: t.id,
    prefix: t.prefix,
    name: t.name,
    createdAt: t.created_at,
    lastUsedAt: t.last_used_at,
    isActive: t.is_active,
  }));
}

export async function revokeToken(tokenId: number): Promise<void> {
  const response = await fetch(`${apiUrl}/v1/tokens/${tokenId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}
