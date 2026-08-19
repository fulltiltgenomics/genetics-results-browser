/**
 * The `[TOOLUSE:<base64>]` marker: how a tool call survives in a message's stored text.
 *
 * The backend streams tool calls as structured `tool_use` SSE events, but a message is
 * persisted as `content` (plain text) plus `content_json` (the model's own content blocks).
 * Only `content` is what MessageContent renders, live and on reload alike — so a tool call
 * that lived only in component state would vanish when the session was reopened. Embedding
 * it in `content` is the same trick `[IMAGE:...]` already uses, and it keeps one render
 * path instead of one for the live stream and another for history.
 *
 * Base64 rather than a delimited form because the payload is arbitrary user-visible code:
 * newlines, `]` and `:` all occur in it freely, and every delimiter the marker could pick
 * is a character some script legitimately contains. The backend's `_TOOL_USE_MARKER_RE`
 * strips this shape from replayed assistant text, so it never reaches the model.
 */

export interface ToolCallOutcome {
  /** did the sandbox execute it (`ran`) and did it succeed (`ok`) */
  ran: boolean;
  ok: boolean;
  status: string;
  durationMs: number | null;
  exception: string | null;
}

export interface ToolCallRecord {
  /** the `tool_use` block id; what a later `script_result` correlates against */
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** only ever set for `run_analysis`, and only once the script has finished */
  outcome?: ToolCallOutcome;
}

export const TOOL_CALL_MARKER_REGEX = /\[TOOLUSE:([A-Za-z0-9+/=]*)\]/g;

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  // chunked: String.fromCharCode(...bytes) blows the argument limit on a large script
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(encoded: string): string {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeToolCallMarker(record: ToolCallRecord): string {
  return `[TOOLUSE:${toBase64(JSON.stringify(record))}]`;
}

/** null for anything that does not decode — a truncated stream can leave a partial marker */
export function decodeToolCallMarker(encoded: string): ToolCallRecord | null {
  try {
    const parsed = JSON.parse(fromBase64(encoded));
    if (parsed && typeof parsed === "object" && typeof parsed.name === "string") {
      return parsed as ToolCallRecord;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Rewrite the marker for one tool call in place, leaving every other marker untouched.
 *
 * The outcome arrives in a separate `script_result` event after the call was already
 * written into the content, so this is how it gets attached. Matching on the decoded id
 * rather than on position because an iteration can hold several calls.
 */
export function withToolCallOutcome(
  content: string,
  id: string,
  outcome: ToolCallOutcome,
): string {
  return content.replace(TOOL_CALL_MARKER_REGEX, (match, encoded: string) => {
    const record = decodeToolCallMarker(encoded);
    if (!record || record.id !== id) return match;
    return encodeToolCallMarker({ ...record, outcome });
  });
}
