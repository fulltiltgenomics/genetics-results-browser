/**
 * The `[FILE:<mime>:<name>:<base64>]` marker LLMChat writes into an assistant message's
 * text, so a non-image artifact an analysis produced — a CSV, a TSV, a JSON — survives
 * persistence and reload through the single `content` field (MessageContent renders it as a
 * download control; exportChat unpacks it). Same trick, and same reason, as `[IMAGE:...]`:
 * `content` is the only thing anything displaying a stored message ever sees.
 *
 * The name is percent-encoded rather than stripped. The marker is colon-delimited and the
 * sandbox permits a colon or a bracket in an artifact file name, which would split the
 * marker and spill base64 into the transcript as prose; encoding removes every delimiter
 * while still saving the file under the name the analysis actually wrote.
 *
 * As with an image, the payload must never travel back to the model: bytes it already
 * produced, charged as text on every replayed turn.
 */

export const FILE_MARKER_REGEX = /\[FILE:([^:\]]+):([^:\]]+):([^\]]+)\]/g;

const DEFAULT_MIME = "application/octet-stream";

export const encodeFileMarker = (
  mime: string | undefined,
  name: string | undefined,
  base64: string
): string => {
  // a mime type is `type/subtype` plus optional suffixes; anything else in it is not a mime
  // type and would risk carrying the marker's own delimiters
  const safeMime = (mime || "").replace(/[^\w+./-]/g, "") || DEFAULT_MIME;
  // whitespace and line breaks are legal in transported base64 but break both the marker and
  // atob's input, so the payload is narrowed to the base64 alphabet
  const safeData = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  return `[FILE:${safeMime}:${encodeURIComponent(name || "artifact")}:${safeData}]`;
};

/** the original name back; a marker written by anything else may not be encoded at all */
export const decodeFileName = (encoded: string): string => {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
};

/** Replace each marker's base64 with a note naming the file the user was given. */
export const stripFileMarkers = (text: string): string =>
  text.replace(
    FILE_MARKER_REGEX,
    (_marker, _mime, name: string) => `[file given to the user: ${decodeFileName(name)}]`
  );

/** the decoded size without decoding: an artifact can be megabytes and is only rendered */
export const base64ByteLength = (base64: string): number => {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
};

export const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
