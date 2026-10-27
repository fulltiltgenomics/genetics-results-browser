import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The MCP App sandbox proxy under the production headers, with no server at all: the chat
 * page and the proxy page are served by route interception under the policies read out of
 * nginx.prod.conf, so a policy change that would stop a view from running fails here.
 *
 * The view is a stand-in: it runs the handshake the real DepMap view runs (ui/initialize,
 * initialized, tool-input, tool-result, tools/call) and reports what it can reach.
 */

const root = path.resolve(__dirname, "..");
const nginx = readFileSync(path.join(root, "nginx.prod.conf"), "utf8");
const PROXY_HTML = readFileSync(path.join(root, "public", "mcp-app-sandbox.html"), "utf8");

const policy = (pattern: RegExp): string => {
  const match = nginx.match(pattern);
  if (!match) throw new Error(`nginx.prod.conf no longer matches ${pattern}`);
  return match[1];
};
const CHAT_CSP = policy(/set \$csp "([^"]+)"/);
const PROXY_CSP = policy(
  /location = \/mcp-app-sandbox\.html \{[\s\S]*?add_header Content-Security-Policy "([^"]+)"/,
);

const VIEW = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>v</title></head><body><div id="r">view</div><script>
  var log = function (m) { window.parent.postMessage({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: m } }, "*"); };
  var id = 0, pending = {};
  function req(method, params) { return new Promise(function (res) { var i = ++id; pending[i] = res; window.parent.postMessage({ jsonrpc: "2.0", id: i, method: method, params: params }, "*"); }); }
  window.addEventListener("message", function (ev) {
    if (ev.source !== window.parent) return;
    var d = ev.data; if (!d || d.jsonrpc !== "2.0") return;
    if (d.id !== undefined && pending[d.id]) { pending[d.id](d); delete pending[d.id]; return; }
    if (d.method === "ui/notifications/tool-input") log("tool-input:" + JSON.stringify(d.params));
    if (d.method === "ui/notifications/tool-result") {
      log("tool-result:" + JSON.stringify(d.params));
      req("tools/call", { name: "get_plot_data", arguments: { api_version: 1 } }).then(function (r) { log("call:" + JSON.stringify(r.result || r.error)); });
      fetch("https://example.com/").then(function () { log("fetch:allowed"); }, function () { log("fetch:blocked"); });
      var cookie; try { cookie = document.cookie; } catch (e) { cookie = "denied"; }
      log("origin:" + window.origin + " cookie:" + cookie);
      var evald; try { evald = new Function("return 6*7")(); } catch (e) { evald = "blocked"; }
      log("eval:" + evald);
    }
  });
  req("ui/initialize", { protocolVersion: "2026-01-26", appInfo: { name: "test-view" }, appCapabilities: {} }).then(function (r) {
    log("init:" + r.result.protocolVersion);
    window.parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, "*");
  });
</script></body></html>`;

// the chat page's side, reduced to what McpAppHost does, served as an external script
// because the chat CSP allows no inline one
const HOST_JS = `
window.__log = [];
var frame = document.getElementById("f");
var post = function (m) { frame.contentWindow.postMessage(m, "*"); };
window.addEventListener("message", function (ev) {
  if (ev.source !== frame.contentWindow) return;
  var d = ev.data; if (!d || d.jsonrpc !== "2.0") return;
  window.__log.push(d);
  if (d.method === "ui/notifications/sandbox-proxy-ready") {
    post({ jsonrpc: "2.0", method: "ui/notifications/sandbox-resource-ready", params: { html: window.__view, csp: { connectDomains: [] } } });
  } else if (d.method === "ui/initialize") {
    post({ jsonrpc: "2.0", id: d.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "h", version: "1" }, hostCapabilities: {}, hostContext: { theme: "light" } } });
  } else if (d.method === "ui/notifications/initialized") {
    post({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { a: 1 } } });
    post({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [{ type: "text", text: "t" }], structuredContent: { p: 1 } } });
  } else if (d.method === "tools/call") {
    post({ jsonrpc: "2.0", id: d.id, result: { content: [{ type: "text", text: "rows" }] } });
  }
});
`;

const TOP = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>top</title></head><body>
<iframe id="f" src="/mcp-app-sandbox.html" sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads" style="width:600px;height:300px"></iframe>
<script src="/view.js"></script><script src="/host.js"></script></body></html>`;

test("the sandbox proxy runs a view under the production policies and keeps it in", async ({ page }) => {
  await page.route("https://chat.test/**", (route) => {
    const { pathname } = new URL(route.request().url());
    const html = (body: string, csp: string, xfo: string) =>
      route.fulfill({ status: 200, headers: { "content-type": "text/html", "content-security-policy": csp, "x-frame-options": xfo }, body });
    const js = (body: string) =>
      route.fulfill({ status: 200, headers: { "content-type": "application/javascript; charset=utf-8" }, body });
    if (pathname === "/") return html(TOP, CHAT_CSP, "DENY");
    if (pathname === "/mcp-app-sandbox.html") return html(PROXY_HTML, PROXY_CSP, "SAMEORIGIN");
    if (pathname === "/host.js") return js(HOST_JS);
    if (pathname === "/view.js") return js(`window.__view = ${JSON.stringify(VIEW)};`);
    return route.fulfill({ status: 404, body: "nope" });
  });
  await page.route("https://example.com/**", (route) => route.fulfill({ status: 200, body: "hi" }));

  await page.goto("https://chat.test/");

  const messages = () =>
    page.evaluate(() =>
      (window as unknown as { __log: { method?: string; params?: { data?: string } }[] }).__log
        .filter((m) => m.method === "notifications/message")
        .map((m) => m.params?.data ?? ""),
    );
  await expect.poll(messages, { timeout: 15_000 }).toHaveLength(7);
  const seen = await messages();

  expect(seen).toContain("init:2026-01-26");
  expect(seen).toContain('tool-input:{"arguments":{"a":1}}');
  expect(seen).toContain('tool-result:{"content":[{"type":"text","text":"t"}],"structuredContent":{"p":1}}');
  expect(seen).toContain('call:{"content":[{"type":"text","text":"rows"}]}');
  // the inner frame has no origin and no reach: cookies and undeclared hosts are refused
  expect(seen).toContain("origin:null cookie:denied");
  expect(seen).toContain("fetch:blocked");
  // and eval, which DepMap's Data Explorer needs, is allowed inside it
  expect(seen).toContain("eval:42");

  // the sandbox-* messages stay between the proxy and the chat page
  const methods = await page.evaluate(() =>
    (window as unknown as { __log: { method?: string }[] }).__log.map((m) => m.method),
  );
  expect(methods.filter((m) => m === "ui/notifications/sandbox-proxy-ready").length).toBeGreaterThanOrEqual(1);
  expect(methods).not.toContain("ui/notifications/sandbox-resource-ready");
});
