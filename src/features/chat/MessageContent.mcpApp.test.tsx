import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchAppView = vi.fn<(tool: string) => Promise<never>>(() => new Promise(() => {}));
vi.mock("./mcpApps/mcpAppsApi", () => ({
  fetchAppView: (tool: string) => fetchAppView(tool),
  callAppTool: vi.fn(),
}));

import { MessageContent } from "./MessageContent";
import { encodeMcpAppMarker } from "./mcpAppMarker";

describe("MessageContent with an MCP App marker", () => {
  it("renders the view frame in place of the marker, with the prose around it", () => {
    const marker = encodeMcpAppMarker({
      id: "tu-1",
      tool: "depmap_show_data_explorer_plot",
      input: {},
      result: { content: [] },
    });
    render(<MessageContent content={`Here is the plot.\n\n${marker}\n\nOpen it in the portal.`} />);
    expect(screen.getByText("Here is the plot.")).toBeInTheDocument();
    expect(screen.getByText("Open it in the portal.")).toBeInTheDocument();
    expect(screen.getByText(/depmap_show_data_explorer_plot/)).toBeInTheDocument();
    expect(screen.getByText("Loading the view…")).toBeInTheDocument();
    expect(screen.queryByText(/MCPAPP/)).toBeNull();
    expect(fetchAppView).toHaveBeenCalledWith("depmap_show_data_explorer_plot");
  });

  it("drops a marker that does not decode rather than showing base64", () => {
    render(<MessageContent content={"before [MCPAPP:AAAA] after"} />);
    expect(screen.queryByText(/AAAA/)).toBeNull();
  });
});
