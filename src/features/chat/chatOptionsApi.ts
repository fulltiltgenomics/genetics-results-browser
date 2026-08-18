import { TOOL_PROFILES } from "./chat.types";
import type { LiteratureBackend, ToolProfile, Verbosity } from "./chat.types";

const apiUrl = import.meta.env.VITE_CHAT_URL;
const settingsUrl = `${apiUrl}/v1/llm-config/user/settings`;

export const VERBOSITY_KEY = "chat_verbosity";
export const LITERATURE_BACKEND_KEY = "chat_literature_backend";
export const TOOL_PROFILE_KEY = "chat_tool_profile";

/** the "all" profile is the absence of a profile, but a setting_value must be non-empty (the PUT
 * rejects a blank one with a 400), so it round-trips through this sentinel rather than through "" */
export const TOOL_PROFILE_ALL = "all";

export const DEFAULT_OPTIONS = {
  verbosity: "brief" as Verbosity,
  literatureBackend: "perplexity" as LiteratureBackend,
  toolProfile: null as ToolProfile | null,
};

// the settings endpoint stores opaque strings and this value may also arrive from a message row
// written by an older client, so every read is narrowed here rather than trusted. an unrecognised
// value falls back to the default: a control with no matching option renders as nothing selected
export function coerceVerbosity(value: unknown): Verbosity {
  return value === "brief" || value === "detailed" ? value : DEFAULT_OPTIONS.verbosity;
}

export function coerceLiteratureBackend(value: unknown): LiteratureBackend {
  return value === "europepmc" || value === "perplexity"
    ? value
    : DEFAULT_OPTIONS.literatureBackend;
}

/** `null` here is NOT the safe fallback it looks like. Server-side a null/omitted `tool_profile`
 * means *no filtering at all* — the full ~65-tool surface — so an unrecognised value resolves to
 * the largest possible arm, the opposite of what someone picking a minimal profile asked for, with
 * no error anywhere. Kept that way deliberately: the value is read back from `user_settings` and
 * from `chat_messages` rows written by older clients, and the only alternatives are raising (turns
 * a stale row into a hard failure) or substituting some other profile (silently answers a
 * different question than the one stored). Note the asymmetry with the server, which degrades an
 * unknown profile to general-only instead: both are defensible, together they are inconsistent,
 * and the mitigation is that TOOL_PROFILES is the one list every consumer narrows against. */
export function coerceToolProfile(value: unknown): ToolProfile | null {
  return TOOL_PROFILES.includes(value as ToolProfile) ? (value as ToolProfile) : null;
}

export interface StoredChatOptions {
  verbosity: Verbosity;
  literatureBackend: LiteratureBackend;
  toolProfile: ToolProfile | null;
}

/** one request for all three; missing keys fall back to the defaults */
export async function getStoredChatOptions(): Promise<StoredChatOptions> {
  const response = await fetch(settingsUrl, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return {
    verbosity: coerceVerbosity(data?.[VERBOSITY_KEY]?.setting_value),
    literatureBackend: coerceLiteratureBackend(data?.[LITERATURE_BACKEND_KEY]?.setting_value),
    toolProfile: coerceToolProfile(data?.[TOOL_PROFILE_KEY]?.setting_value),
  };
}

export async function saveChatOption(key: string, value: string): Promise<void> {
  const response = await fetch(`${settingsUrl}/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ setting_value: value }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}
