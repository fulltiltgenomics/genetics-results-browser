/**
 * Stage-2 reactive munging for the credible-set-only data model (refactor.md §1, §4).
 *
 * Pure functions over a NormalizedResponse's RAW per-variant credibleSets:
 *   filterCredibleSets -> groupCredibleSets -> summarizePhenotypes / summarizeTissues.
 *
 * These mirror the SHAPE and intent of the legacy src/store/munge.ts
 * (filterRows / groupFineMappedTraits / summarizePhenotypes / summarizeTissues) but operate on
 * CredibleSetMembership records instead of the old assoc + finemapped split — there is no p-value
 * path anymore, the primary threshold is PIP (refactor.md §4 "Thresholds").
 *
 * ADDITIVE / non-breaking (Strangler Fig): this is a NEW module. The legacy munge.ts and its
 * characterization tests stay intact until the store/components migrate (tasks .14/.17+). Nothing
 * here imports from or mutates the legacy code.
 */

import {
  CredibleSetDataType,
  CredibleSetMembership,
  DataTypeSummaryRow,
  GroupedCredibleSet,
  NormalizedResponse,
  PhenoSummaryRow,
  QuantLevel,
  TissueSummaryRow,
  VariantId,
  VariantResult,
} from "../types/types.normalized";

/* ────────────────────────────────────────────────────────────────────────────
 * FilterState — the reactive control surface the store (.14) will hold.
 *
 * Field names are chosen to be self-describing and to map cleanly onto the new UI controls:
 *   - PIP + p-value are the membership thresholds (refactor.md §4 "Thresholds")
 *   - resources is the lifted resource filter (refactor.md §4 "Resource filter to main options")
 *   - dataTypes is the dynamic data-type toggle (driven by /resources + /datasets)
 *   - includeAllQuantLevels is the eQTL quant-level option (default ge-only, refactor.md §4)
 *   - selectedPhenotype mirrors the old single-phenotype focus
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A single trait focus, keyed exactly like NormalizedResponse.phenotypes (`${resource}|${trait}`)
 * but split so callers don't have to re-parse. Filter matching is on resource + trait (the harmonized
 * display name). traitOriginal (the phenocode/molecular id) is carried for the phenotype-search handoff,
 * which needs it to address summary_stats for GWAS layers; it is not used by passesFilter.
 */
export interface SelectedPhenotype {
  resource: string;
  trait: string;
  traitOriginal?: string;
}

export interface FilterState {
  /** keep memberships with pip >= pipThreshold (inclusive, mirrors legacy finemapped `pip >= pip`). */
  pipThreshold: number;
  /**
   * keep memberships whose p-value is <= pValueThreshold (i.e. mlog10p >= -log10(threshold)).
   * 1 keeps everything (every p-value <= 1). a null mlog10p can't be evaluated, so it always passes.
   */
  pValueThreshold: number;
  /**
   * enabled resources (e.g. "finngen", "ukbb", "eqtl_catalogue"). undefined = no resource filter
   * (keep all). an empty set means "nothing enabled" -> drops all rows.
   */
  resources?: Set<string>;
  /** per-data-type toggle. a data type absent from the map is treated as ENABLED (permissive default). */
  dataTypes: Partial<Record<CredibleSetDataType, boolean>>;
  /**
   * eQTL quant-level option. default (false): show only gene-level (`ge`) eQTL Catalogue rows.
   * non-leveled rows (quantLevel === null: GWAS/pQTL/caQTL/etc.) ALWAYS pass this gate.
   * true: also include exon/tx/txrev/leafcutter levels.
   */
  includeAllQuantLevels?: boolean;
  /** when set, keep only memberships for this resource+trait (mirrors legacy selected-phenotype filter). */
  selectedPhenotype?: SelectedPhenotype;
  /** cis-window half-width in Mb: a QTL is cis if the variant is within ±cisWindow of a target gene. */
  cisWindow: number;
  /** keep cis QTL memberships. absent = enabled (permissive default, like the data-type toggles). */
  showCis?: boolean;
  /** keep trans QTL memberships. absent = enabled. */
  showTrans?: boolean;
}

/** QTL data types that carry a molecular target gene and so can be classified cis/trans. */
const CIS_TRANS_TYPES: ReadonlySet<CredibleSetDataType> = new Set([
  "eQTL",
  "pQTL",
  "sQTL",
  "edQTL",
  "caQTL",
]);

/**
 * Classify a QTL membership as "cis" or "trans" relative to the queried variant, or null when it is
 * not cis/trans-classifiable (GWAS, metaboQTL, which have no gene target). cis = the variant is within
 * ±cisWindow Mb of any target gene's TSS (strand-anchored; start when strand unknown, e.g. caQTL).
 * A classifiable QTL with no resolved target gene is "trans" (it lies beyond the BFF's fetch window).
 */
export const classifyCisTrans = (
  cs: Pick<CredibleSetMembership, "dataType" | "chr" | "pos" | "geneTargets">,
  cisWindowMb: number
): "cis" | "trans" | null => {
  if (!CIS_TRANS_TYPES.has(cs.dataType)) return null;
  const win = cisWindowMb * 1e6;
  for (const g of cs.geneTargets ?? []) {
    if (g.chrom !== cs.chr) continue;
    const tss = g.strand === "-" ? g.end : g.start;
    if (Math.abs(cs.pos - tss) <= win) return "cis";
  }
  return "trans";
};

/** non-gene eQTL Catalogue quant levels — filtered out unless includeAllQuantLevels is on. */
const NON_GENE_QUANT_LEVELS: ReadonlySet<QuantLevel> = new Set([
  "exon",
  "tx",
  "txrev",
  "leafcutter",
  "majiq",
]);

/** a single membership passes the current filters. pure, no allocation per call beyond comparisons. */
const passesFilter = (cs: CredibleSetMembership, f: FilterState): boolean => {
  // pip >= threshold: inclusive, matching legacy `a.pip >= pip` so the boundary behavior is unchanged.
  if (cs.pip < f.pipThreshold) return false;
  // p-value <= threshold, expressed on the mlog10p the rows actually carry. null mlog10p (some
  // open_targets rows) can't be compared, so it passes rather than being silently dropped.
  if (cs.mlog10p !== null && cs.mlog10p < -Math.log10(f.pValueThreshold)) return false;
  if (f.resources && !f.resources.has(cs.resource)) return false;
  // a data type absent from the toggle map is treated as enabled (so a partial map never hides data
  // the store hasn't explicitly toggled off).
  if (f.dataTypes[cs.dataType] === false) return false;
  // quant-level gate only applies to leveled eQTL Catalogue rows (quantLevel !== null).
  if (
    !f.includeAllQuantLevels &&
    cs.quantLevel !== null &&
    NON_GENE_QUANT_LEVELS.has(cs.quantLevel)
  ) {
    return false;
  }
  if (f.selectedPhenotype) {
    if (cs.resource !== f.selectedPhenotype.resource || cs.trait !== f.selectedPhenotype.trait) {
      return false;
    }
  }
  // cis/trans QTL toggles (absent = enabled). null classification (GWAS/metaboQTL) always passes,
  // mirroring the legacy filter where non-classifiable rows ignored the cis/trans switches.
  const cisTrans = classifyCisTrans(cs, f.cisWindow);
  if (cisTrans === "cis" && f.showCis === false) return false;
  if (cisTrans === "trans" && f.showTrans === false) return false;
  return true;
};

/**
 * Apply the reactive filters to every variant's raw credibleSets (raw -> filtered).
 * Returns NEW VariantResult objects (credibleSets replaced); does not mutate the input.
 * Variants whose memberships all drop out are KEPT with an empty credibleSets array — row-dropping
 * is a presentation concern the store decides (it differs across tabs), so this stays neutral.
 */
export const filterCredibleSets = (
  variants: VariantResult[],
  filter: FilterState
): VariantResult[] =>
  variants.map((v) => ({
    ...v,
    credibleSets: v.credibleSets.filter((cs) => passesFilter(cs, filter)),
  }));

/* ────────────────────────────────────────────────────────────────────────────
 * GROUPING — analogous to legacy groupFineMappedTraits, but credible-set native.
 *
 * Group key: resource | dataset | trait | direction (and quantLevel, so ge/exon/tx/... never
 * collapse together — the level disambiguates an otherwise-identical gene symbol, refactor.md §4).
 * direction is up/down from beta sign; beta === 0 -> "up" (legacy used `beta > 0 ? up : down`, so 0
 * fell to "down"; here a 0 beta is rare for CS rows, we keep the simple sign split and DOCUMENT it).
 * ──────────────────────────────────────────────────────────────────────────── */

const direction = (beta: number): "up" | "down" => (beta < 0 ? "down" : "up");

/**
 * Group filtered memberships into GroupedCredibleSet[], sorted by maxPip descending.
 * Pass already-filtered memberships (call filterCredibleSets first).
 */
export const groupCredibleSets = (
  credibleSets: CredibleSetMembership[]
): GroupedCredibleSet[] => {
  const groups: Record<string, GroupedCredibleSet> = {};
  for (const cs of credibleSets) {
    const dir = direction(cs.beta);
    // quantLevel is part of the id so different eQTL levels stay distinct when shown together.
    const id = `${cs.resource}|${cs.dataset}|${cs.trait}|${cs.quantLevel ?? ""}|${dir}`;
    const g = groups[id];
    if (g === undefined) {
      groups[id] = {
        id,
        resource: cs.resource,
        dataset: cs.dataset,
        dataType: cs.dataType,
        trait: cs.trait,
        chr: cs.chr,
        pos: cs.pos,
        geneTargets: cs.geneTargets,
        traitOriginal: cs.traitOriginal,
        quantLevel: cs.quantLevel,
        cellType: cs.cellType,
        cellTypes: [cs.cellType],
        phenocodes: [cs.trait],
        csIds: [cs.csId],
        pip: [cs.pip],
        mlog10p: [cs.mlog10p ?? NaN],
        beta: [cs.beta],
        csSize: [cs.csSize],
        csMinR2: [cs.csMinR2],
        maxPip: cs.pip,
        count: 1,
      };
    } else {
      g.cellTypes.push(cs.cellType);
      g.phenocodes.push(cs.trait);
      g.csIds.push(cs.csId);
      g.pip.push(cs.pip);
      g.mlog10p.push(cs.mlog10p ?? NaN);
      g.beta.push(cs.beta);
      g.csSize.push(cs.csSize);
      g.csMinR2.push(cs.csMinR2);
      g.maxPip = Math.max(g.maxPip, cs.pip);
      g.count += 1;
    }
  }
  return Object.values(groups).sort((a, b) => b.maxPip - a.maxPip);
};

/* ────────────────────────────────────────────────────────────────────────────
 * DATA TYPE COMPARISON — per-variant CS-membership counts by data type (refactor.md §4).
 *
 * Mirrors the legacy DataTypeTable intent (one row per input variant, a count column per data type)
 * but the counts come from credible-set membership, NOT p-filtered associations. We count DISTINCT
 * credible sets per data type — collapsing duplicate memberships of the same (resource|dataset|trait
 * |quantLevel) so the same signal reported under multiple eQTL levels/directions isn't double-counted,
 * matching how groupCredibleSets collapses the per-variant detail table.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Summarize filtered variants into one row per variant with CS-membership counts per data type.
 * Pass variants whose credibleSets have ALREADY been filtered (store filters, then summarizes).
 * One row is emitted per input variant even when it has zero surviving memberships (total 0) so the
 * table mirrors the input list — row-dropping is a presentation choice, not done here.
 */
export const summarizeDataTypes = (variants: VariantResult[]): DataTypeSummaryRow[] =>
  variants.map((v) => {
    const counts: Partial<Record<CredibleSetDataType, number>> = {};
    // dedupe by data type + the grouping key so multiple memberships of one signal count once.
    const seen: Record<string, Set<string>> = {};
    for (const cs of v.credibleSets) {
      const key = `${cs.resource}|${cs.dataset}|${cs.trait}|${cs.quantLevel ?? ""}`;
      const bucket = (seen[cs.dataType] ??= new Set());
      if (bucket.has(key)) continue;
      bucket.add(key);
      counts[cs.dataType] = (counts[cs.dataType] ?? 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
      variant: v.variant,
      rsid: v.annotation.rsid,
      consequence: v.annotation.consequence,
      gene: v.annotation.gene,
      consequences: v.gnomad?.consequences,
      gnomad: v.gnomad,
      counts,
      total,
    };
  });

/* ────────────────────────────────────────────────────────────────────────────
 * PHENOTYPE SUMMARY — variant counts by CS membership per trait (refactor.md §4).
 *
 * Mirrors legacy summarizePhenotypes semantics:
 *   - variantCount = # distinct input variants in a CS for that resource+trait
 *   - consistent/opposite = direction agreement vs the user's input beta (only when betas present)
 *   - sorted by variantCount descending
 * The key change from legacy: counts come from credible-set membership, not p-filtered associations.
 * ──────────────────────────────────────────────────────────────────────────── */

interface PhenoAcc {
  resource: string;
  dataType: CredibleSetDataType;
  trait: string;
  traitOriginal: string;
  dataset: string;
  variants: Set<VariantId>;
  consistent: number;
  opposite: number;
}

/**
 * Summarize filtered variants into per-trait CS-membership rows.
 * Pass variants whose credibleSets have ALREADY been filtered (the store filters then summarizes,
 * exactly as the legacy store called filterRows before summarizePhenotypes).
 */
export const summarizePhenotypes = (
  variants: VariantResult[],
  phenotypes: NormalizedResponse["phenotypes"]
): PhenoSummaryRow[] => {
  const hasAnyBeta = variants.some((v) => v.beta !== undefined);
  const acc: Record<string, PhenoAcc> = {};
  for (const v of variants) {
    const inputBeta = v.beta;
    for (const cs of v.credibleSets) {
      const id = `${cs.resource}|${cs.trait}`;
      let a = acc[id];
      if (a === undefined) {
        a = acc[id] = {
          resource: cs.resource,
          dataType: cs.dataType,
          trait: cs.trait,
          traitOriginal: cs.traitOriginal,
          dataset: cs.dataset,
          variants: new Set(),
          consistent: 0,
          opposite: 0,
        };
      }
      a.variants.add(v.variant);
      // direction agreement is only meaningful when the user supplied a beta for this variant.
      if (inputBeta !== undefined) {
        const product = cs.beta * inputBeta;
        if (product > 0) a.consistent += 1;
        else if (product < 0) a.opposite += 1;
      }
    }
  }
  return Object.values(acc)
    .map((a) => {
      const meta = phenotypes[`${a.resource}|${a.trait}`];
      const row: PhenoSummaryRow = {
        resource: a.resource,
        dataType: a.dataType,
        trait: a.trait,
        traitOriginal: a.traitOriginal,
        dataset: a.dataset,
        phenostring: meta?.phenostring ?? a.trait,
        variantCount: a.variants.size,
        variants: [...a.variants],
      };
      // omit direction counts entirely when no input betas exist (matches legacy "stay 0" intent
      // but expressed as optional fields on the new row type).
      if (hasAnyBeta) {
        row.consistentCount = a.consistent;
        row.oppositeCount = a.opposite;
      }
      return row;
    })
    .sort((a, b) => b.variantCount - a.variantCount);
};

/* ────────────────────────────────────────────────────────────────────────────
 * TISSUE SUMMARY — tissue/cell-type counts for QTLs (refactor.md §4).
 *
 * Decoupled from the global data-type options: callers pass the eQTL-vs-caQTL selection directly
 * (the tissue tab manages its own selection). Keyed by cellType:
 *   - eQTL: cellType is the tissue/cell label ("plasma", "brain_(DLPFC)|naive")
 *   - caQTL: trait is an ATAC peak id and cellType is the cell ("l1.PBMC"), so we key by cellType
 *            and leave peak->gene enrichment (via peak_to_genes) as a documented lazy TODO.
 * Rows with no cellType are skipped (can't attribute a tissue).
 * ──────────────────────────────────────────────────────────────────────────── */

interface TissueAcc {
  variants: Set<VariantId>;
  /** caQTL: ATAC peak ids seen for this cell type; resolved to genes lazily, see linkedGenes TODO. */
  peaks: Set<string>;
}

/**
 * Summarize filtered variants into tissue/cell-type rows for ONE QTL data type (eQTL or caQTL).
 * @param dataType which QTL layer to summarize — the decoupled eQTL/caQTL toggle.
 *
 * peak->gene enrichment is NOT done here: peak_to_genes is fetched lazily per visible row in the
 * tissue table (usePeakGenes). We surface the deduped peak ids on the row so that cell can resolve
 * them on demand without re-deriving the membership set.
 */
export const summarizeTissues = (
  variants: VariantResult[],
  dataType: "eQTL" | "caQTL"
): TissueSummaryRow[] => {
  const acc: Record<string, TissueAcc> = {};
  for (const v of variants) {
    for (const cs of v.credibleSets) {
      if (cs.dataType !== dataType) continue;
      if (!cs.cellType) continue; // can't attribute to a tissue/cell without a label
      const key = cs.cellType;
      let a = acc[key];
      if (a === undefined) {
        a = acc[key] = { variants: new Set(), peaks: new Set() };
      }
      a.variants.add(v.variant);
      // for caQTL the trait IS the ATAC peak id; stash it for later peak_to_genes enrichment.
      if (dataType === "caQTL") a.peaks.add(cs.trait);
    }
  }
  return Object.entries(acc)
    .map(([tissueOrCellType, a]) => ({
      tissueOrCellType,
      dataType,
      variantCount: a.variants.size,
      variants: [...a.variants],
      // caQTL: peak ids for this cell type, resolved to genes live via peak_to_genes (sorted for
      // stable identity); undefined for eQTL where the trait is already a gene/tissue label.
      peaks: dataType === "caQTL" ? [...a.peaks].sort() : undefined,
    }))
    .sort((a, b) => b.variantCount - a.variantCount);
};
