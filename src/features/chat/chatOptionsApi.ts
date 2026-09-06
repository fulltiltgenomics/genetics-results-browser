import type { LiteratureBackend, ToolProfile, Verbosity } from "./chat.types";

const apiUrl = import.meta.env.VITE_CHAT_URL;
const settingsUrl = `${apiUrl}/v1/llm-config/user/settings`;

export const VERBOSITY_KEY = "chat_verbosity";
export const LITERATURE_BACKEND_KEY = "chat_literature_backend";
export const TOOL_PROFILE_KEY = "chat_tool_profile";

/** what older clients stored for "no profile selected", still sitting in live `user_settings` and
 * `chat_messages` rows. Nothing writes it any more — both of today's values are real names — but it
 * still has to read back, and it is not a name worth asking the server about */
export const TOOL_PROFILE_ALL = "all";

export const DEFAULT_OPTIONS = {
  verbosity: "brief" as Verbosity,
  literatureBackend: "perplexity" as LiteratureBackend,
  toolProfile: "nocode" as ToolProfile,
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

/** The browser's half of the server's single coercion (`code_execution_requested`): only `"code"`
 * asks for code execution. Everything else resolves to the no-code surface — the legacy
 * api/bigquery/rag names, the "all" sentinel, `null`, and a value neither end knows.
 *
 * The two ends agree, which is what makes this safe to decide locally: a stored row written by an
 * older client resolves here exactly as the server resolves it when the row is sent back verbatim,
 * so the control shows what the message would actually run with. Raising instead would turn a stale
 * row into a hard failure, and nothing is rewritten server-side — history and the
 * `tool_profile IS NULL` analysis still read what the client sent. */
export function coerceToolProfile(value: unknown): ToolProfile {
  return value === "code" ? "code" : "nocode";
}

/** the widest a stored profile name may be before it stops being a plausible profile name at all */
const MAX_TOOL_PROFILE_LENGTH = 32;

/** Does this look like a profile name at all? The bound on everything a profile string is allowed
 * to become downstream — today the probe URL below, and any future caller that puts one in a URL or
 * on screen. Empty, absurdly long or arbitrary bytes is corruption rather than a name. */
export function isPlausibleToolProfile(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== TOOL_PROFILE_ALL &&
    value.length <= MAX_TOOL_PROFILE_LENGTH &&
    /^[a-z][a-z0-9_-]*$/i.test(value)
  );
}

export interface StoredChatOptions {
  verbosity: Verbosity;
  literatureBackend: LiteratureBackend;
  toolProfile: ToolProfile;
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

/** what the server says it would actually hand a conversation on this profile.
 * `count` is LOCAL tools only — external (gnomAD/Open Targets) and RAG tools are proxied
 * surfaces the endpoint deliberately leaves out. */
export interface ResolvedToolProfile {
  known: boolean;
  count: number;
}

/** What the server says the selected profile resolves to, so the control can show its size.
 *
 * `known_profile` is not a correctness signal — both ends resolve anything but `"code"` to the
 * no-code surface, and this endpoint shipped after `nocode` did, so any backend able to answer at
 * all recognises both values. It is read as the shape check: a body carrying a boolean under that
 * name came from this endpoint, where an SSO landing page, a proxy's error JSON or any other
 * 200 that merely parses did not.
 *
 * FAILS QUIET BY DESIGN: only a response that actually carries a boolean `known_profile` is an
 * answer; everything else resolves to `null` and the caller shows nothing. An offline browser, a
 * 5xx, an old backend that predates the endpoint and 404s — none of those is worth a word in the UI
 * about a preference that works either way.
 */
export async function fetchResolvedToolProfile(
  profile: ToolProfile,
): Promise<ResolvedToolProfile | null> {
  // nothing is learned by putting a value that is not a profile name into a URL
  if (!isPlausibleToolProfile(profile)) {
    return null;
  }
  try {
    const response = await fetch(
      `${apiUrl}/v1/tools/resolved?tool_profile=${encodeURIComponent(profile)}`,
      { credentials: "include" },
    );
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    if (typeof data?.known_profile !== "boolean") {
      return null;
    }
    return {
      known: data.known_profile,
      count: typeof data?.count === "number" ? data.count : 0,
    };
  } catch {
    return null;
  }
}
