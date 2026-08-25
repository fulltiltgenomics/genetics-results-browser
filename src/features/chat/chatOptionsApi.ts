import { TOOL_PROFILES } from "./chat.types";
import type { LiteratureBackend, ToolProfile, ToolProfileValue, Verbosity } from "./chat.types";

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
 * and the mitigation is that TOOL_PROFILES is the one list every consumer narrows against.
 *
 * Drift runs BOTH ways and this function only ever sees one of them. A name in TOOL_PROFILES the
 * server no longer knows passes through here because it IS in the list; a name the SERVER added
 * that this build predates is discarded here, and `null` is the full surface. Neither is decidable
 * locally, so both are settled by asking the server: `fetchResolvedToolProfile` below, called from
 * the store for the selected profile (first case) and for a stored name this returned `null` for
 * (second case, `unknownToolProfile`). This function's own contract is unchanged — it still returns
 * only names this build enumerates, so nothing that narrows against it can widen by accident. */
export function coerceToolProfile(value: unknown): ToolProfile | null {
  return TOOL_PROFILES.includes(value as ToolProfile) ? (value as ToolProfile) : null;
}

/** the widest a stored profile name may be before it stops being a plausible profile name at all */
const MAX_TOOL_PROFILE_LENGTH = 32;

/** Does this look like a profile name at all? The bound on everything an opaque `setting_value` is
 * allowed to become — a probe URL, a radio label, a `tool_profile` on the next message. A stored
 * value that is empty, absurdly long, or arbitrary bytes is corruption rather than drift: it is
 * never asked about and never rendered, and falls back to the pre-existing null/"All" behaviour. */
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
  toolProfile: ToolProfile | null;
  /** the stored value when it is a plausible profile name this build does not enumerate — kept
   * rather than dropped, because dropping it silently hands the user the full tool surface. The
   * store asks the server about it and keeps it only if the server says it knows it
   * (genetics-results-suite-4h6.74). `null` whenever `toolProfile` above is a real answer. */
  unknownToolProfile: string | null;
}

/** one request for all three; missing keys fall back to the defaults */
export async function getStoredChatOptions(): Promise<StoredChatOptions> {
  const response = await fetch(settingsUrl, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  const rawToolProfile = data?.[TOOL_PROFILE_KEY]?.setting_value;
  const toolProfile = coerceToolProfile(rawToolProfile);
  return {
    verbosity: coerceVerbosity(data?.[VERBOSITY_KEY]?.setting_value),
    literatureBackend: coerceLiteratureBackend(data?.[LITERATURE_BACKEND_KEY]?.setting_value),
    toolProfile,
    unknownToolProfile:
      toolProfile === null && isPlausibleToolProfile(rawToolProfile) ? rawToolProfile : null,
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

/** what the server says it would actually do with a profile the browser offers.
 * `count` is LOCAL tools only — external (gnomAD/Open Targets) and RAG tools are proxied
 * surfaces the endpoint deliberately leaves out. */
export interface ResolvedToolProfile {
  known: boolean;
  count: number;
}

/** Ask the server whether it recognises `profile` (genetics-results-suite-4h6.74).
 *
 * The two repos each enumerate the profiles and neither can import the other's list, and this one
 * question settles both directions of the resulting drift. A name this build offers that the
 * server has dropped is degraded there to general-only — a user who picked the seven-tool code
 * surface silently gets a different arm. A name the SERVER has added that this build predates is
 * dropped here to `null`, which is no filtering at all — the user's stored, narrower choice
 * silently becomes the full ~65-tool surface. `/chat/v1/tools/resolved` already answers exactly
 * this question; this is the caller it was written for.
 *
 * FAILS QUIET BY DESIGN: only a response that actually carries a boolean `known_profile` is an
 * answer; everything else resolves to `null` and the caller shows nothing. An offline browser, a
 * 5xx, an old backend that predates the endpoint and 404s — none of those is evidence of drift,
 * and treating them as one would put a scary banner in front of a user whose profile is fine.
 */
export async function fetchResolvedToolProfile(
  profile: ToolProfileValue,
): Promise<ResolvedToolProfile | null> {
  // junk in a settings row is not drift, and there is nothing to learn by putting it in a URL
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
