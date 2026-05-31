import { Router, type Request, type Response } from "express";
import { normalizeVariantList } from "./normalize.js";
import { UpstreamError } from "./upstream.js";

/**
 * Stage-1 normalize endpoint for a variant list.
 *
 * POST /v1/results  body { query: string }   (mirrors the legacy /v1/results contract so the
 * serverQuery rewrite in task .12 keeps the same request shape; the gene path is task .10).
 * `query` is the raw multi-line input text the UI produces — variant ids and/or rsids, with
 * optional tab-separated beta and custom value columns.
 *
 * Returns a NormalizedResponse (src/types/types.normalized.ts): RAW, unfiltered credible sets
 * per variant + annotation + nearest gene + dataset/resource/phenotype metadata.
 */
export const createVariantsRoute = (): Router => {
  const router = Router();

  router.post("/v1/results", async (req: Request, res: Response) => {
    // express.json() defaults req.body to {} for empty/non-JSON POSTs (.8 review); validate explicitly
    const body = req.body as { query?: unknown } | undefined;
    const query = typeof body?.query === "string" ? body.query : "";
    if (query.trim() === "") {
      res.status(400).json({ error: "bad_request", message: "missing or empty 'query' string" });
      return;
    }

    try {
      const normalized = await normalizeVariantList(query);
      res.json(normalized);
    } catch (err) {
      if (err instanceof UpstreamError) {
        // 502 for connection/timeout/non-JSON; pass through a 4xx upstream status otherwise
        const status = err.status >= 400 && err.status < 500 ? err.status : 502;
        res.status(status).json({ error: "upstream_error", message: err.message });
        return;
      }
      console.error("[bff] /v1/results normalize error:", err);
      res.status(500).json({ error: "internal_error", message: "failed to assemble results" });
    }
  });

  return router;
};
