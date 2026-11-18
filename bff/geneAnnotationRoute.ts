import { Router, type Request, type Response } from "express";
import { TtlLruCache } from "./cache.js";
import { config } from "./config.js";
import type { GeneAnnotation, GoTerm } from "./geneAnnotationTypes.js";

const MYGENE_TIMEOUT_MS = 15_000;

// the id is interpolated into the mygene query string, so only its canonical form is let through
const HGNC_ID_RE = /^HGNC:\d+$/;

// only what the annotation tab shows: an unrestricted record is ~150 KB, mostly GeneRIFs
const MYGENE_FIELDS = [
  "symbol",
  "name",
  "summary",
  "map_location",
  "type_of_gene",
  "MIM",
  "entrezgene",
  "ensembl.gene",
  "uniprot.Swiss-Prot",
  "pharmgkb",
  "go",
  "pathway.kegg",
  "pathway.reactome",
  "pathway.wikipathways",
  "interpro",
  "clingen.clinical_validity",
].join(",");

type Json = Record<string, unknown>;

// mygene collapses a one-element list to the bare element, for every multi-valued field
const list = <T>(v: unknown): T[] => (v == null ? [] : Array.isArray(v) ? (v as T[]) : [v as T]);

const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null;

const first = (v: unknown): string | null => str(list<unknown>(v)[0]);

// a term is listed once per evidence code and publication
const goTerms = (v: unknown): GoTerm[] => {
  const byId = new Map<string, GoTerm>();
  for (const t of list<Json>(v)) {
    const id = str(t.id);
    const term = str(t.term);
    if (id && term && !byId.has(id)) {
      byId.set(id, { id, term });
    }
  }
  return [...byId.values()].sort((a, b) => a.term.localeCompare(b.term));
};

export const normalizeMyGeneHit = (hit: Json): GeneAnnotation => {
  const go = (hit.go ?? {}) as Json;
  const pathway = (hit.pathway ?? {}) as Json;
  const pathways = (["kegg", "reactome", "wikipathways"] as const).flatMap((source) =>
    list<Json>(pathway[source]).flatMap((p) => {
      const id = str(p.id);
      // KEGG names carry the organism, which is the same on every row
      const name = str(p.name)?.replace(/ - Homo sapiens \(human\)$/, "");
      return id && name ? [{ source, id, name }] : [];
    })
  );
  return {
    symbol: str(hit.symbol) ?? "",
    name: str(hit.name),
    summary: str(hit.summary),
    cytoband: str(hit.map_location),
    typeOfGene: str(hit.type_of_gene),
    ncbiGeneId: str(hit.entrezgene),
    ensemblGeneId: first(list<Json>(hit.ensembl)[0]?.gene),
    omimId: first(hit.MIM),
    uniprotId: first((hit.uniprot as Json | undefined)?.["Swiss-Prot"]),
    pharmgkbId: first(hit.pharmgkb),
    go: { BP: goTerms(go.BP), MF: goTerms(go.MF), CC: goTerms(go.CC) },
    pathways,
    interpro: list<Json>(hit.interpro).flatMap((d) => {
      const id = str(d.id);
      const desc = str(d.desc);
      return id && desc ? [{ id, desc }] : [];
    }),
    clingen: list<Json>((hit.clingen as Json | undefined)?.clinical_validity).flatMap((c) => {
      const disease = str(c.disease_label);
      const classification = str(c.classification);
      return disease && classification
        ? [
            {
              disease,
              classification,
              modeOfInheritance: str(c.moi),
              report: str(c.online_report),
            },
          ]
        : [];
    }),
  };
};

/**
 * Gene annotation from mygene.info, trimmed to the fields the annotation tab shows.
 *
 * Fetched here rather than from the browser because the frontend CSP is `connect-src 'self'`, and
 * so the answer is cached in one place: a gene's record changes on mygene's release cadence, not
 * between two page views.
 *
 * GET /v1/gene_annotation?hgnc_id=HGNC:20001
 */
export const createGeneAnnotationRoute = (): Router => {
  const router = Router();
  const cache = new TtlLruCache<GeneAnnotation>(
    config.geneAnnotationCacheMax,
    config.geneAnnotationCacheTtlMs
  );

  router.get("/v1/gene_annotation", async (req: Request, res: Response) => {
    const hgncId = typeof req.query.hgnc_id === "string" ? req.query.hgnc_id.trim() : "";
    if (!HGNC_ID_RE.test(hgncId)) {
      res.status(400).json({
        error: "bad_request",
        message: "'hgnc_id' must look like HGNC:20001",
      });
      return;
    }

    const cached = cache.get(hgncId);
    if (cached) {
      res.json(cached);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MYGENE_TIMEOUT_MS);
    try {
      const query = new URLSearchParams({
        q: hgncId,
        species: "human",
        fields: MYGENE_FIELDS,
        size: "1",
      });
      const upstream = await fetch(`${config.myGeneApiUrl}/query?${query.toString()}`, {
        signal: controller.signal,
      });
      if (!upstream.ok) {
        console.error(`[bff] mygene upstream ${upstream.status} for ${hgncId}`);
        res.status(502).json({
          error: "bad_gateway",
          message: `mygene.info error ${upstream.status}`,
        });
        return;
      }
      const body = (await upstream.json()) as { hits?: Json[] };
      const hit = body.hits?.[0];
      if (!hit) {
        res.status(404).json({
          error: "not_found",
          message: `no mygene.info record for ${hgncId}`,
        });
        return;
      }
      const annotation = normalizeMyGeneHit(hit);
      cache.set(hgncId, annotation);
      res.json(annotation);
    } catch (err) {
      const timedOut = (err as Error)?.name === "AbortError";
      console.error(`[bff] mygene ${timedOut ? "timeout" : "error"} for ${hgncId}:`, err);
      res.status(timedOut ? 504 : 502).json({
        error: timedOut ? "gateway_timeout" : "bad_gateway",
        message: timedOut ? "mygene.info timed out" : "mygene.info unreachable",
      });
    } finally {
      clearTimeout(timer);
    }
  });

  return router;
};
