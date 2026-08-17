import { Router, type Request, type Response } from "express";
import { config } from "./config.js";

// headers that must not be copied verbatim between hops, in either direction: connection-level
// framing, length (re-derived from the buffered body), and host (must match the upstream origin)
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
        // HOP_BY_HOP covers content-length (recomputed by express for the buffered body) and
        // transfer-encoding: streaming upstream endpoints such as /gene_based/{gene} answer
        // "chunked", and forwarding that alongside express's own Content-Length makes nginx
        // reject the response with 502 ("Content-Length and Transfer-Encoding at the same time").
        // content-encoding must NOT be forwarded either: Node's fetch transparently decompresses
        // the upstream body, so we hold plain bytes — re-advertising "gzip" makes the browser try
        // to gunzip plain JSON and fail with ERR_CONTENT_DECODING_FAILED.
        if (HOP_BY_HOP.has(k) || k === "content-encoding") return;
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
