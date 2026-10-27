import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpAppHost, PROTOCOL_VERSION } from "./appHost";

const record = {
  id: "tu-1",
  tool: "depmap_show_data_explorer_plot",
  input: { plot_json_string: "{}" },
  result: { content: [{ type: "text", text: "Showing a plot" }], structuredContent: { type: "plot" } },
};

const build = () => {
  const posted: any[] = [];
  const callTool = vi.fn(async (name: string) => ({ content: [{ type: "text", text: name }] }));
  const onSize = vi.fn();
  const onOpenLink = vi.fn();
  const host = new McpAppHost({
    record,
    hostInfo: { name: "test-host", version: "0" },
    context: { theme: "light", width: 640, maxHeight: 1200 },
    post: (m) => posted.push(m),
    callTool,
    onSize,
    onOpenLink,
  });
  return { host, posted, callTool, onSize, onOpenLink };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("McpAppHost", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => {
    h = build();
  });

  it("answers ui/initialize with the protocol version, host info and context", () => {
    h.host.handle({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: { protocolVersion: "2026-01-26" } });
    expect(h.posted).toHaveLength(1);
    const reply = h.posted[0];
    expect(reply.id).toBe(1);
    expect(reply.result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(reply.result.hostInfo).toEqual({ name: "test-host", version: "0" });
    expect(reply.result.hostContext.theme).toBe("light");
    expect(reply.result.hostContext.containerDimensions).toEqual({ width: 640, maxHeight: 1200 });
    expect(reply.result.hostContext.toolInfo).toEqual({
      id: "tu-1",
      tool: { name: record.tool, inputSchema: { type: "object" } },
    });
    expect(h.host.ready).toBe(false);
  });

  it("sends the tool input and then the result once the view says it is initialized", () => {
    h.host.handle({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    expect(h.host.ready).toBe(true);
    expect(h.posted.map((m) => m.method)).toEqual([
      "ui/notifications/tool-input",
      "ui/notifications/tool-result",
    ]);
    expect(h.posted[0].params).toEqual({ arguments: record.input });
    expect(h.posted[1].params).toEqual(record.result);
    // a second initialized is not a second delivery
    h.host.handle({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    expect(h.posted).toHaveLength(2);
  });

  it("relays tools/call and answers with what the server returned", async () => {
    h.host.handle({
      jsonrpc: "2.0",
      id: "c1",
      method: "tools/call",
      params: { name: "get_plot_data", arguments: { api_version: 1 } },
    });
    await flush();
    expect(h.callTool).toHaveBeenCalledWith("get_plot_data", { api_version: 1 });
    expect(h.posted[0]).toEqual({
      jsonrpc: "2.0",
      id: "c1",
      result: { content: [{ type: "text", text: "get_plot_data" }] },
    });
  });

  it("turns a failed relay into a JSON-RPC error rather than silence", async () => {
    h.callTool.mockRejectedValueOnce(new Error("HTTP 403"));
    h.host.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "x" } });
    await flush();
    expect(h.posted[0].error).toEqual({ code: -32000, message: "HTTP 403" });
    h.host.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: {} });
    await flush();
    expect(h.posted[1].error.code).toBe(-32602);
  });

  it("opens http(s) links only", async () => {
    h.host.handle({ jsonrpc: "2.0", id: 4, method: "ui/open-link", params: { url: "https://depmap.org/x" } });
    h.host.handle({ jsonrpc: "2.0", id: 5, method: "ui/open-link", params: { url: "javascript:alert(1)" } });
    await flush();
    expect(h.onOpenLink).toHaveBeenCalledTimes(1);
    expect(h.onOpenLink).toHaveBeenCalledWith("https://depmap.org/x");
    expect(h.posted.find((m) => m.id === 4).result).toEqual({});
    expect(h.posted.find((m) => m.id === 5).error.code).toBe(-32602);
  });

  it("passes a size change on and refuses what it does not support", async () => {
    h.host.handle({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: 512 } });
    expect(h.onSize).toHaveBeenCalledWith({ width: undefined, height: 512 });
    h.host.handle({ jsonrpc: "2.0", id: 6, method: "resources/read", params: { uri: "ui://x" } });
    h.host.handle({ jsonrpc: "2.0", id: 7, method: "ui/request-display-mode", params: { mode: "fullscreen" } });
    h.host.handle({ jsonrpc: "2.0", id: 8, method: "ping" });
    await flush();
    expect(h.posted.find((m) => m.id === 6).error.code).toBe(-32601);
    expect(h.posted.find((m) => m.id === 7).result).toEqual({ mode: "inline" });
    expect(h.posted.find((m) => m.id === 8).result).toEqual({});
  });

  it("ignores what is not JSON-RPC 2.0 and responses to its own requests", () => {
    h.host.handle("hello");
    h.host.handle({ jsonrpc: "1.0", id: 1, method: "ping" });
    h.host.handle({ jsonrpc: "2.0", id: "teardown-1", result: {} });
    expect(h.posted).toHaveLength(0);
  });

  it("hands the view its tool as the server defines it, once the host has it", () => {
    const tool = { name: "show_plot", description: "d", inputSchema: { type: "object", properties: {} } };
    h.host.update({ tool });
    h.host.handle({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} });
    expect(h.posted[0].result.hostContext.toolInfo.tool).toEqual(tool);
  });

  it("tells an initialized view about a context change, and asks it to tear down", () => {
    h.host.update({ theme: "dark" });
    expect(h.posted).toHaveLength(0);
    h.host.handle({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    h.host.update({ theme: "dark" });
    const change = h.posted[2];
    expect(change.method).toBe("ui/notifications/host-context-changed");
    expect(change.params.theme).toBe("dark");
    h.host.teardown("unmount");
    expect(h.posted[3].method).toBe("ui/resource-teardown");
    expect(h.posted[3].params).toEqual({ reason: "unmount" });
  });
});
