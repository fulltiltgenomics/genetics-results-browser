import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("./schemaApi", () => ({
  useSchema: () => ({ data: undefined }),
}));
vi.mock("./mcpApps/mcpAppsApi", () => ({
  fetchAppView: () => new Promise(() => {}),
  callAppTool: vi.fn(),
}));

Element.prototype.scrollIntoView = vi.fn();

const APP_EVENT = {
  type: "mcp_app",
  tool_use_id: "tu-1",
  tool: "depmap_show_data_explorer_plot",
  input: { plot_json_string: '{"plot_type":"density_1d"}' },
  resource_uri: "ui://plot/view.html",
  result: {
    content: [{ type: "text", text: "Showing an interactive density_1d plot in the chat." }],
    structuredContent: { type: "plot", params: { plot_type: "density_1d" } },
    isError: false,
  },
};

const sentBodies: any[] = [];
let sendDone = true;
vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: vi.fn(async (_url: string, init: any) => {
    if (init.method === "GET") {
      await init.onopen({ ok: false, status: 404, type: "default", headers: { get: () => "application/json" } });
      return;
    }
    sentBodies.push(JSON.parse(init.body));
    await init.onopen({ ok: true, headers: { get: () => "text/event-stream" } });
    init.onmessage({ data: JSON.stringify({ type: "content", content: "Here is the plot." }) });
    init.onmessage({ data: JSON.stringify(APP_EVENT) });
    if (sendDone) {
      init.onmessage({
        data: JSON.stringify({
          type: "done",
          message_content: [{ type: "text", text: "Here is the plot." }],
          tool_results: [{ type: "tool_result", tool_use_id: "tu-1", content: '{"success": true}' }],
        }),
      });
    }
    init.onclose?.();
  }),
}));

import { LLMChat } from "./LLMChat";

const submit = (text: string) => {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
};

describe("LLMChat MCP App view", () => {
  beforeEach(() => {
    sentBodies.length = 0;
    sendDone = true;
  });

  it("shows the view's frame in the transcript", async () => {
    render(<LLMChat />);
    submit("plot TP53 dependency");
    await waitFor(() => expect(sentBodies).toHaveLength(1));
    expect(await screen.findByText(/depmap_show_data_explorer_plot/)).toBeInTheDocument();
    expect(screen.queryByText(/MCPAPP/)).toBeNull();
  });

  it("replays the turn as a note rather than the view's payload when it never delivered `done`", async () => {
    sendDone = false;
    render(<LLMChat />);
    submit("plot TP53 dependency");
    await waitFor(() => expect(sentBodies).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("textbox")).not.toBeDisabled());

    sendDone = true;
    submit("and now MDM2");
    await waitFor(() => expect(sentBodies).toHaveLength(2));

    const replay = JSON.stringify(sentBodies[1].messages);
    expect(replay).not.toContain("[MCPAPP:");
    expect(replay).not.toContain("structuredContent");
    expect(replay).toContain("Here is the plot.");
    expect(replay).toContain("interactive view shown to the user: depmap_show_data_explorer_plot");
  });
});
