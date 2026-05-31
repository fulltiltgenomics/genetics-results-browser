import { Router, type Request, type Response } from "express";
import { normalizeGene, normalizeVariantList } from "./normalize.js";
import { UpstreamError } from "./upstream.js";

// shared upstream-error -> HTTP mapping for the stage-1 normalize routes: pass through a 4xx upstream
// status, otherwise collapse connection/timeout/non-JSON failures to 502.
const sendError = (res: Response, err: unknown, label: string): void => {
  if (err instanceof UpstreamError) {
    const status = err.status >= 400 && err.status < 500 ? err.status : 502;
    res.status(status).json({ error: "upstream_error", message: err.message });
    return;
  }
  console.error(`[bff] ${label} normalize error:`, err);
  res.status(500).json({ error: "internal_error", message: "failed to assemble results" });
};

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
      sendError(res, err, "/v1/results");
    }
  });

  /**
   * Stage-1 normalize endpoint for a GENE query (task .10).
   *
   * GET /v1/gene_results/:gene  (optional ?window=<bp>)
   * A gene is a single token (no multi-line text to parse), so a path param is cleaner than the
   * variant path's POST body. The variant path stays POST /v1/results because it carries multi-line
   * input with optional tab-separated beta/value columns. serverQuery's gene hook (task .12) /
   * the gene view (.29) calls GET /v1/gene_results/${gene} and receives the same NormalizedResponse
   * shape, with queryType "gene".
   *
   * Returns a NormalizedResponse: RAW, unfiltered credible-set member variants in the gene region,
   * each with its credible sets + dataset/resource/phenotype metadata.
   */
  router.get("/v1/gene_results/:gene", async (req: Request, res: Response) => {
    const gene = req.params.gene?.trim();
    if (!gene) {
      res.status(400).json({ error: "bad_request", message: "missing gene" });
      return;
    }
    // optional region window (bp); ignore a non-numeric value rather than passing junk upstream
    const windowRaw = req.query.window;
    const windowNum = typeof windowRaw === "string" ? Number(windowRaw) : NaN;
    const window = Number.isFinite(windowNum) ? windowNum : undefined;

    try {
      const normalized = await normalizeGene(gene, window);
      res.json(normalized);
    } catch (err) {
      sendError(res, err, "/v1/gene_results");
    }
  });

  return router;
};
