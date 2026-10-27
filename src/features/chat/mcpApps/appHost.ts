/**
 * The host side of the MCP Apps protocol (ext-apps 2026-01-26), for one rendered view.
 *
 * A view is HTML an external tool's server serves, shown in a sandboxed frame. It talks to
 * this page in JSON-RPC over postMessage: it opens with `ui/initialize`, confirms with
 * `ui/notifications/initialized`, and is then told the tool's input and result; anything it
 * wants after that — the data it draws, a link opened, a bigger box — it asks for. Nothing
 * here depends on React or on the frame element, which is what makes it testable with two
 * fake windows.
 *
 * What this host supports is deliberately narrow: the view's own server's tools, via the
 * chat backend; opening http(s) links in a new tab; resizing. A view asking for anything else
 * gets a JSON-RPC error rather than silence, so a view written for a richer host fails where
 * its author can see it.
 */

import type { McpAppRecord, McpCallToolResult } from "../mcpAppMarker";

export const PROTOCOL_VERSION = "2026-01-26";

/** JSON-RPC "method not found" */
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
/** the spec's code for a host refusing or failing a `ui/` request */
const HOST_ERROR = -32000;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | { jsonrpc: "2.0"; id: unknown };

export interface HostContext {
  theme: "light" | "dark";
  /** the frame's width in CSS pixels; a view lays itself out to it */
  width: number;
  maxHeight: number;
}

export interface AppHostOptions {
  record: McpAppRecord;
  /** the host's name and version, reported to the view */
  hostInfo: { name: string; version: string };
  context: HostContext;
  /** sends one message to the view; wired to the frame's window */
  post: (message: unknown) => void;
  /** a tools/call the view makes, relayed to its server; rejects on any failure */
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpCallToolResult>;
  /** the view asked for this many CSS pixels */
  onSize: (size: { width?: number; height?: number }) => void;
  /** the view asked to open a link; http(s) only by the time this is called */
  onOpenLink: (url: string) => void;
  log?: (message: string, detail?: unknown) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export class McpAppHost {
  private initialized = false;
  private teardownId = 0;
  private readonly opts: AppHostOptions;

  constructor(opts: AppHostOptions) {
    this.opts = opts;
  }

  /** whether the view has completed the handshake */
  get ready(): boolean {
    return this.initialized;
  }

  /** the context the view was last told; `update` sends the difference */
  context(): HostContext {
    return this.opts.context;
  }

  /** One message from the frame. The caller has already checked it came from that frame. */
  handle(data: unknown): void {
    if (!isRecord(data) || data.jsonrpc !== "2.0") return;
    const message = data as JsonRpcMessage;
    if (!("method" in message) || typeof message.method !== "string") {
      // a response to a request of ours (teardown); nothing waits on it
      return;
    }
    const params = isRecord(message.params) ? message.params : {};
    if ("id" in message && message.id !== undefined && message.id !== null) {
      void this.request(message.id as number | string, message.method, params);
    } else {
      this.notification(message.method, params);
    }
  }

  /** the host context changed (theme, width); tells the view once it is listening */
  update(context: Partial<HostContext>): void {
    this.opts.context = { ...this.opts.context, ...context };
    if (!this.initialized) return;
    this.notify("ui/notifications/host-context-changed", this.hostContext());
  }

  /** the frame is going away: the spec has the host say so before it does */
  teardown(reason: string): void {
    if (!this.initialized) return;
    this.teardownId += 1;
    this.opts.post({
      jsonrpc: "2.0",
      id: `teardown-${this.teardownId}`,
      method: "ui/resource-teardown",
      params: { reason },
    });
  }

  private hostContext() {
    const { theme, width, maxHeight } = this.opts.context;
    return {
      toolInfo: { id: this.opts.record.id, tool: { name: this.opts.record.tool } },
      theme,
      displayMode: "inline",
      availableDisplayModes: ["inline"],
      containerDimensions: { width, maxHeight },
      locale: typeof navigator === "undefined" ? "en" : navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
      platform: "web",
      deviceCapabilities: {
        touch: typeof navigator !== "undefined" && navigator.maxTouchPoints > 0,
        hover: true,
      },
    };
  }

  private notify(method: string, params: unknown): void {
    this.opts.post({ jsonrpc: "2.0", method, params });
  }

  private respond(id: number | string, result: unknown): void {
    this.opts.post({ jsonrpc: "2.0", id, result });
  }

  private fail(id: number | string, code: number, message: string): void {
    this.opts.log?.(`view request failed: ${message}`);
    this.opts.post({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private notification(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case "ui/notifications/initialized":
        if (this.initialized) return;
        this.initialized = true;
        // the order the spec fixes: input first, then the result it produced
        this.notify("ui/notifications/tool-input", { arguments: this.opts.record.input });
        this.notify("ui/notifications/tool-result", this.opts.record.result);
        return;
      case "ui/notifications/size-changed": {
        const width = typeof params.width === "number" ? params.width : undefined;
        const height = typeof params.height === "number" ? params.height : undefined;
        if (width !== undefined || height !== undefined) this.opts.onSize({ width, height });
        return;
      }
      case "notifications/message":
        this.opts.log?.("view log", params);
        return;
      default:
        this.opts.log?.(`view notification ignored: ${method}`);
    }
  }

  private async request(
    id: number | string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    switch (method) {
      case "ui/initialize":
        this.opts.log?.("view initialising", params);
        this.respond(id, {
          protocolVersion: PROTOCOL_VERSION,
          hostInfo: this.opts.hostInfo,
          hostCapabilities: { serverTools: {}, openLinks: {} },
          hostContext: this.hostContext(),
        });
        return;
      case "ping":
        this.respond(id, {});
        return;
      case "tools/call": {
        const name = params.name;
        if (typeof name !== "string" || name === "") {
          this.fail(id, INVALID_PARAMS, "tools/call needs a name");
          return;
        }
        const args = isRecord(params.arguments) ? params.arguments : {};
        this.opts.log?.(`view calls ${name}`);
        try {
          this.respond(id, await this.opts.callTool(name, args));
        } catch (e) {
          this.fail(id, HOST_ERROR, e instanceof Error ? e.message : String(e));
        }
        return;
      }
      case "ui/open-link": {
        const url = params.url;
        if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
          this.fail(id, INVALID_PARAMS, "only http(s) links can be opened");
          return;
        }
        this.opts.onOpenLink(url);
        this.respond(id, {});
        return;
      }
      case "ui/request-display-mode":
        // inline is the one mode this host has, whatever was asked for
        this.respond(id, { mode: "inline" });
        return;
      case "ui/update-model-context":
        // accepted and dropped: the view's text never reaches the model from here, and the
        // spec lets a host defer it indefinitely
        this.respond(id, {});
        return;
      default:
        this.fail(id, METHOD_NOT_FOUND, `${method} is not supported by this host`);
    }
  }
}
