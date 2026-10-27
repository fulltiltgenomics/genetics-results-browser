/**
 * The `[MCPAPP:<base64>]` marker: how an MCP App view survives in a message's stored text.
 *
 * An external tool whose server also serves an HTML view for its result (the MCP Apps
 * extension; DepMap's Data Explorer plots) arrives as an `mcp_app` SSE event carrying the
 * tool's input and its whole CallToolResult. The view is rendered live from that event and
 * again on reload, so the event is embedded in `content` the way `[TOOLUSE:...]` is: `content`
 * is the only thing MessageContent ever sees, live or from history. The HTML itself is not
 * stored — it is the server's, fetched when the marker renders — only what the view is told.
 *
 * As with the other markers the payload never travels back to the model: the backend's
 * `_TOOL_USE_MARKER_RE` strips this shape from replayed assistant text, and `stripMcpAppMarkers`
 * does the same for a turn that ended without `done`.
 */

import { fromBase64, toBase64 } from "./toolCallMarker";

/** one block of an MCP `CallToolResult.content` */
export interface McpContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

/** an MCP `CallToolResult`, as the tool's server answered it */
export interface McpCallToolResult {
  content?: McpContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface McpAppRecord {
  /** the `tool_use` block id */
  id: string;
  /** the registered (prefixed) tool name; what the view route and the call route take */
  tool: string;
  input: Record<string, unknown>;
  result: McpCallToolResult;
}

export const MCP_APP_MARKER_REGEX = /\[MCPAPP:([A-Za-z0-9+/=]*)\]/g;

export function encodeMcpAppMarker(record: McpAppRecord): string {
  return `[MCPAPP:${toBase64(JSON.stringify(record))}]`;
}

/** null for anything that does not decode — a truncated stream can leave a partial marker */
export function decodeMcpAppMarker(encoded: string): McpAppRecord | null {
  try {
    const parsed = JSON.parse(fromBase64(encoded));
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.tool === "string" &&
      parsed.result &&
      typeof parsed.result === "object"
    ) {
      return {
        id: typeof parsed.id === "string" ? parsed.id : "",
        tool: parsed.tool,
        input: parsed.input && typeof parsed.input === "object" ? parsed.input : {},
        result: parsed.result,
      };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Replace each marker with a note naming what the user was shown. */
export const stripMcpAppMarkers = (text: string): string =>
  text.replace(MCP_APP_MARKER_REGEX, (_marker, encoded: string) => {
    const record = decodeMcpAppMarker(encoded);
    return `[interactive view shown to the user: ${record?.tool ?? ""}]`;
  });
