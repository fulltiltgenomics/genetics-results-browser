import { describe, expect, it } from "vitest";
import { decodeMcpAppMarker, encodeMcpAppMarker, stripMcpAppMarkers } from "./mcpAppMarker";

const record = {
  id: "tu-1",
  tool: "depmap_show_data_explorer_plot",
  input: { plot_json_string: '{"plot_type":"scatter"}' },
  result: {
    content: [{ type: "text", text: "Showing a plot. Link: https://depmap.org/…" }],
    structuredContent: { type: "plot", params: { plot_type: "scatter" } },
    isError: false,
  },
};

describe("mcpAppMarker", () => {
  it("round-trips a record through the marker", () => {
    const marker = encodeMcpAppMarker(record);
    expect(marker).toMatch(/^\[MCPAPP:[A-Za-z0-9+/=]+\]$/);
    const encoded = marker.slice("[MCPAPP:".length, -1);
    expect(decodeMcpAppMarker(encoded)).toEqual(record);
  });

  it("decodes the server-rendered form, which the backend writes with the same fields", () => {
    const encoded = btoa(JSON.stringify({ id: "x", tool: "t", input: {}, result: { content: [] } }));
    expect(decodeMcpAppMarker(encoded)).toEqual({ id: "x", tool: "t", input: {}, result: { content: [] } });
  });

  it("refuses a marker without a tool or a result, and one that is not base64", () => {
    expect(decodeMcpAppMarker(btoa(JSON.stringify({ id: "x" })))).toBeNull();
    expect(decodeMcpAppMarker(btoa(JSON.stringify({ tool: "t" })))).toBeNull();
    expect(decodeMcpAppMarker("!!!")).toBeNull();
    expect(decodeMcpAppMarker("")).toBeNull();
  });

  it("strips a marker to a note naming the tool, so the payload never reaches the model", () => {
    const text = `before\n\n${encodeMcpAppMarker(record)}\n\nafter`;
    expect(stripMcpAppMarkers(text)).toBe(
      "before\n\n[interactive view shown to the user: depmap_show_data_explorer_plot]\n\nafter",
    );
    expect(stripMcpAppMarkers("[MCPAPP:AAAA]")).toBe("[interactive view shown to the user: ]");
  });
});
