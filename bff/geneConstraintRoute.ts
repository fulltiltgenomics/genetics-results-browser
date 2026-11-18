import { Router, type Request, type Response } from "express";
import { TtlLruCache } from "./cache.js";
import { config } from "./config.js";
import type { GeneConstraint } from "./geneAnnotationTypes.js";

const GNOMAD_TIMEOUT_MS = 15_000;

// the id travels as a GraphQL variable, never spliced into the query; the pattern only keeps
// arbitrary text from being forwarded and cached
const ENSEMBL_GENE_ID_RE = /^ENSG\d{11}$/;

const QUERY = `query ($id: String!) {
  gene(gene_id: $id, reference_genome: GRCh38) {
    gnomad_constraint { pLI oe_lof_upper obs_lof obs_mis flags }
    clinvar_variants { clinical_significance }
  }
}`;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

interface GnomadGene {
  gnomad_constraint?: Record<string, unknown> | null;
  clinvar_variants?: { clinical_significance?: string | null }[] | null;
}

// counted on the exact ClinVar classification, so a combined one such as "Pathogenic; risk
// factor" is in none of the three
export const normalizeGnomadGene = (gene: GnomadGene): GeneConstraint => {
  const c = gene.gnomad_constraint ?? {};
  const classified = (label: string) =>
    (gene.clinvar_variants ?? []).filter((v) => v.clinical_significance === label).length;
  return {
    pLI: num(c.pLI),
    loeuf: num(c.oe_lof_upper),
    observedLof: num(c.obs_lof),
    observedMissense: num(c.obs_mis),
    flags: Array.isArray(c.flags) ? c.flags.filter((f): f is string => typeof f === "string") : [],
    clinvar: {
      pathogenic: classified("Pathogenic"),
      pathogenicLikelyPathogenic: classified("Pathogenic/Likely pathogenic"),
      likelyPathogenic: classified("Likely pathogenic"),
    },
  };
};

/**
 * Gene constraint and ClinVar variant counts from the gnomAD browser's GraphQL API, for the gene
 * annotation tab. Proxied for
 * the same reason as the mygene.info record: the frontend CSP is `connect-src 'self'`.
 *
 * GET /v1/gene_constraint?ensembl_id=ENSG00000169174
 * 404 when gnomAD does not know the gene. A gene it knows but has no constraint for is served with
 * null constraint values, since its ClinVar counts still stand.
 */
export const createGeneConstraintRoute = (): Router => {
  const router = Router();
  const cache = new TtlLruCache<GeneConstraint>(
    config.geneAnnotationCacheMax,
    config.geneAnnotationCacheTtlMs
  );

  router.get("/v1/gene_constraint", async (req: Request, res: Response) => {
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
    const timer = setTimeout(() => controller.abort(), GNOMAD_TIMEOUT_MS);
    try {
      const upstream = await fetch(config.gnomadApiUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { id: ensemblId } }),
        signal: controller.signal,
      });
      // an unknown gene is a 200 carrying `errors` and a null gene, so only the status of a
      // broken upstream lands here
      if (!upstream.ok) {
        console.error(`[bff] gnomad upstream ${upstream.status} for ${ensemblId}`);
        res.status(502).json({ error: "bad_gateway", message: `gnomAD error ${upstream.status}` });
        return;
      }
      const body = (await upstream.json()) as { data?: { gene?: GnomadGene | null } };
      const gene = body.data?.gene;
      if (!gene) {
        res.status(404).json({ error: "not_found", message: `no gnomAD record for ${ensemblId}` });
        return;
      }
      const normalized = normalizeGnomadGene(gene);
      cache.set(ensemblId, normalized);
      res.json(normalized);
    } catch (err) {
      const timedOut = (err as Error)?.name === "AbortError";
      console.error(`[bff] gnomad ${timedOut ? "timeout" : "error"} for ${ensemblId}:`, err);
      res.status(timedOut ? 504 : 502).json({
        error: timedOut ? "gateway_timeout" : "bad_gateway",
        message: timedOut ? "gnomAD timed out" : "gnomAD unreachable",
      });
    } finally {
      clearTimeout(timer);
    }
  });

  return router;
};
