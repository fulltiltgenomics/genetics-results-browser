import type {
  CredibleSetDataType,
  CredibleSetMembership,
  DatasetDataType,
  DatasetMeta,
  NearestGene,
  NormalizedResponse,
  PhenotypeMeta,
  QtlDataType,
  QuantLevel,
  ResourceMeta,
  VariantAnnotation,
  VariantResult,
} from "../src/types/types.normalized.js";
import { isCoding, isLoF } from "./coding.js";
import { resolveInput } from "./inputParse.js";
import { upstreamJson } from "./upstream.js";

/* ── raw upstream row shapes (snake_case, as captured in src/test/fixtures/*.json) ── */

interface RawCsRow {
  resource: string;
  version: string;
  dataset: string;
  data_type: string;
  trait: string;
  trait_original: string;
  cell_type: string | null;
  chr: number;
  pos: number;
  ref: string;
  alt: string;
  mlog10p: number | null;
  beta: number | null;
  se: number | null;
  pip: number;
  cs_id: string;
  cs_size: number;
  cs_min_r2: number;
  aaf: number;
  most_severe: string;
  gene_most_severe: string | null;
  variant?: string; // sometimes present; otherwise derive from chr/pos/ref/alt
}

interface RawAnnotationRow {
  variant: string; // colon form, e.g. "19:44908684:T:C"
  rsid: string | null;
  most_severe: string;
  gene_most_severe: string | null;
  AF?: string | null;
  INFO?: string | null;
  EXOME_enrichment_nfe?: string | null;
  GENOME_enrichment_nfe?: string | null;
}

interface RawNearestGene {
  gene_name: string;
  distance: number;
  gene_start: number;
  gene_end: number;
  gene_strand: "+" | "-";
  variant: string; // dash form, e.g. "19-44908684-T-C"
}

interface RawDataset {
  dataset_id: string;
  resource: string;
  version?: string;
  description?: string;
  data_type: DatasetDataType;
  qtl_types?: string[];
  tissue_label?: string | null;
  cell_type?: string | null;
  quant_method?: string | null;
  n_samples?: number;
  // /datasets per-dataset capability flags; summary_stats is the authoritative sumstats signal
  // (e.g. eqtl_catalogue is data_type "mixed" but has NO summary_stats — full sumstats unavailable)
  products?: {
    summary_stats?: boolean;
    credible_sets?: boolean;
    colocalization?: unknown;
  };
}

/* ── helpers ── */

const toColon = (v: string): string => v.replace(/-/g, ":");

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

// the eQTL Catalogue quant level is the suffix after the last "|" of trait_original
// ("ENSG..._19_45068055_45068058|exon" -> "exon"); only these tokens are valid levels.
const QUANT_LEVELS: ReadonlySet<string> = new Set(["ge", "exon", "tx", "txrev", "leafcutter"]);
const parseQuantLevel = (traitOriginal: string): QuantLevel | null => {
  const idx = traitOriginal.lastIndexOf("|");
  if (idx === -1) return null;
  const suffix = traitOriginal.slice(idx + 1);
  return QUANT_LEVELS.has(suffix) ? (suffix as QuantLevel) : null;
};

// /datasets + CS rows emit canonical-cased CS data_type ("GWAS","eQTL",...) directly; pass through.
const asCredibleSetDataType = (dt: string): CredibleSetDataType => dt as CredibleSetDataType;

const variantIdFromCsRow = (r: RawCsRow): string =>
  r.variant ? toColon(r.variant) : `${r.chr}:${r.pos}:${r.ref}:${r.alt}`;

const normalizeCsRow = (r: RawCsRow): CredibleSetMembership => ({
  resource: r.resource,
  version: r.version,
  dataset: r.dataset,
  dataType: asCredibleSetDataType(r.data_type),
  trait: r.trait,
  traitOriginal: r.trait_original,
  quantLevel: parseQuantLevel(r.trait_original),
  cellType: r.cell_type,
  chr: r.chr,
  pos: r.pos,
  ref: r.ref,
  alt: r.alt,
  csId: r.cs_id,
  csSize: r.cs_size,
  csMinR2: r.cs_min_r2,
  // keep se/mlog10p null where upstream sends null (open_targets rows); coerce beta to a number
  mlog10p: toNum(r.mlog10p),
  beta: toNum(r.beta) ?? 0,
  se: toNum(r.se),
  pip: toNum(r.pip) ?? 0,
  aaf: toNum(r.aaf) ?? 0,
  mostSevere: r.most_severe,
  geneMostSevere: r.gene_most_severe,
});

// consequence per type comment: normalized lowercase with spaces ("missense variant")
const normalizeConsequence = (mostSevere: string): string =>
  mostSevere.toLowerCase().replace(/_/g, " ");

const normalizeAnnotation = (r: RawAnnotationRow | undefined, fallbackFromCs?: RawCsRow): VariantAnnotation => {
  const mostSevere = r?.most_severe ?? fallbackFromCs?.most_severe ?? "";
  return {
    rsid: r?.rsid ?? null,
    consequence: normalizeConsequence(mostSevere),
    isCoding: mostSevere ? isCoding(mostSevere) : false,
    isLoF: mostSevere ? isLoF(mostSevere) : false,
    gene: r?.gene_most_severe ?? fallbackFromCs?.gene_most_severe ?? null,
    af: toNum(r?.AF),
    info: toNum(r?.INFO),
    enrichmentNfe: toNum(r?.GENOME_enrichment_nfe ?? r?.EXOME_enrichment_nfe),
  };
};

const normalizeNearestGene = (r: RawNearestGene): NearestGene => ({
  geneName: r.gene_name,
  distance: r.distance,
  geneStart: r.gene_start,
  geneEnd: r.gene_end,
  geneStrand: r.gene_strand,
});

/* ── fan-out + assembly ── */

const QTL_TOKENS: ReadonlySet<string> = new Set([
  "eQTL",
  "pQTL",
  "sQTL",
  "caQTL",
  "edQTL",
  "metaboQTL",
]);

// /datasets gives data_type + qtl_types per resource; cross-reference to derive ResourceMeta
// (raw /resources has no data_types / has_summary_stats — see types.normalized.ts ResourceMeta).
const deriveResources = (datasets: RawDataset[]): ResourceMeta[] => {
  const byResource = new Map<string, { dataTypes: Set<DatasetDataType>; hasSummaryStats: boolean }>();
  for (const d of datasets) {
    const entry = byResource.get(d.resource) ?? { dataTypes: new Set(), hasSummaryStats: false };
    entry.dataTypes.add(d.data_type);
    // authoritative sumstats signal: a resource has summary stats iff ANY of its datasets declares
    // products.summary_stats === true (data_type is unreliable, e.g. eqtl_catalogue "mixed" has none).
    // the phenotype-search view later refines this per phenotype via /search has_summary_stats.
    if (d.products?.summary_stats === true) entry.hasSummaryStats = true;
    byResource.set(d.resource, entry);
  }
  return [...byResource.entries()].map(([resource, { dataTypes, hasSummaryStats }]) => ({
    id: resource,
    resource,
    dataTypes: [...dataTypes],
    hasSummaryStats,
  }));
};

const normalizeDatasets = (datasets: RawDataset[]): Record<string, DatasetMeta> => {
  const out: Record<string, DatasetMeta> = {};
  for (const d of datasets) {
    out[d.dataset_id] = {
      datasetId: d.dataset_id,
      resource: d.resource,
      dataType: d.data_type,
      version: d.version,
      description: d.description,
      qtlTypes: (d.qtl_types ?? []).filter((t) => QTL_TOKENS.has(t)) as QtlDataType[],
      tissueLabel: d.tissue_label ?? null,
      cellType: d.cell_type ?? null,
      quantMethod: d.quant_method ?? null,
      sampleSize: d.n_samples,
    };
  }
  return out;
};

// PhenotypeMeta keyed by `${resource}|${trait}`. genetics-results-api has no bulk phenostring
// endpoint for an arbitrary trait set, so we seed entries from the CS rows present (phenostring
// defaults to the trait id) — the phenotype-search view (/search) enriches names on demand later.
const derivePhenotypes = (csRows: RawCsRow[]): Record<string, PhenotypeMeta> => {
  const out: Record<string, PhenotypeMeta> = {};
  for (const r of csRows) {
    const key = `${r.resource}|${r.trait}`;
    if (out[key]) continue;
    out[key] = {
      resource: r.resource,
      dataType: asCredibleSetDataType(r.data_type),
      trait: r.trait,
      phenostring: r.trait, // no upstream name lookup for arbitrary traits; trait id is the fallback
    };
  }
  return out;
};

/**
 * Stage-1 normalize for a variant list. Fans out the granular genetics-results-api endpoints
 * concurrently and assembles a NormalizedResponse with RAW, unfiltered credible-set memberships
 * per input variant plus annotation, nearest gene, and dataset/resource/phenotype metadata.
 * NO filtering/grouping/summarizing — that stays client-side (munge, later tasks).
 */
export const normalizeVariantList = async (query: string): Promise<NormalizedResponse> => {
  const resolved = await resolveInput(query);
  const { variantIds, rsidMap, notFound, unparsed, betaByVariant, valueByVariant } = resolved;

  // newline-separated STRING body for credible_sets_by_variant + nearest_genes (fixtures/README gotcha);
  // variant_annotation/finngen is the exception and takes a JSON array.
  const variantsNewline = variantIds.join("\n");

  // independent fan-out runs concurrently; datasets/resources are query-independent metadata.
  const [csRaw, annoRaw, genesRaw, datasetsRaw] = await Promise.all([
    variantIds.length
      ? upstreamJson<RawCsRow[]>("/v1/credible_sets_by_variant", {
          method: "POST",
          query: { format: "json" },
          body: { variants: variantsNewline },
        })
      : Promise.resolve<RawCsRow[]>([]),
    variantIds.length
      ? upstreamJson<RawAnnotationRow[]>("/v1/variant_annotation/finngen", {
          method: "POST",
          query: { format: "json" },
          body: { variants: variantIds }, // JSON ARRAY exception
        })
      : Promise.resolve<RawAnnotationRow[]>([]),
    variantIds.length
      ? upstreamJson<RawNearestGene[]>("/v1/nearest_genes", {
          method: "POST",
          query: { format: "json", n: 1 },
          body: { variants: variantsNewline },
        })
      : Promise.resolve<RawNearestGene[]>([]),
    upstreamJson<RawDataset[]>("/v1/datasets"),
  ]);

  const csRows = csRaw ?? [];
  const annoRows = annoRaw ?? [];
  const genesRows = genesRaw ?? [];
  const datasets = datasetsRaw ?? [];

  // index raw rows by canonical variant id
  const csByVariant = new Map<string, RawCsRow[]>();
  for (const r of csRows) {
    const vid = variantIdFromCsRow(r);
    (csByVariant.get(vid) ?? csByVariant.set(vid, []).get(vid)!).push(r);
  }
  const annoByVariant = new Map<string, RawAnnotationRow>();
  for (const r of annoRows) annoByVariant.set(toColon(r.variant), r);
  const nearestByVariant = new Map<string, NearestGene[]>();
  for (const r of genesRows) {
    const vid = toColon(r.variant);
    (nearestByVariant.get(vid) ?? nearestByVariant.set(vid, []).get(vid)!).push(
      normalizeNearestGene(r)
    );
  }

  const variants: VariantResult[] = variantIds.map((vid) => {
    const rows = csByVariant.get(vid) ?? [];
    const result: VariantResult = {
      variant: vid,
      annotation: normalizeAnnotation(annoByVariant.get(vid), rows[0]),
      credibleSets: rows.map(normalizeCsRow),
    };
    const nearest = nearestByVariant.get(vid);
    if (nearest?.length) result.nearestGenes = nearest;
    if (betaByVariant[vid] !== undefined) result.beta = betaByVariant[vid];
    if (valueByVariant[vid] !== undefined) result.value = valueByVariant[vid];
    return result;
  });

  return {
    queryType: "variant",
    inputVariants: {
      found: variantIds,
      notFound,
      unparsed,
      ac0: [], // ac0 (allele-count-zero) flagging is not derivable from these endpoints
      rsidMap,
    },
    variants,
    phenotypes: derivePhenotypes(csRows),
    datasets: normalizeDatasets(datasets),
    resources: deriveResources(datasets),
    hasBetas: Object.keys(betaByVariant).length > 0,
    hasCustomValues: Object.keys(valueByVariant).length > 0,
    meta: {
      apiVersions: {},
      generatedAt: new Date().toISOString(),
    },
  };
};
