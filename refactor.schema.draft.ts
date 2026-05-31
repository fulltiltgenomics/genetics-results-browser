/**
 * DRAFT normalized record schema for the refactored variant annotation tool.
 *
 * Not wired into the build yet — this is a design artifact to iterate on before we
 * rewrite src/types/types.ts. Grounded in real responses from genetics-results-api
 * (localhost:2000) captured 2026-05.
 *
 * Two-stage model (see refactor.md §1):
 *   Stage 1  BFF fetch+normalize  -> NormalizedResponse  (RAW, unfiltered)
 *   Stage 2  client munge (reactive, in munge.ts) -> derived/grouped/summarized views
 *
 * The BFF returns RAW credible-set memberships per variant. All threshold/filter/group
 * logic stays client-side so UI controls recompute without a round-trip.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Shared primitives
 * ──────────────────────────────────────────────────────────────────────────── */

/** Canonical internal variant id, "chr:pos:ref:alt" (GRCh38), e.g. "19:44908684:T:C". */
export type VariantId = string;

/** Data types as returned by credible_sets_by_variant.data_type. */
export type DataType = "GWAS" | "eQTL" | "pQTL" | "sQTL" | "caQTL" | "edQTL" | "metaboQTL";

/** QTL molecular data types (everything except GWAS). */
export type QtlDataType = Exclude<DataType, "GWAS">;

/**
 * eQTL Catalogue quantification level, parsed from CS row trait_original suffix after the
 * last "|" (e.g. "ENSG...|exon"). "ge" = gene-level. Default view shows ge only; an option
 * exposes the others, and when shown the level is displayed alongside the gene symbol.
 */
export type QuantLevel = "ge" | "exon" | "tx" | "txrev" | "leafcutter";

/* ────────────────────────────────────────────────────────────────────────────
 * STAGE 1 — what the BFF returns (raw, unfiltered)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * One credible-set membership = one row from credible_sets_by_variant.
 * The queried variant is a member of credible set `csId`. A variant typically has
 * MANY of these (one per trait/dataset CS); APOE had ~998.
 *
 * Field names map 1:1 to the API (camelCased) so the BFF transform is trivial.
 */
export interface CredibleSetMembership {
  // provenance
  resource: string; // e.g. "finngen", "eqtl_catalogue", "ukbb"  (NOTE: the resource *filter* value)
  version: string; // e.g. "R12", "R7"
  dataset: string; // dataset/file id, e.g. "FinnGen_kanta", "QTD000435", "FinnGen_ATACseq"
  dataType: DataType;

  // trait / molecular feature
  trait: string; //   GWAS: phenocode | eQTL/pQTL: gene/protein symbol (collapsed) | caQTL: ATAC peak id
  traitOriginal: string; // unharmonized trait id (e.g. "ENSG00000104859|ge", "...|exon")
  /** eQTL Catalogue quant level parsed from traitOriginal suffix; null for non-leveled data. */
  quantLevel: QuantLevel | null;
  cellType: string | null; // null for GWAS; tissue/cell for QTLs ("l1.PBMC", "plasma", "brain_(DLPFC)|naive")

  // credible set identity + quality
  csId: string;
  csSize: number;
  csMinR2: number;

  // association stats of the queried variant within this CS
  mlog10p: number;
  beta: number;
  se: number;
  pip: number; //         primary client-side filter threshold (replaces old p-value threshold)
  aaf: number; //         alt allele freq in this dataset

  // variant annotation embedded by the API (annotation of the queried variant, not rsid)
  mostSevere: string; //  e.g. "missense_variant"
  geneMostSevere: string | null;
}

/**
 * Variant-level annotation from variant_annotation/{source}.
 * CS rows carry mostSevere/geneMostSevere/aaf already; this adds rsid + enrichment + INFO.
 * gnomAD per-population AF is OPEN (see refactor.md §11) — needs a source decision.
 */
export interface VariantAnnotation {
  rsid: string | null;
  consequence: string; //   normalized lowercase ("missense variant")
  isCoding: boolean; //     derived via utils/coding.ts
  isLoF: boolean; //        derived via utils/coding.ts
  gene: string | null; //   gene_most_severe
  af: number | null; //     dataset AF (FinnGen "AF")
  info?: number | null;
  enrichmentNfe?: number | null; // EXOME/GENOME_enrichment_nfe (FinnGen-specific)
}

/**
 * gnomAD per-population allele frequencies.
 * Served by adding "gnomad" as a source on the existing POST /variant_annotation/{source}
 * (multi-variant) — see refactor.backend.md §1. Source file:
 * gs://finngen-commons/gnomad/gnomad.genomes.exomes.v4.0.sites.v2.tsv.bgz.
 * Populations from the file: afr, amr, asj, eas, fin, mid, nfe, remaining, sas (+ overall AF).
 * No popmax column in the file → compute client-side if wanted.
 * NOTE: file merges genomes+exomes; a variant may return two rows (genome_or_exome g/e) — the BFF
 * picks/merges (e.g. prefer larger AN) before producing one GnomadFreq per variant.
 */
export type GnomadPop = "afr" | "amr" | "asj" | "eas" | "fin" | "mid" | "nfe" | "remaining" | "sas";

export interface GnomadFreq {
  variant: VariantId;
  afOverall: number | null;
  byPop: Partial<Record<GnomadPop, number>>;
  /** computed client-side as max over byPop. */
  popmaxPop?: GnomadPop;
  popmaxAf?: number;
  genomeOrExome?: "g" | "e";
}

/** Nearest gene(s) from nearest_genes (POST batch). */
export interface NearestGene {
  geneName: string;
  distance: number; // 0 when variant is inside the gene
  geneStart: number;
  geneEnd: number;
  geneStrand: "+" | "-";
}

/** One input variant with all its raw evidence. Mirrors the old VariantRecord, minus `assoc`. */
export interface VariantResult {
  variant: VariantId;
  /** user-supplied beta from tab-separated input (for direction-consistency views). */
  beta?: number;
  /** user-supplied custom category/value from input. */
  value?: number | string;

  annotation: VariantAnnotation;
  gnomad?: GnomadFreq;
  nearestGenes?: NearestGene[];

  /** RAW, unfiltered. Stage 2 filters/groups/summarizes this client-side. */
  credibleSets: CredibleSetMembership[];
}

/** Trait/phenotype metadata, keyed by `${resource}|${trait}`. */
export interface PhenotypeMeta {
  resource: string;
  dataType: DataType;
  trait: string;
  phenostring: string;
  trait_type?: string; // "case-control" | "continuous" | ...
  numCases?: number;
  numSamples?: number;
}

/** Dataset metadata, keyed by dataset id. From /datasets. */
export interface DatasetMeta {
  datasetId: string;
  resource: string;
  dataType: DataType;
  version?: string;
  description?: string;
  qtlType?: string; //          "eQTL" | "caQTL" | ...
  tissueLabel?: string | null;
  cellType?: string | null;
  quantMethod?: string | null; // eQTL Catalogue "ge"/"exon"/...
  sampleSize?: number;
}

/** Resource descriptor from /resources (drives the dynamic resource filter in main options). */
export interface ResourceMeta {
  id: string;
  resource: string;
  dataTypes: DataType[];
  hasSummaryStats: boolean; // for routing to the phenotype-search view
}

/** Input parsing results (mirrors old TableData.input_variants). */
export interface InputVariants {
  found: VariantId[];
  notFound: string[];
  unparsed: string[];
  ac0: VariantId[];
  rsidMap: Record<string, VariantId[]>;
}

/** Stage-1 payload: everything the BFF assembles for a query. */
export interface NormalizedResponse {
  queryType: "variant" | "gene";
  inputVariants: InputVariants;
  variants: VariantResult[];
  phenotypes: Record<string, PhenotypeMeta>; // key `${resource}|${trait}`
  datasets: Record<string, DatasetMeta>; //    key datasetId
  resources: ResourceMeta[];
  hasBetas: boolean;
  hasCustomValues: boolean;
  meta: { apiVersions: Record<string, string>; generatedAt: string };
}

/* ────────────────────────────────────────────────────────────────────────────
 * STAGE 2 — client-derived (produced reactively in munge.ts, NOT from the wire)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Credible-set memberships grouped by (resource|dataset|trait|direction). Replaces GroupedFineMappedRecord. */
export interface GroupedCredibleSet {
  id: string;
  resource: string;
  dataset: string;
  dataType: DataType;
  trait: string; //       gene symbol for QTLs
  quantLevel: QuantLevel | null; // distinguishes ge/exon/tx/txrev/leafcutter when non-gene levels shown
  cellType: string | null;
  phenocodes: string[];
  pip: number[];
  mlog10p: number[];
  beta: number[];
  csSize: number[];
  csMinR2: number[];
  maxPip: number;
  count: number;
}

/** Phenotype-summary row — variant counts by CS membership. Replaces association-based counts. */
export interface PhenoSummaryRow {
  resource: string;
  dataType: DataType;
  trait: string;
  phenostring: string;
  variantCount: number; // # input variants in a CS for this trait
  consistentCount?: number; // requires user betas
  oppositeCount?: number;
  variants: VariantId[];
}

/** Tissue/cell-type summary row — decoupled from main options; toggled eQTL vs caQTL. */
export interface TissueSummaryRow {
  tissueOrCellType: string; // cellType (caQTL) or tissue label (eQTL)
  dataType: Extract<DataType, "eQTL" | "caQTL">;
  variantCount: number;
  /** caQTL only: genes the peak links to, via peak_to_genes (lazy/optional enrichment). */
  linkedGenes?: string[];
  variants: VariantId[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * COLOCALIZATION — fetched lazily PER CREDIBLE SET (not bulk-by-variant).
 * colocalization_by_variant returns the whole region network (~30k rows for APOE);
 * use colocalization_by_credible_set_id(resource, phenotype, csId) when a row expands.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ColocPair {
  resource2: string;
  dataType2: DataType;
  trait2: string;
  trait2Phenostring?: string;
  cellType2: string | null;
  ppH4: number; // PP.H4.abf — colocalization posterior
  clpp: number;
  cs2Size: number;
  hit2: VariantId;
}

/* ────────────────────────────────────────────────────────────────────────────
 * PHENOTYPE SEARCH VIEW (separate route) — full summary stats, not credible sets.
 * From summary_stats/{resource}/{data_type}, joined with CS-membership flag.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A phenotype hit from GET /search (types=phenotypes). The view uses (resource, dataType) to call
 * summary_stats/{resource}/{data_type}. data_type + has_summary_stats must be exposed by /search
 * (see refactor.backend.md §2).
 */
export interface PhenotypeSearchHit {
  code: string;
  name: string;
  resource: string;
  dataType: DataType;
  hasSummaryStats: boolean;
  sampleSize?: number;
  nCases?: number | null;
  nControls?: number | null;
}

export interface PhenoSearchRow {
  variant: VariantId;
  rsid: string | null;
  gene: string | null;
  consequence: string;
  mlog10p: number;
  beta: number;
  se: number;
  af: number | null;
  /** true if this variant is in a credible set for the searched phenotype. */
  inCredibleSet: boolean;
  csId?: string;
  pip?: number;
}
