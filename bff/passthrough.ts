import { Router, type Request, type Response } from "express";
import { config } from "./config.js";

// headers that must not be copied verbatim between hops: connection-level, length
// (re-derived from the streamed body), and host (must match the upstream origin)
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

const pickForwardHeaders = (incoming: Request["headers"]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(",") : value;
  }
  return out;
};

// thin generic forwarder: stage 1 normalize endpoints (.9/.10/.11) will be added as
// dedicated routes in front of this; for now everything under the mount is passed straight
// through to genetics-results-api so the browser -> BFF -> API path works end to end.
export const createPassthrough = (): Router => {
  const router = Router();

  router.all("/*", async (req: Request, res: Response) => {
    // req.url here is the path *after* the router mount point, e.g. "/v1/resources?x=1"
    const target = `${config.upstreamUrl}${req.url}`;

    const hasBody = req.method !== "GET" && req.method !== "HEAD";

    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers: pickForwardHeaders(req.headers),
        // express.json() already parsed JSON bodies; re-serialize for the upstream
        body: hasBody && req.body !== undefined ? JSON.stringify(req.body) : undefined,
      });

      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        const k = key.toLowerCase();
        // content-length is recomputed by express when we send the buffered body.
        // content-encoding must NOT be forwarded: Node's fetch transparently decompresses the
        // upstream body, so we hold plain bytes — re-advertising "gzip" makes the browser try to
        // gunzip plain JSON and fail with ERR_CONTENT_DECODING_FAILED.
        if (k === "content-length" || k === "content-encoding") return;
        res.setHeader(key, value);
      });

      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    } catch (err) {
      // upstream unreachable / DNS / connection refused -> 502 Bad Gateway
      console.error(`[bff] passthrough error for ${req.method} ${target}:`, err);
      res.status(502).json({ error: "bad_gateway", message: "upstream genetics-results-api unreachable" });
    }
  });

  return router;
};
