import { Box, Typography, useTheme } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import type { McpAppRecord } from "../mcpAppMarker";
import { McpAppHost } from "./appHost";
import { callAppTool, fetchAppView, type AppView } from "./mcpAppsApi";

/** the proxy page the browser image serves beside index.html; see public/ */
const SANDBOX_PAGE = `${import.meta.env.BASE_URL}mcp-app-sandbox.html`;
const SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads";

const MIN_HEIGHT = 160;
const MAX_HEIGHT = 1200;
const INITIAL_HEIGHT = 420;

const clampHeight = (height: number) => Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(height)));

/**
 * One MCP App view: the result of an external tool, drawn by HTML the tool's own server
 * serves, in a frame that cannot reach this page.
 *
 * The frame holds the sandbox proxy page, not the view: a document written with srcdoc
 * inherits the writer's CSP, and this page's forbids inline scripts, so the proxy — a page
 * with its own, looser policy and an opaque origin — writes the view instead and relays
 * every message. The view then gets the tool's input and result through McpAppHost, and
 * asks for its data through the chat backend, under the same login the model's call used.
 *
 * Rendered from the stored record alone, so a reopened session shows the same view the
 * live stream did; the HTML is fetched again, which is the one thing the record does not
 * carry.
 */
export const McpAppFrame = ({ record }: { record: McpAppRecord }) => {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const hostRef = useRef<McpAppHost | null>(null);
  const proxyReadyRef = useRef(false);
  const viewRef = useRef<AppView | null>(null);
  const [view, setView] = useState<AppView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(INITIAL_HEIGHT);

  useEffect(() => {
    let cancelled = false;
    fetchAppView(record.tool).then(
      (fetched) => {
        if (cancelled) return;
        viewRef.current = fetched;
        setView(fetched);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [record.tool]);

  // one host per mounted frame, torn down with it
  useEffect(() => {
    const post = (message: unknown) => frameRef.current?.contentWindow?.postMessage(message, "*");
    const host = new McpAppHost({
      record,
      hostInfo: { name: "genetics-results-browser", version: "1" },
      context: {
        theme: theme.palette.mode,
        width: containerRef.current?.clientWidth ?? 800,
        maxHeight: MAX_HEIGHT,
      },
      post,
      callTool: (name, args) => callAppTool(record.tool, name, args),
      onSize: ({ height: wanted }) => {
        if (wanted !== undefined) setHeight(clampHeight(wanted));
      },
      onOpenLink: (url) => {
        window.open(url, "_blank", "noopener,noreferrer");
      },
      log: (message, detail) => {
        if (import.meta.env.DEV) console.debug(`[mcp-app ${record.tool}] ${message}`, detail ?? "");
      },
    });
    hostRef.current = host;

    const sendResource = () => {
      const current = viewRef.current;
      if (!current || !proxyReadyRef.current) return;
      post({
        jsonrpc: "2.0",
        method: "ui/notifications/sandbox-resource-ready",
        params: {
          html: current.html,
          sandbox: SANDBOX,
          csp: current.ui?.csp,
          permissions: current.ui?.permissions,
        },
      });
    };

    const onMessage = (event: MessageEvent) => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object" || data.jsonrpc !== "2.0") return;
      if (data.method === "ui/notifications/sandbox-proxy-ready") {
        proxyReadyRef.current = true;
        sendResource();
        return;
      }
      host.handle(data);
    };
    // the frame is only rendered once the view has arrived, so the proxy's ready
    // notification always finds it
    window.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("message", onMessage);
      host.teardown("unmount");
      hostRef.current = null;
      proxyReadyRef.current = false;
    };
    // the record is what the marker decoded, stable for the message's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, record.tool]);

  useEffect(() => {
    hostRef.current?.update({ theme: theme.palette.mode });
  }, [theme.palette.mode]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      hostRef.current?.update({ width: element.clientWidth });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const border = `1px solid ${theme.palette.divider}`;
  return (
    <Box ref={containerRef} sx={{ my: 2, border, borderRadius: 1, overflow: "hidden" }}>
      <Box
        sx={{
          px: 1,
          py: 0.5,
          borderBottom: border,
          bgcolor: theme.palette.mode === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
        }}>
        <Typography variant="caption" color="text.secondary">
          Interactive view from the tool&apos;s server, shown in a sandbox · {record.tool}
        </Typography>
      </Box>
      {error ? (
        <Typography variant="body2" color="error" sx={{ p: 1 }}>
          The view could not be loaded: {error}
        </Typography>
      ) : (
        <>
          {!view && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
              Loading the view…
            </Typography>
          )}
          {view && (
            <iframe
              ref={frameRef}
              src={SANDBOX_PAGE}
              sandbox={SANDBOX}
              title={`${record.tool} view`}
              style={{ display: "block", width: "100%", height, border: 0 }}
            />
          )}
        </>
      )}
    </Box>
  );
};
