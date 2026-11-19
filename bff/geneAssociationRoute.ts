import { gzipSync } from "node:zlib";
import { Router, type Request, type Response } from "express";
import { TtlLruCache } from "./cache.js";
import { config } from "./config.js";
import {
  buildGeneAssociationSummary,
  type SummaryLookups,
  type TraitMeta,
} from "./geneAssociationSummary.js";
import { getDatasets, type RawDataset } from "./normalize.js";
import { UpstreamError, upstreamJson, upstreamTsv } from "./upstream.js";

// the widest window answers in several seconds on a dense locus; the default 30 s leaves no room
// for a loaded API
const UPSTREAM_TIMEOUT_MS = 90_000;

// forwarded into the upstream path, so only what a gene symbol or Ensembl id can hold
const GENE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

interface ResourceMetadataRow {
  phenotype_code: string | number;
  phenotype_string?: string | null;
  trait_type?: string | null;
}

// serialized once and kept in both encodings, so a repeated gene costs a Map lookup and a write
interface Encoded {
  json: Buffer;
  gzip: Buffer;
}
interface CachedBody {
  summary: Encoded;
  setIds: Encoded;
}

const encode = (value: unknown): Encoded => {
  const json = Buffer.from(JSON.stringify(value));
  return { json, gzip: gzipSync(json) };
};

/**
 * Whether a dataset's credible sets are pseudo, and the trait type all of its traits share. Both
 * are per dataset and one resource can hold several, so the dataset label decides; a /v1/datasets
 * row without a label speaks for its whole resource.
 */
export const datasetLookups = (
  datasets: RawDataset[]
): Pick<SummaryLookups, "isPseudo" | "datasetTraitType"> => {
  const pseudo = new Map<string, boolean>();
  const types = new Map<string, Set<string>>();
  for (const d of datasets) {
    // a resource's QTL datasets say nothing about its GWAS traits
    if (d.data_type !== "gwas") continue;
    const key = d.dataset ? `${d.resource}|${d.dataset}` : d.resource;
    pseudo.set(key, (pseudo.get(key) ?? false) || d.pseudo_credible_sets === true);
    types.set(key, (types.get(key) ?? new Set()).add(d.trait_type ?? ""));
  }
  const find = <T>(map: Map<string, T>, resource: string, dataset: string): T | undefined =>
    map.get(`${resource}|${dataset}`) ?? map.get(resource);
  return {
    isPseudo: (resource, dataset) => find(pseudo, resource, dataset) ?? false,
    datasetTraitType: (resource, dataset) => {
      const found = find(types, resource, dataset);
      const only = found?.size === 1 ? [...found][0] : null;
      return only === "binary" || only === "quantitative" ? only : null;
    },
  };
};

/**
 * The GWAS credible sets around a gene, shaped for the variant association tab: grouped per set,
 * dictionary-encoded, trait names and types and the pseudo flag joined in, and no per-member
 * statistics — a set's members are fetched from /v1/credible_sets_by_id when its row is opened.
 *
 * GET /v1/gene_association/PCSK9?window=500000
 * GET /v1/gene_association/PCSK9/set_ids?window=500000   the sets' ids, see GeneAssociationSetIds
 * 404 when the API does not know the gene. A gene with no credible sets is served with empty columns.
 */
export const createGeneAssociationRoute = (): Router => {
  const router = Router();
  const bodies = new TtlLruCache<CachedBody>(
    config.geneAssociationCacheMax,
    config.resultsCacheTtlMs
  );
  // a resource's whole phenotype list, several MB upstream and a few hundred KB here
  const metadata = new TtlLruCache<Map<string, TraitMeta>>(
    config.geneAssociationCacheMax,
    config.resultsCacheTtlMs
  );
  // requests that arrive while one is being assembled share its work
  const pendingBodies = new Map<string, Promise<CachedBody>>();
  const pendingMetadata = new Map<string, Promise<Map<string, TraitMeta>>>();

  const shared = <T>(pending: Map<string, Promise<T>>, key: string, run: () => Promise<T>) => {
    let p = pending.get(key);
    if (!p) {
      p = run().finally(() => pending.delete(key));
      pending.set(key, p);
    }
    return p;
  };

  const resourceMetadata = async (resource: string): Promise<Map<string, TraitMeta>> => {
    const cached = metadata.get(resource);
    if (cached) return cached;
    return shared(pendingMetadata, resource, async () => {
      const out = new Map<string, TraitMeta>();
      try {
        const rows = await upstreamJson<ResourceMetadataRow[]>(
          `/v1/resource_metadata/${encodeURIComponent(resource)}`,
          { query: { format: "json" }, timeoutMs: UPSTREAM_TIMEOUT_MS }
        );
        for (const row of rows ?? []) {
          out.set(String(row.phenotype_code), {
            name: row.phenotype_string ?? "",
            traitType: row.trait_type ?? null,
          });
        }
      } catch (err) {
        // a resource without harmonized metadata answers 404: no names or types, not a failure.
        // anything else is not cached, so the next gene asks again
        if (!(err instanceof UpstreamError) || err.status !== 404) {
          console.error(`[bff] resource metadata for ${resource}:`, err);
          return out;
        }
      }
      metadata.set(resource, out);
      return out;
    });
  };

  const assemble = async (gene: string, window: number): Promise<CachedBody> => {
    const [rows, datasets] = await Promise.all([
      upstreamTsv(`/v1/credible_sets_by_gene/${encodeURIComponent(gene)}`, {
        query: { window, data_types: "GWAS" },
        timeoutMs: UPSTREAM_TIMEOUT_MS,
      }),
      getDatasets(),
    ]);
    const resources = [...new Set(rows.map((r) => r.resource ?? ""))];
    const maps = await Promise.all(resources.map(resourceMetadata));
    const { summary, setIds } = buildGeneAssociationSummary(gene, window, rows, {
      traitMeta: new Map(resources.map((r, i) => [r, maps[i]])),
      ...datasetLookups(datasets),
    });
    return { summary: encode(summary), setIds: encode(setIds) };
  };

  const serve =
    (part: keyof CachedBody) =>
    async (req: Request, res: Response): Promise<void> => {
      const gene = req.params.gene;
      const window = req.query.window === undefined ? 0 : Number(req.query.window);
      if (!GENE_RE.test(gene)) {
        res.status(400).json({ error: "bad_request", message: "not a gene symbol" });
        return;
      }
      if (!Number.isInteger(window) || window < 0 || window > config.geneAssociationMaxWindow) {
        res.status(400).json({
          error: "bad_request",
          message: `'window' must be an integer from 0 to ${config.geneAssociationMaxWindow}`,
        });
        return;
      }

      const key = `${gene}|${window}`;
      try {
        let body = bodies.get(key);
        if (!body) {
          body = await shared(pendingBodies, key, () => assemble(gene, window));
          bodies.set(key, body);
        }
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Vary", "Accept-Encoding");
        if (req.acceptsEncodings("gzip")) {
          res.setHeader("Content-Encoding", "gzip");
          res.send(body[part].gzip);
        } else {
          res.send(body[part].json);
        }
      } catch (err) {
        if (err instanceof UpstreamError && err.status === 404) {
          res.status(404).json({ error: "not_found", message: `gene ${gene} not found` });
          return;
        }
        console.error(`[bff] gene association for ${gene}:`, err);
        const status = err instanceof UpstreamError ? 502 : 500;
        res.status(status).json({
          error: status === 502 ? "bad_gateway" : "internal_error",
          message: status === 502 ? "upstream genetics-results-api failed" : "request failed",
        });
      }
    };

  router.get("/v1/gene_association/:gene", serve("summary"));
  router.get("/v1/gene_association/:gene/set_ids", serve("setIds"));

  return router;
};
