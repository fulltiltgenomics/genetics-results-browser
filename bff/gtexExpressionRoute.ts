import { Router, type Request, type Response } from "express";
import { TtlLruCache } from "./cache.js";
import { config } from "./config.js";
import type { GtexExpression } from "./geneAnnotationTypes.js";

const GTEX_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 250;
// a gene has one item per tissue, so a second page is already unexpected; the bound only keeps a
// misbehaving upstream from being followed without end
const MAX_PAGES = 5;

// the id travels as a query parameter of fixed paths; the pattern keeps arbitrary text from being
// forwarded and cached
const ENSEMBL_GENE_ID_RE = /^ENSG\d{11}$/;
const RELEASE_RE = /^gtex_(v\d+)$/;

interface GtexDataset {
  datasetId?: unknown;
  gencodeVersion?: unknown;
  genomeBuild?: unknown;
}

interface GtexItem {
  tissueSiteDetailId?: unknown;
  unit?: unknown;
  data?: unknown;
}

interface Paged<T> {
  data?: T[];
  paging_info?: { numberOfPages?: number };
}

interface Release {
  dataset: string;
  release: string;
  gencodeVersion: string;
  genomeBuild: string;
}

/** The newest GTEx analysis release among the datasets the portal lists, or null for none. */
export const newestRelease = (datasets: GtexDataset[]): Release | null => {
  let best: Release | null = null;
  let bestNumber = -1;
  for (const d of datasets) {
    const match = typeof d.datasetId === "string" ? RELEASE_RE.exec(d.datasetId) : null;
    if (!match || typeof d.gencodeVersion !== "string" || typeof d.genomeBuild !== "string") {
      continue;
    }
    const number = Number(match[1].slice(1));
    if (number > bestNumber) {
      bestNumber = number;
      best = {
        dataset: match[0],
        release: match[1],
        gencodeVersion: d.gencodeVersion,
        genomeBuild: d.genomeBuild,
      };
    }
  }
  return best;
};

export const normalizeGtexTissues = (items: GtexItem[]): GtexExpression["tissues"] =>
  items
    .filter((item) => typeof item.tissueSiteDetailId === "string" && Array.isArray(item.data))
    .map((item) => ({
      tissue: item.tissueSiteDetailId as string,
      values: (item.data as unknown[]).filter(
        (v): v is number => typeof v === "number" && Number.isFinite(v)
      ),
    }))
    .filter((t) => t.values.length > 0);

class UpstreamError extends Error {}

/**
 * A gene's expression in every GTEx sample, by tissue, from the GTEx portal's API, for the
 * expression tab. Proxied for the same reason as the mygene.info record: the frontend CSP is
 * `connect-src 'self'`.
 *
 * The release is the newest the portal lists, so the tab follows GTEx without a deploy; the
 * response names it. The portal keys expression by the gene id as versioned in that release's
 * GENCODE, which its own gene reference resolves from the unversioned id.
 *
 * GET /v1/gtex_expression?ensembl_id=ENSG00000169174
 * 404 when that release does not have the gene, or has no expression for it.
 */
export const createGtexExpressionRoute = (): Router => {
  const router = Router();
  const cache = new TtlLruCache<GtexExpression>(
    config.gtexExpressionCacheMax,
    config.geneAnnotationCacheTtlMs
  );
  const releaseCache = new TtlLruCache<Release>(1, config.geneAnnotationCacheTtlMs);

  const getJson = async <T>(
    path: string,
    params: Record<string, string>,
    signal: AbortSignal
  ): Promise<T> => {
    const url = new URL(`${config.gtexApiUrl}/${path}`);
    url.search = new URLSearchParams(params).toString();
    const upstream = await fetch(url, { signal });
    if (!upstream.ok) {
      throw new UpstreamError(`GTEx error ${upstream.status}`);
    }
    return (await upstream.json()) as T;
  };

  router.get("/v1/gtex_expression", async (req: Request, res: Response) => {
    const ensemblId = typeof req.query.ensembl_id === "string" ? req.query.ensembl_id.trim() : "";
    if (!ENSEMBL_GENE_ID_RE.test(ensemblId)) {
      res
        .status(400)
        .json({ error: "bad_request", message: "'ensembl_id' must look like ENSG00000169174" });
      return;
    }

    const cached = cache.get(ensemblId);
    if (cached) {
      res.json(cached);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GTEX_TIMEOUT_MS);
    const { signal } = controller;
    try {
      let release = releaseCache.get("newest");
      if (!release) {
        const found = newestRelease(await getJson<GtexDataset[]>("metadata/dataset", {}, signal));
        if (!found) {
          throw new UpstreamError("GTEx lists no analysis release");
        }
        release = found;
        releaseCache.set("newest", release);
      }

      const genes = await getJson<Paged<{ gencodeId?: unknown }>>(
        "reference/gene",
        {
          geneId: ensemblId,
          gencodeVersion: release.gencodeVersion,
          genomeBuild: release.genomeBuild,
        },
        signal
      );
      const gencodeId = genes.data?.[0]?.gencodeId;
      const items: GtexItem[] = [];
      if (typeof gencodeId === "string") {
        for (let page = 0, pages = 1; page < Math.min(pages, MAX_PAGES); page++) {
          const body = await getJson<Paged<GtexItem>>(
            "expression/geneExpression",
            {
              gencodeId,
              datasetId: release.dataset,
              itemsPerPage: String(PAGE_SIZE),
              page: String(page),
            },
            signal
          );
          items.push(...(body.data ?? []));
          pages = body.paging_info?.numberOfPages ?? 1;
        }
      }
      const tissues = normalizeGtexTissues(items);
      if (typeof gencodeId !== "string" || tissues.length === 0) {
        res.status(404).json({
          error: "not_found",
          message: `no GTEx ${release.release} expression for ${ensemblId}`,
        });
        return;
      }
      const normalized: GtexExpression = {
        ensemblId,
        gencodeId,
        dataset: release.dataset,
        release: release.release,
        unit: typeof items[0]?.unit === "string" ? items[0].unit : "TPM",
        tissues,
      };
      cache.set(ensemblId, normalized);
      res.json(normalized);
    } catch (err) {
      const timedOut = (err as Error)?.name === "AbortError";
      console.error(`[bff] gtex ${timedOut ? "timeout" : "error"} for ${ensemblId}:`, err);
      res.status(timedOut ? 504 : 502).json({
        error: timedOut ? "gateway_timeout" : "bad_gateway",
        message: timedOut
          ? "GTEx timed out"
          : err instanceof UpstreamError
            ? err.message
            : "GTEx unreachable",
      });
    } finally {
      clearTimeout(timer);
    }
  });

  return router;
};
