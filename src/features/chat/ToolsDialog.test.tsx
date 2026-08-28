import { PropsWithChildren } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { ToolsDialog } from "./ToolsDialog";
import { useChatOptionsStore } from "./useChatOptions";

const TOOLS = [
  {
    name: "search_genes",
    description: "Look up gene symbols and positions.",
    category: "general",
    source: "local",
  },
  {
    name: "query_database",
    description: "Execute a **SQL** query against the genetics database.",
    category: "bigquery",
    source: "local",
  },
  {
    name: "gnomad_variant",
    description: "Population frequencies from gnomAD.",
    category: null,
    source: "external",
  },
];

const renderDialog = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ToolsDialog open onClose={vi.fn()} />, { wrapper });
};

const serveTools = () => {
  const requested: string[] = [];
  server.use(
    http.get("*/v1/tools", ({ request }) => {
      requested.push(request.url);
      return HttpResponse.json(TOOLS);
    })
  );
  return requested;
};

describe("ToolsDialog", () => {
  it("asks for the resolved surface of the conversation's profile, not the raw catalogue", async () => {
    const requested = serveTools();
    useChatOptionsStore.setState({ toolProfile: "bigquery" });

    renderDialog();

    await waitFor(() => expect(requested).toHaveLength(1));
    const url = new URL(requested[0]);
    // without resolved=true the endpoint answers with the unfiltered catalogue, which would
    // list tools this conversation does not have and omit the ones it does
    expect(url.searchParams.get("resolved")).toBe("true");
    expect(url.searchParams.get("tool_profile")).toBe("bigquery");
  });

  it('omits tool_profile entirely for "All", which is the absence of a profile', async () => {
    const requested = serveTools();
    useChatOptionsStore.setState({ toolProfile: null });

    renderDialog();

    await waitFor(() => expect(requested).toHaveLength(1));
    expect(new URL(requested[0]).searchParams.has("tool_profile")).toBe(false);
  });

  it("groups the tools and renders each description as markdown", async () => {
    serveTools();
    useChatOptionsStore.setState({ toolProfile: null });

    renderDialog();

    expect(await screen.findByText("query_database")).toBeInTheDocument();
    expect(screen.getByText("Lookup and search")).toBeInTheDocument();
    expect(screen.getByText("Database (SQL)")).toBeInTheDocument();
    // proxied tools carry no category and would be dropped by a category-only grouping
    expect(screen.getByText("External MCP servers")).toBeInTheDocument();
    expect(screen.getByText("gnomad_variant")).toBeInTheDocument();
    // the model-facing descriptions use markdown emphasis; the asterisks must not show
    expect(screen.getByText("SQL").tagName).toBe("STRONG");
  });

  it("filters on name and description", async () => {
    serveTools();
    useChatOptionsStore.setState({ toolProfile: null });

    renderDialog();
    await screen.findByText("query_database");

    fireEvent.change(screen.getByPlaceholderText("Filter by name or description"), {
      target: { value: "gnomad" },
    });

    expect(screen.getByText("gnomad_variant")).toBeInTheDocument();
    expect(screen.queryByText("query_database")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 3 tools")).toBeInTheDocument();
  });
});
