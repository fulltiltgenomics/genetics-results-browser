import { useQuery, UseQueryResult } from "@tanstack/react-query";
import type { ToolProfileValue } from "./chat.types";

const chatUrl = import.meta.env.VITE_CHAT_URL;

/** where a tool comes from, and the only thing that says whether `category` means anything.
 * local tools are defined in the chat server and filtered by profile category; external and
 * RAG tools are proxied from remote MCP servers, which have no notion of our categories */
export type ToolSource = "local" | "external" | "rag";

export interface AvailableTool {
  name: string;
  description: string;
  /** the profile category this tool is filtered by; null for every proxied tool */
  category: string | null;
  source: ToolSource;
}

/** Ask the chat server what a conversation on `profile` would actually be handed.
 *
 * `resolved=true` matters: without it the endpoint answers with the raw catalogue, which is
 * the same list for every profile, includes tools the server currently refuses to advertise,
 * and omits the BigQuery and proxied tools entirely.
 */
export async function fetchAvailableTools(
  profile: ToolProfileValue | null,
): Promise<AvailableTool[]> {
  const params = new URLSearchParams({ resolved: "true" });
  if (profile !== null) {
    params.set("tool_profile", profile);
  }
  const response = await fetch(`${chatUrl}/v1/tools?${params.toString()}`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const tools = (await response.json()) as Partial<AvailableTool>[];
  // the browser deploys independently of the chat backend: a backend that predates `resolved`
  // ignores the parameter and answers with the raw catalogue, whose entries carry a category but
  // no source. Reading a missing source as local keeps that answer grouped and readable — it is
  // every local tool, unfiltered — rather than collapsing the whole panel into one unnamed group
  return tools.map((t) => ({
    name: t.name ?? "",
    description: t.description ?? "",
    category: t.category ?? null,
    source: t.source ?? "local",
  }));
}

// the surface only changes when the server is redeployed, and the panel is opened repeatedly
// while comparing profiles — so cache per profile rather than refetching on every open
const TOOLS_STALE_TIME_MS = 10 * 60 * 1000;

export function useAvailableTools(
  profile: ToolProfileValue | null,
  enabled: boolean,
): UseQueryResult<AvailableTool[], Error> {
  return useQuery<AvailableTool[], Error>({
    queryKey: ["chat", "tools", profile],
    queryFn: () => fetchAvailableTools(profile),
    staleTime: TOOLS_STALE_TIME_MS,
    enabled,
  });
}
