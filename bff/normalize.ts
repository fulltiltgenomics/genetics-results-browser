import type {
  CredibleSetDataType,
  CredibleSetMembership,
  DatasetDataType,
  DatasetMeta,
  GeneTarget,
  GnomadConsequence,
  GnomadFreq,
  GnomadPop,
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
import { maybeExpandPhenotypeLeads, maybeExpandVariantSet, resolveInput } from "./inputParse.js";
import { fetchBatched, Semaphore, withRetry } from "./batch.js";
import { upstreamJson, UpstreamError } from "./upstream.js";

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
  // true when the dataset's credible sets are PSEUDO (approximate, LD-based) rather than formally
  // fine-mapped (SuSiE/FINEMAP). set on meta-analysis datasets (finngen_mvp_ukbb, finngen_ukbb) and
  // external GWAS (pgc/gp2/ibd_gwas/covid_hgi). always paired with products.credible_sets === true.
  pseudo_credible_sets?: boolean;
}

// gnomad rows from POST variant_annotation/gnomad (JSON array body, like finngen). all fields are
// strings; AF_* are in scientific notation (e.g. "1.4757e-01"). genome_or_exome is "g"/"e" and a
// variant may yield TWO rows (genomes + exomes) which the BFF merges into one GnomadFreq.
interface RawGnomadRow {
  chr: string;
  pos: string;
  ref: string;
  alt: string;
  AN: string;
  AF: string;
  AF_afr?: string;
  AF_amr?: string;
  AF_asj?: string;
  AF_eas?: string;
  AF_fin?: string;
  AF_mid?: string;
  AF_nfe?: string;
  AF_remaining?: string;
  AF_sas?: string;
  genome_or_exome: "g" | "e";
  // per-gene VEP consequences, a JSON-ENCODED STRING in the format=json response (the API keeps the
  // column raw), e.g. '[{"gene_symbol":"APOE","consequences":["missense_variant"], ...}]'.
  consequences?: string | null;
}

interface RawGnomadConsequence {
  gene_symbol?: string | null;
  consequences?: string[] | null;
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
const QUANT_LEVELS: ReadonlySet<string> = new Set(["ge", "exon", "tx", "txrev", "leafcutter", "majiq"]);
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

const GNOMAD_POPS: readonly GnomadPop[] = [
  "afr",
  "amr",
  "asj",
  "eas",
  "fin",
  "mid",
  "nfe",
  "remaining",
  "sas",
];

const gnomadVariantId = (r: RawGnomadRow): string => `${r.chr}:${r.pos}:${r.ref}:${r.alt}`;

// merge the genome+exome duplicate rows for one variant into a single GnomadFreq. we prefer the row
// with the larger AN (allele number = the larger genotyped cohort, so AF estimates are tighter — and
// it correctly discards AN=0 rows where AF is undefined). popmax is computed here as the max over byPop.
const mergeGnomadRows = (rows: RawGnomadRow[]): GnomadFreq => {
  const chosen = rows.reduce((best, r) => ((toNum(r.AN) ?? 0) > (toNum(best.AN) ?? 0) ? r : best));

  const byPop: Partial<Record<GnomadPop, number>> = {};
  for (const pop of GNOMAD_POPS) {
    // AF_<pop> arrives as a scientific-notation string; absent/NA -> leave the pop out entirely
    const af = toNum((chosen as unknown as Record<string, unknown>)[`AF_${pop}`]);
    if (af !== null) byPop[pop] = af;
  }

  // the per-gene VEP consequences arrive as a JSON-encoded string; parse, then flatten into
  // {gene, consequence} pairs (deduped). best-effort — malformed JSON yields no consequences.
  let rawConsequences: RawGnomadConsequence[] = [];
  if (typeof chosen.consequences === "string" && chosen.consequences.trim() !== "") {
    try {
      const parsed = JSON.parse(chosen.consequences);
      if (Array.isArray(parsed)) rawConsequences = parsed;
    } catch {
      rawConsequences = [];
    }
  }
  const consequences: GnomadConsequence[] = [];
  const seenConsequence = new Set<string>();
  for (const c of rawConsequences) {
    const gene = c?.gene_symbol ?? "";
    for (const cons of c?.consequences ?? []) {
      const key = `${gene}|${cons}`;
      if (seenConsequence.has(key)) continue;
      seenConsequence.add(key);
      consequences.push({ gene, consequence: cons });
    }
  }

  const freq: GnomadFreq = {
    variant: gnomadVariantId(chosen),
    afOverall: toNum(chosen.AF),
    byPop,
    genomeOrExome: chosen.genome_or_exome,
  };
  if (consequences.length) freq.consequences = consequences;

  let popmaxPop: GnomadPop | undefined;
  let popmaxAf = -Infinity;
  for (const pop of GNOMAD_POPS) {
    const af = byPop[pop];
    if (af !== undefined && af > popmaxAf) {
      popmaxAf = af;
      popmaxPop = pop;
    }
  }
  if (popmaxPop !== undefined) {
    freq.popmaxPop = popmaxPop;
    freq.popmaxAf = popmaxAf;
  }
  return freq;
};

// group raw gnomad rows by canonical variant id, merging the g/e duplicates into one GnomadFreq each.
const indexGnomad = (rows: RawGnomadRow[]): Map<string, GnomadFreq> => {
  const byVariant = new Map<string, RawGnomadRow[]>();
  for (const r of rows) {
    const vid = gnomadVariantId(r);
    (byVariant.get(vid) ?? byVariant.set(vid, []).get(vid)!).push(r);
  }
  const out = new Map<string, GnomadFreq>();
  for (const [vid, vrows] of byVariant) out.set(vid, mergeGnomadRows(vrows));
  return out;
};

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
  const byResource = new Map<
    string,
    {
      dataTypes: Set<DatasetDataType>;
      hasSummaryStats: boolean;
      hasCredibleSets: boolean;
      hasRealCs: boolean;
      hasPseudoCs: boolean;
    }
  >();
  for (const d of datasets) {
    const entry =
      byResource.get(d.resource) ??
      { dataTypes: new Set(), hasSummaryStats: false, hasCredibleSets: false, hasRealCs: false, hasPseudoCs: false };
    entry.dataTypes.add(d.data_type);
    // authoritative sumstats signal: a resource has summary stats iff ANY of its datasets declares
    // products.summary_stats === true (data_type is unreliable, e.g. eqtl_catalogue "mixed" has none).
    // the phenotype-search view later refines this per phenotype via /search has_summary_stats.
    if (d.products?.summary_stats === true) entry.hasSummaryStats = true;
    // credible-set capability + whether those CS are pseudo (always paired with credible_sets === true).
    if (d.products?.credible_sets === true) {
      entry.hasCredibleSets = true;
      if (d.pseudo_credible_sets === true) entry.hasPseudoCs = true;
      else entry.hasRealCs = true;
    }
    byResource.set(d.resource, entry);
  }
  return [...byResource.entries()].map(([resource, e]) => ({
    id: resource,
    resource,
    dataTypes: [...e.dataTypes],
    hasSummaryStats: e.hasSummaryStats,
    hasCredibleSets: e.hasCredibleSets,
    // a resource is flagged pseudo only when it has pseudo CS and NO formally fine-mapped CS dataset
    // (the pseudo resources — finngen_mvp_ukbb/finngen_ukbb/pgc/gp2/ibd_gwas/covid_hgi — never mix).
    hasPseudoCredibleSets: e.hasPseudoCs && !e.hasRealCs,
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
      hasSummaryStats: d.products?.summary_stats === true,
    };
  }
  return out;
};

// trait code -> human-readable name, from GET /v1/trait_name_mapping (covers finngen phenocodes,
// Open Targets GCST study ids, ATC drug codes, genebass, etc.). the map is large (~2 MB / ~28k
// entries) and effectively static, so cache it process-wide; name resolution is best-effort, so a
// fetch failure falls back to an empty map (callers then show the raw trait code).
let traitNameMapCache: Record<string, string> | null = null;
const getTraitNameMap = async (): Promise<Record<string, string>> => {
  if (traitNameMapCache) return traitNameMapCache;
  try {
    const m = (await upstreamJson<Record<string, string>>("/v1/trait_name_mapping")) ?? {};
    traitNameMapCache = m;
    return m;
  } catch {
    return {};
  }
};

// PhenotypeMeta keyed by `${resource}|${trait}`. phenostring (the display name) is resolved by the
// trait IDENTIFIER, trait_original — the trait_name_mapping is keyed by the identifier (finngen
// phenocodes like I9_AF, Open Targets GCST ids, ATC codes, lab/OMOP ids), NOT the harmonized `trait`
// (which for FinnGen GWAS is already a display name and for Open Targets is the bare GCST code). Fall
// back to the upstream display name (trait), then the raw identifier, when the map has no entry.
const derivePhenotypes = (
  csRows: RawCsRow[],
  traitNameMap: Record<string, string>
): Record<string, PhenotypeMeta> => {
  const out: Record<string, PhenotypeMeta> = {};
  for (const r of csRows) {
    const key = `${r.resource}|${r.trait}`;
    if (out[key]) continue;
    out[key] = {
      resource: r.resource,
      dataType: asCredibleSetDataType(r.data_type),
      trait: r.trait,
      phenostring: traitNameMap[r.trait_original] ?? r.trait ?? r.trait_original,
    };
  }
  return out;
};

/* ── QTL cis/trans gene-target resolution ──────────────────────────────────────
 * cis/trans needs the QTL molecular feature's coordinates, which the CS rows don't carry. Resolving
 * gene symbols one-by-one via /search is far too slow (~0.4s/gene). Instead resolve BY REGION:
 *   - gene-based QTL (eQTL/pQTL/sQTL/edQTL): the trait IS a gene symbol. A true cis gene is within the
 *     cis window of the variant, so genes_in_region around each variant locus (±CIS_FETCH_MB, generous
 *     vs the typical ≤1.5 Mb window) returns every cis candidate with coords. A trait gene not found in
 *     any variant's region is far → trans (no coords needed for trans).
 *   - caQTL: the trait is an ATAC peak; peak_to_genes returns the regulated gene(s) WITH coords.
 * The client then classifies cis/trans reactively from the adjustable window (munge.normalized).
 */
const GENE_QTL_TYPES: ReadonlySet<string> = new Set(["eQTL", "pQTL", "sQTL", "edQTL"]);
// genes_in_region half-width: comfortably above the typical/legacy cis window (1.5 Mb) so any
// realistic cis gene is fetched; genes beyond this are unambiguously trans at any sane window.
const CIS_FETCH_MB = 2.5;
const PEAK_RESOLVE_CAP = 200; // bound peak_to_genes fan-out on pathological caQTL-heavy queries

interface RawGeneRegionRow {
  gene_name: string;
  chrom: number;
  gene_start: number;
  gene_end: number;
  gene_strand: "+" | "-";
  hgnc_symbol?: string | null;
  hgnc_prev_symbol?: string | null;
}
interface RawPeakGeneRow {
  symbol: string;
  gene_chrom: string; // "chr19"
  gene_start: number;
  gene_end: number;
}

// "chr19" | 19 | "X" -> numeric chromosome matching the CS rows' numeric chr.
const parseChrom = (c: string | number): number => {
  if (typeof c === "number") return c;
  const tok = c.trim().replace(/^chr/i, "").toUpperCase();
  if (tok === "X") return 23;
  if (tok === "Y") return 24;
  if (tok === "MT" || tok === "M") return 25;
  return Number(tok);
};

/**
 * Resolve and attach QTL target genes (+coords) to each membership for cis/trans + caQTL display.
 * Mutates the passed memberships' geneTargets in place. Best-effort: upstream errors leave a
 * membership without geneTargets (the client then treats a gene-based QTL as trans).
 */
const attachGeneTargets = async (variants: VariantResult[]): Promise<void> => {
  const W = CIS_FETCH_MB * 1e6;
  const lociByChrom = new Map<number, Set<number>>();
  const peaks = new Set<string>();
  for (const v of variants) {
    for (const cs of v.credibleSets) {
      if (GENE_QTL_TYPES.has(cs.dataType)) {
        (lociByChrom.get(cs.chr) ?? lociByChrom.set(cs.chr, new Set()).get(cs.chr)!).add(cs.pos);
      } else if (cs.dataType === "caQTL") {
        peaks.add(cs.trait);
      }
    }
  }
  if (lociByChrom.size === 0 && peaks.size === 0) return;

  // merge each chromosome's loci into as few ±W intervals as possible (overlapping windows coalesce).
  const intervals: Array<{ chrom: number; start: number; end: number }> = [];
  for (const [chrom, posSet] of lociByChrom) {
    const sorted = [...posSet].sort((a, b) => a - b);
    let start = sorted[0] - W;
    let end = sorted[0] + W;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - W <= end) end = sorted[i] + W;
      else {
        intervals.push({ chrom, start, end });
        start = sorted[i] - W;
        end = sorted[i] + W;
      }
    }
    intervals.push({ chrom, start, end });
  }

  const sem = new Semaphore(8);
  const geneBySymbol = new Map<string, GeneTarget>();
  const genesByPeak = new Map<string, GeneTarget[]>();

  await Promise.all([
    ...intervals.map((iv) =>
      sem.run(async () => {
        const rows = await upstreamJson<RawGeneRegionRow[]>(
          `/v1/genes_in_region/${iv.chrom}/${Math.max(1, Math.floor(iv.start))}/${Math.ceil(iv.end)}`,
          { query: { format: "json" } }
        ).catch(() => null);
        for (const g of rows ?? []) {
          const target: GeneTarget = {
            symbol: g.gene_name,
            chrom: g.chrom,
            start: g.gene_start,
            end: g.gene_end,
            strand: g.gene_strand,
          };
          // index by gene_name plus HGNC current/previous symbols so a QTL trait symbol from any
          // resource resolves; gene_name wins (set first, never overwritten by an alias key).
          for (const key of [g.gene_name, g.hgnc_symbol, g.hgnc_prev_symbol]) {
            if (key && !geneBySymbol.has(key)) geneBySymbol.set(key, target);
          }
        }
      })
    ),
    ...[...peaks].slice(0, PEAK_RESOLVE_CAP).map((peak) =>
      sem.run(async () => {
        const rows = await upstreamJson<RawPeakGeneRow[]>(
          `/v1/peak_to_genes/${encodeURIComponent(peak)}`,
          { query: { format: "json" } }
        ).catch(() => null);
        const seen = new Set<string>();
        const targets: GeneTarget[] = [];
        for (const r of rows ?? []) {
          if (!r.symbol || seen.has(r.symbol)) continue;
          seen.add(r.symbol);
          targets.push({
            symbol: r.symbol,
            chrom: parseChrom(r.gene_chrom),
            start: r.gene_start,
            end: r.gene_end,
          });
        }
        genesByPeak.set(peak, targets);
      })
    ),
  ]);

  for (const v of variants) {
    for (const cs of v.credibleSets) {
      if (GENE_QTL_TYPES.has(cs.dataType)) {
        const g = geneBySymbol.get(cs.trait);
        if (g) cs.geneTargets = [g];
      } else if (cs.dataType === "caQTL") {
        const gs = genesByPeak.get(cs.trait);
        if (gs && gs.length) cs.geneTargets = gs;
      }
    }
  }
};

/**
 * Stage-1 normalize for a variant list. Fans out the granular genetics-results-api endpoints
 * concurrently and assembles a NormalizedResponse with RAW, unfiltered credible-set memberships
 * per input variant plus annotation, nearest gene, and dataset/resource/phenotype metadata.
 * NO filtering/grouping/summarizing — that stays client-side (munge, later tasks).
 */
export const normalizeVariantList = async (query: string): Promise<NormalizedResponse> => {
  // a "pheno:{resource}:{code}" token expands to that phenotype's credible-set lead variants (with
  // the data's betas); a single named-set token (e.g. "FinnGen_enriched_202505") expands to its
  // curated variant list; everything else flows through unchanged as a normal variant/rsid list.
  const expanded =
    (await maybeExpandPhenotypeLeads(query)) ?? (await maybeExpandVariantSet(query)) ?? query;
  const resolved = await resolveInput(expanded);
  const { variantIds, rsidMap, notFound, unparsed, betaByVariant, valueByVariant } = resolved;

  // the batch endpoints each do one upstream `tabix -R` over all requested variants — optimal per
  // call, but a large list (e.g. FinnGen_enriched_202505, ~900 variants) becomes hundreds of
  // sequential GCS range seeks (gnomAD alone >290s). split into chunks issued concurrently under a
  // shared cap: GCS serves parallel range reads, so wall time drops ~5x. a generous per-chunk timeout
  // still guards a genuinely stuck upstream; small lists are a single chunk and return immediately.
  const CHUNK_SIZE = 100;
  const FANOUT_CONCURRENCY = 8;
  const batchTimeoutMs = 120_000;
  const sem = new Semaphore(FANOUT_CONCURRENCY);

  // many concurrent chunks multiply exposure to TRANSIENT upstream tabix/GCS errors (e.g. a sporadic
  // "Invalid BGZF header" mid-stream read), and Promise.all would fail the whole request on one. retry
  // each chunk on a 5xx/connection error (a fresh tabix attempt clears it); don't retry 4xx.
  const retryServerErrors = (err: unknown): boolean =>
    !(err instanceof UpstreamError) || err.status >= 500;
  const batched = <T>(call: (c: string[]) => Promise<T[] | null>): Promise<T[]> =>
    fetchBatched(variantIds, CHUNK_SIZE, sem, (c) => withRetry(() => call(c), 3, 400, retryServerErrors));

  // independent fan-out runs concurrently; datasets/resources are query-independent metadata.
  const [csRows, annoRows, gnomadRows, genesRows, datasetsRaw, traitNameMap] = await Promise.all([
    batched((c) =>
      upstreamJson<RawCsRow[]>("/v1/credible_sets_by_variant", {
        method: "POST",
        query: { format: "json" },
        body: { variants: c.join("\n") }, // newline STRING body
        timeoutMs: batchTimeoutMs,
      })
    ),
    batched((c) =>
      upstreamJson<RawAnnotationRow[]>("/v1/variant_annotation/finngen", {
        method: "POST",
        query: { format: "json" },
        body: { variants: c }, // JSON ARRAY exception
        timeoutMs: batchTimeoutMs,
      })
    ),
    batched((c) =>
      upstreamJson<RawGnomadRow[]>("/v1/variant_annotation/gnomad", {
        method: "POST",
        query: { format: "json" },
        body: { variants: c }, // JSON ARRAY body, same as the finngen source
        timeoutMs: batchTimeoutMs,
      })
    ),
    batched((c) =>
      upstreamJson<RawNearestGene[]>("/v1/nearest_genes", {
        method: "POST",
        query: { format: "json", n: 1 },
        body: { variants: c.join("\n") }, // newline STRING body
        timeoutMs: batchTimeoutMs,
      })
    ),
    upstreamJson<RawDataset[]>("/v1/datasets"),
    getTraitNameMap(),
  ]);

  const datasets = datasetsRaw ?? [];

  // index raw rows by canonical variant id
  const csByVariant = new Map<string, RawCsRow[]>();
  for (const r of csRows) {
    const vid = variantIdFromCsRow(r);
    (csByVariant.get(vid) ?? csByVariant.set(vid, []).get(vid)!).push(r);
  }
  const annoByVariant = new Map<string, RawAnnotationRow>();
  for (const r of annoRows) annoByVariant.set(toColon(r.variant), r);
  const gnomadByVariant = indexGnomad(gnomadRows);
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
    // variants absent from gnomad get no gnomad field (don't fabricate)
    const gnomad = gnomadByVariant.get(vid);
    if (gnomad) result.gnomad = gnomad;
    if (betaByVariant[vid] !== undefined) result.beta = betaByVariant[vid];
    if (valueByVariant[vid] !== undefined) result.value = valueByVariant[vid];
    return result;
  });

  // resolve QTL cis/trans target genes after the CS rows are assembled (needs the loci + traits).
  await attachGeneTargets(variants);

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
    phenotypes: derivePhenotypes(csRows, traitNameMap),
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

/**
 * Stage-1 normalize for a GENE query (queryType: "gene"), the analogue of normalizeVariantList for
 * the gene view (refactor.md §6 / task .29). Fans out concurrently and assembles the same
 * NormalizedResponse shape so munge.ts and the gene view consume one structure regardless of input.
 *
 * fan-out (concurrent):
 *   - credible_sets_by_gene/{gene}  — RAW CS rows for the gene region (optional ?window)
 *   - datasets                      — DatasetMeta + BFF-derived ResourceMeta (query-independent)
 *
 * the CS rows already carry per-variant most_severe/gene_most_severe/aaf, so we reuse every variant
 * helper from the variant path (normalizeCsRow, parseQuantLevel, toNum null-preservation, the camelCase
 * mappers, derivePhenotypes, normalizeDatasets, deriveResources). the "variants" here are the distinct
 * credible-set member variants in the region: rows are grouped by canonical chr:pos:ref:alt into
 * VariantResult[] with credibleSets per variant, mirroring the variant path's per-variant structure.
 *
 * decisions:
 *   - NO nearest_genes fan-out: the query already names the gene/region, so per-member nearest-gene
 *     lookups add no signal to the gene view (the variant path uses them because the user gives a bare
 *     variant list).
 *   - gnomAD DEFERRED: the variant path attaches gnomAD because the user supplies a discrete variant
 *     list; for a gene the member-variant set is discovered from CS rows and can be large (APOE region),
 *     so a blanket gnomAD batch here is wasteful. the gene view can enrich lazily later (per task .29).
 *     left out rather than fabricated — VariantResult.gnomad stays optional.
 *   - annotation is derived from the CS row fields (most_severe/gene_most_severe) via normalizeAnnotation's
 *     fallback path; rsid/af/info are null because there is no separate variant_annotation fan-out here.
 *
 * NO filtering/grouping/summarizing — that stays client-side (munge, later tasks).
 */
export const normalizeGene = async (
  gene: string,
  window?: number
): Promise<NormalizedResponse> => {
  const [csRaw, datasetsRaw, traitNameMap] = await Promise.all([
    upstreamJson<RawCsRow[]>(`/v1/credible_sets_by_gene/${encodeURIComponent(gene)}`, {
      query: { format: "json", window },
    }),
    upstreamJson<RawDataset[]>("/v1/datasets"),
    getTraitNameMap(),
  ]);

  const csRows = csRaw ?? [];
  const datasets = datasetsRaw ?? [];

  // group rows by canonical variant id, preserving first-seen order so the member list is stable
  const csByVariant = new Map<string, RawCsRow[]>();
  for (const r of csRows) {
    const vid = variantIdFromCsRow(r);
    (csByVariant.get(vid) ?? csByVariant.set(vid, []).get(vid)!).push(r);
  }

  const variants: VariantResult[] = [...csByVariant.entries()].map(([vid, rows]) => ({
    variant: vid,
    // no separate annotation fan-out for the gene path; derive consequence/gene from the CS row
    annotation: normalizeAnnotation(undefined, rows[0]),
    credibleSets: rows.map(normalizeCsRow),
  }));

  await attachGeneTargets(variants);

  return {
    queryType: "gene",
    // a gene query has no parsed variant input; the "found" variants are the discovered CS members
    inputVariants: {
      found: variants.map((v) => v.variant),
      notFound: [],
      unparsed: [],
      ac0: [],
      rsidMap: {},
    },
    variants,
    phenotypes: derivePhenotypes(csRows, traitNameMap),
    datasets: normalizeDatasets(datasets),
    resources: deriveResources(datasets),
    hasBetas: false, // gene queries carry no user-supplied betas/values
    hasCustomValues: false,
    meta: {
      apiVersions: {},
      generatedAt: new Date().toISOString(),
    },
  };
};
