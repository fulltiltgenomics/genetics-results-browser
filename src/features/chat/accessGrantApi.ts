const apiUrl = import.meta.env.VITE_CHAT_URL;

export type AccessGrantProvider =
  | "google"
  | "apple"
  | "microsoft"
  | "google-workspace"
  | "microsoft-365"
  | "unknown";

export interface AccessGrant {
  email: string;
  grantedBy: string;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  emailSentAt: string | null;
  emailError: string | null;
  active: boolean;
}

export interface AccessGrantResult {
  // false with provider "unknown" means the server wants the admin to confirm first
  granted: boolean;
  alreadyActive: boolean;
  provider: AccessGrantProvider;
  grant: AccessGrant | null;
  emailSent: boolean | null;
  emailError: string | null;
}

export interface EmailResult {
  emailSent: boolean;
  emailError: string | null;
}

export class AccessGrantError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const toGrant = (g: any): AccessGrant => ({
  email: g.email,
  grantedBy: g.granted_by,
  grantedAt: g.granted_at,
  expiresAt: g.expires_at,
  revokedAt: g.revoked_at ?? null,
  emailSentAt: g.email_sent_at ?? null,
  emailError: g.email_error ?? null,
  active: Boolean(g.active),
});

async function fail(response: Response): Promise<never> {
  // a 400 carries the server's reason (e.g. a malformed address); surface it rather than the code
  let detail = `HTTP ${response.status}`;
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") detail = body.detail;
  } catch {
    // not json
  }
  throw new AccessGrantError(response.status, detail);
}

export async function listAccessGrants(): Promise<AccessGrant[]> {
  const response = await fetch(`${apiUrl}/v1/admin/access-grants`, { credentials: "include" });
  if (!response.ok) return fail(response);
  const data = await response.json();
  return data.map(toGrant);
}

export async function grantAccess(email: string, confirmUnknownProvider = false): Promise<AccessGrantResult> {
  const response = await fetch(`${apiUrl}/v1/admin/access-grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, confirm_unknown_provider: confirmUnknownProvider }),
  });
  if (!response.ok) return fail(response);
  const data = await response.json();
  return {
    granted: Boolean(data.granted),
    alreadyActive: Boolean(data.already_active),
    provider: data.provider,
    grant: data.grant ? toGrant(data.grant) : null,
    emailSent: data.email_sent ?? null,
    emailError: data.email_error ?? null,
  };
}

export async function revokeAccess(email: string): Promise<void> {
  const response = await fetch(`${apiUrl}/v1/admin/access-grants/${encodeURIComponent(email)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) return fail(response);
}

export async function resendAccessEmail(email: string): Promise<EmailResult> {
  const response = await fetch(`${apiUrl}/v1/admin/access-grants/${encodeURIComponent(email)}/email`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) return fail(response);
  const data = await response.json();
  return { emailSent: Boolean(data.email_sent), emailError: data.email_error ?? null };
}
