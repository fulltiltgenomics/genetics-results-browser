/**
 * The chat backend's two routes for an MCP App view: the HTML the tool's server serves for
 * it, and the tools/call requests the view makes once it is running. Both go through the
 * backend because the server is behind the operator's OAuth login, which the browser does
 * not hold.
 */

import type { McpCallToolResult } from "../mcpAppMarker";

const chatUrl = import.meta.env.VITE_CHAT_URL;

export interface AppViewCsp {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
}

/** an MCP tool definition as the server lists it; the view's SDK wants it whole */
export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AppView {
  uri: string;
  html: string;
  ui: {
    csp?: AppViewCsp;
    permissions?: Record<string, unknown>;
    prefersBorder?: boolean;
  };
  tool?: McpToolDefinition;
}

const views = new Map<string, Promise<AppView>>();

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body && typeof body.detail === "string") return body.detail;
  } catch {
    // not JSON
  }
  return `HTTP ${response.status}`;
}

/**
 * The view for a tool, fetched once per page load: DepMap's is 2.4 MB, and every plot in a
 * transcript renders with the same one.
 */
export function fetchAppView(tool: string): Promise<AppView> {
  const cached = views.get(tool);
  if (cached) return cached;
  const pending = (async () => {
    const response = await fetch(`${chatUrl}/v1/mcp-apps/${encodeURIComponent(tool)}/view`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()) as AppView;
  })();
  views.set(tool, pending);
  pending.catch(() => views.delete(tool));
  return pending;
}

export async function callAppTool(
  tool: string,
  name: string,
  args: Record<string, unknown>,
): Promise<McpCallToolResult> {
  const response = await fetch(`${chatUrl}/v1/mcp-apps/${encodeURIComponent(tool)}/call`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as McpCallToolResult;
}

/** test seam: forget every fetched view */
export function resetAppViews(): void {
  views.clear();
}
