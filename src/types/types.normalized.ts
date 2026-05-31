/**
 * Credible-set-primary normalized types for the refactored variant annotation tool.
 *
 * Derived from refactor.schema.draft.ts and grounded in real genetics-results-api responses
 * captured in src/test/fixtures/*.json (localhost:2000, 2026-05).
 *
 * Two-stage model (refactor.md §1):
 *   Stage 1  BFF fetch+normalize  -> NormalizedResponse  (RAW, unfiltered)
 *   Stage 2  client munge (reactive, in munge.ts) -> derived/grouped/summarized views
 *
 * ADDITIVE/non-breaking: this module is introduced alongside the legacy types in types.ts
 * (assoc/AssocRecord/GroupedAssocRecord/TableData). Those stay intact and working until the
 * BFF/serverQuery/munge/store consumers migrate (later tasks .9-.14). The legacy `DataType`
 * enum in types.ts is reused here at the value level — see CredibleSetDataType below.
 */

// the legacy enum's string values ("GWAS", "eQTL", ...) are the canonical credible-set casing,
// so we reuse it rather than redefining. note: the enum lacks "caQTL" (added by the new data
// layer) and carries legacy-only members (asmQTL, NA); the CredibleSetDataType union below is the
// authoritative set for credible-set rows. enum values are assignable to/from the union as strings.
export { DataType as LegacyDataTypeEnum } from "./types";

/* ────────────────────────────────────────────────────────────────────────────
 * Shared primitives
 * ──────────────────────────────────────────────────────────────────────────── */

/** Canonical internal variant id, "chr:pos:ref:alt" (GRCh38), e.g. "19:44908684:T:C". */
export type VariantId = string;

/**
 * Data types that can appear as a credible_sets_by_variant row, in canonical casing.
 * This is INTENTIONALLY narrower than DatasetDataType below: only data layers that produce
 * fine-mapped credible sets surface here. Reconciles with the legacy `DataType` enum in types.ts:
 * shares GWAS/eQTL/pQTL/sQTL/edQTL/metaboQTL, adds "caQTL" (confirmed live — FinnGen_ATACseq rows),
 * and drops the legacy-only "asmQTL"/"NA" placeholders (asmQTL exists as a dataset but has no CS rows).
 * /datasets and /search emit lowercase ("gwas"); the BFF normalizes those to this casing for CS rows.
 *
 * named CredibleSetDataType (not DataType) so it does not collide with the legacy `DataType` enum
 * in types.ts — the two are distinct vocabularies and must not be confused.
 */
export type CredibleSetDataType =
  | "GWAS"
  | "eQTL"
  | "pQTL"
  | "sQTL"
  | "caQTL"
  | "edQTL"
  | "metaboQTL";

/** QTL molecular data types (everything except GWAS) that can appear as a credible-set row. */
export type QtlDataType = Exclude<CredibleSetDataType, "GWAS">;

/**
 * The wider /datasets + /search data-type vocabulary, in the RAW lowercase casing those endpoints
 * emit (verified against fixtures/datasets.json data_type and fixtures/search_phenotypes.json).
 * Superset of the credible-set vocabulary: also covers non-CS layers (exome, gene_based, expression,
 * chromatin_peaks, gene_disease, asmqtl) and the "mixed" multi-type dataset marker.
 *
 * casing decision: kept lowercase as-is — the BFF does NOT uppercase these. several tokens (mixed,
 * exome, gene_based, expression, chromatin_peaks, gene_disease) have no CredibleSetDataType
 * counterpart, so a single uppercase mapping is impossible; only the qtl/gwas tokens that flow into
 * CS rows get normalized to CredibleSetDataType casing (gwas->GWAS, eqtl->eQTL, ...) at that point.
 */
export type DatasetDataType =
  | "gwas"
  | "eqtl"
  | "pqtl"
  | "sqtl"
  | "caqtl"
  | "metaboqtl"
  | "asmqtl"
  | "mixed"
  | "exome"
  | "gene_based"
  | "expression"
  | "chromatin_peaks"
  | "gene_disease";

/**
 * eQTL Catalogue quantification level, parsed from a CS row's trait_original suffix after the
 * last "|" (e.g. "ENSG00000104859.15_19_45068055_45068058|exon" -> "exon"). "ge" = gene-level.
 * null for non-leveled data (GWAS/pQTL/caQTL). Default view shows ge only; an option exposes the
 * others, and when shown the level is displayed alongside the gene symbol.
 */
export type QuantLevel = "ge" | "exon" | "tx" | "txrev" | "leafcutter";

/* ────────────────────────────────────────────────────────────────────────────
 * STAGE 1 — what the BFF returns (raw, unfiltered)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * One credible-set membership = one row from credible_sets_by_variant.
 * The queried variant is a member of credible set `csId`. A variant typically has MANY of these
 * (one per trait/dataset CS); APOE had ~998. Field names are camelCased from the API's snake_case
 * (resource, version, dataset, data_type, trait, trait_original, cell_type, mlog10p, beta, se,
 * pip, cs_id, cs_size, cs_min_r2, aaf, most_severe, gene_most_severe).
 */
export interface CredibleSetMembership {
  // provenance
  resource: string; // e.g. "finngen", "ukbb", "eqtl_catalogue", "open_targets" (the resource filter value)
  version: string; // e.g. "R12", "3k", "R7", "25.12"
  dataset: string; // dataset/file id, e.g. "FinnGen_kanta", "QTD000435", "FinnGen_ATACseq"
  dataType: CredibleSetDataType;

  // trait / molecular feature
  trait: string; //         GWAS: phenocode | eQTL/pQTL: gene/protein symbol | caQTL: ATAC peak id ("chr19-44906317-44906816")
  traitOriginal: string; // unharmonized trait id (e.g. "ENSG00000104859.15_19_45068055_45068058|exon")
  /** eQTL Catalogue quant level parsed from traitOriginal suffix; null for non-leveled data. */
  quantLevel: QuantLevel | null;
  cellType: string | null; // null for GWAS; tissue/cell for QTLs ("plasma", "brain_(DLPFC)|naive", "l1.PBMC")

  // queried-variant locus (chr/pos/ref/alt on the row; redundant with the parent VariantResult.variant)
  chr: number;
  pos: number;
  ref: string;
  alt: string;

  // credible set identity + quality
  csId: string; // cs_id, e.g. "chr19:43408684-46408684_1"
  csSize: number;
  csMinR2: number;

  // association stats of the queried variant within this CS
  mlog10p: number | null; // null for some open_targets CS rows (confirmed in fixtures)
  beta: number;
  se: number | null; //     null for open_targets CS rows (confirmed in fixtures)
  pip: number; //  primary client-side filter threshold (replaces the old p-value threshold)
  aaf: number; //  alt allele freq in this dataset

  // variant annotation embedded by the API (annotation of the queried variant)
  mostSevere: string; //         e.g. "missense_variant"
  geneMostSevere: string | null;
}

/**
 * Variant-level annotation from variant_annotation/{source} (POST batch; source "finngen").
 * CS rows already carry mostSevere/geneMostSevere/aaf; this adds rsid + INFO + FinnGen enrichment.
 * Raw fields arrive as strings (INFO/AF/enrichment) and are parsed to numbers by the BFF.
 */
export interface VariantAnnotation {
  rsid: string | null;
  consequence: string; //   normalized lowercase ("missense variant"), from most_severe
  isCoding: boolean; //     derived via utils/coding.ts
  isLoF: boolean; //        derived via utils/coding.ts
  gene: string | null; //   gene_most_severe
  af: number | null; //     dataset AF (FinnGen "AF" string parsed to number)
  info?: number | null; //  FinnGen "INFO"
  enrichmentNfe?: number | null; // EXOME/GENOME_enrichment_nfe (FinnGen-specific)
}

/**
 * gnomAD per-population allele frequencies.
 * Served by adding "gnomad" as a source on POST variant_annotation/{source} (refactor.backend.md §1).
 * Source file merges genomes+exomes (gnomad.genomes.exomes.v4.0.sites): a variant may return two rows
 * (genome_or_exome g/e) — the BFF picks/merges (e.g. prefer larger AN) into one GnomadFreq per variant.
 * No popmax in the file → popmax computed client-side as max over byPop.
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

/**
 * Nearest gene(s) from nearest_genes (POST batch). API fields: gene_name, distance, gene_start,
 * gene_end, gene_strand, plus hgnc fields and gene_type which we ignore for now.
 */
export interface NearestGene {
  geneName: string; // gene_name
  distance: number; // 0 when the variant is inside the gene
  geneStart: number;
  geneEnd: number;
  geneStrand: "+" | "-";
}

/** One input variant with all its raw evidence. Mirrors the legacy VariantRecord, minus `assoc`. */
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
  dataType: CredibleSetDataType;
  trait: string;
  phenostring: string;
  trait_type?: string; // "binary" | "case-control" | "continuous" | ...
  numCases?: number;
  numSamples?: number;
}

/** Dataset metadata, keyed by dataset id. From /datasets (data_type/qtl_types kept as the raw lowercase/mixed-case vocab). */
export interface DatasetMeta {
  datasetId: string; // dataset_id
  resource: string;
  dataType: DatasetDataType; // raw /datasets data_type ("gwas", "mixed", "exome", ...)
  version?: string;
  description?: string;
  qtlTypes?: QtlDataType[]; //  /datasets qtl_types array, e.g. ["eQTL","sQTL","pQTL"]
  tissueLabel?: string | null;
  cellType?: string | null;
  quantMethod?: string | null; // eQTL Catalogue "ge"/"exon"/...
  sampleSize?: number;
}

/**
 * Resource descriptor that drives the dynamic resource filter in main options.
 * BFF-DERIVED, not a direct projection of /resources: the raw /resources payload has no
 * data_types or has_summary_stats fields (it is keyed by category and only carries id/resource/
 * gencode_version/metadata). The BFF cross-references /datasets (products + qtl_types per resource)
 * to compute dataTypes and hasSummaryStats here.
 */
export interface ResourceMeta {
  id: string;
  resource: string;
  dataTypes: DatasetDataType[];
  hasSummaryStats: boolean; // for routing to the phenotype-search view
}

/** Input parsing results (mirrors the legacy TableData.input_variants, camelCased). */
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
  dataType: CredibleSetDataType;
  trait: string; //                gene symbol for QTLs
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

/**
 * Data-type-comparison row — per input variant, how many distinct credible-set memberships it has
 * in each data type (refactor.md §4 "Data type comparison"). Replaces the legacy association counts;
 * these are credible-set membership counts, not p-filtered association counts.
 */
export interface DataTypeSummaryRow {
  variant: VariantId;
  rsid: string | null;
  gene: string | null; // gene_most_severe of the queried variant
  /** distinct CS memberships per data type (counts grouped CS, deduped by resource|dataset|trait). */
  counts: Partial<Record<CredibleSetDataType, number>>;
  total: number;
}

/** Phenotype-summary row — variant counts by CS membership. Replaces association-based counts. */
export interface PhenoSummaryRow {
  resource: string;
  dataType: CredibleSetDataType;
  trait: string;
  phenostring: string;
  variantCount: number; //      # input variants in a CS for this trait
  consistentCount?: number; //  requires user betas
  oppositeCount?: number;
  variants: VariantId[];
}

/** Tissue/cell-type summary row — decoupled from main options; toggled eQTL vs caQTL. */
export interface TissueSummaryRow {
  tissueOrCellType: string; // cellType (caQTL) or tissue label (eQTL)
  dataType: Extract<CredibleSetDataType, "eQTL" | "caQTL">;
  variantCount: number;
  /** caQTL only: genes the peak links to, via peak_to_genes (lazy/optional enrichment). */
  linkedGenes?: string[];
  variants: VariantId[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * COLOCALIZATION — fetched lazily PER CREDIBLE SET (not bulk-by-variant).
 * colocalization_by_variant returns the whole region network (~30k rows for APOE);
 * use colocalization_by_credible_set_id(resource, phenotype, csId) when a row expands.
 * API row fields: resource/data_type/trait/cell_type, "PP.H4.abf", clpp, cs_size, hit.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ColocPair {
  resource2: string;
  dataType2: CredibleSetDataType;
  trait2: string;
  trait2Phenostring?: string;
  cellType2: string | null;
  ppH4: number; // PP.H4.abf — colocalization posterior
  clpp: number;
  cs2Size: number; // cs_size of the partner CS
  hit2: VariantId; // hit
}

/* ────────────────────────────────────────────────────────────────────────────
 * PHENOTYPE SEARCH VIEW (separate route) — full summary stats, not credible sets.
 * From summary_stats/{resource}/{data_type}, joined with CS-membership flag.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A phenotype hit from GET /search (types=phenotypes). The view uses (resource, dataType) to call
 * summary_stats/{resource}/{data_type}. API fields: code, name, resource, data_type (raw lowercase),
 * has_summary_stats, sample_size, n_cases, n_controls (refactor.backend.md §2).
 * dataType is the wider DatasetDataType: phenotype search can surface exome/asmqtl/etc. sumstats
 * that never appear as credible-set rows (refactor.md §5).
 */
export interface PhenotypeSearchHit {
  code: string;
  name: string;
  resource: string;
  dataType: DatasetDataType;
  hasSummaryStats: boolean;
  sampleSize?: number;
  nCases?: number | null;
  nControls?: number | null;
}

/** One row of the phenotype-search results table: a summary_stats record for an input variant. */
export interface PhenoSearchRow {
  variant: VariantId;
  rsid: string | null;
  gene: string | null; // nearest_genes from the sumstats row
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
