/**
 * The `[IMAGE:<format>:<alt>:<base64>]` marker LLMChat writes into an assistant message's
 * text, so a generated plot survives persistence and reload through the single `content`
 * field (MessageContent renders it; exportChat unpacks it).
 *
 * The payload must never travel back to the model: it is a picture the model cannot read,
 * charged as text on every replayed turn.
 */
const IMAGE_MARKER_REGEX = /\[IMAGE:([^:\]]+):([^:\]]+):([^\]]+)\]/g;

/** Replace each marker's base64 with a note naming what the user was shown. */
export const stripImageMarkers = (text: string): string =>
  text.replace(IMAGE_MARKER_REGEX, (_marker, _format, alt) => `[image shown to the user: ${alt}]`);
