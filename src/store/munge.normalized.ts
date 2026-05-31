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
 *   - PIP + cs_min_r2 replace the old p-value slider (refactor.md §4 "Thresholds")
 *   - resources is the lifted resource filter (refactor.md §4 "Resource filter to main options")
 *   - dataTypes is the dynamic data-type toggle (driven by /resources + /datasets)
 *   - includeAllQuantLevels is the eQTL quant-level option (default ge-only, refactor.md §4)
 *   - selectedPhenotype mirrors the old single-phenotype focus
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A single trait focus, keyed exactly like NormalizedResponse.phenotypes (`${resource}|${trait}`)
 * but split so callers don't have to re-parse. Matching is on resource + trait.
 */
export interface SelectedPhenotype {
  resource: string;
  trait: string;
}

export interface FilterState {
  /** keep memberships with pip >= pipThreshold (inclusive, mirrors legacy finemapped `pip >= pip`). */
  pipThreshold: number;
  /** keep memberships with csMinR2 >= csMinR2Threshold (inclusive). 0 keeps everything. */
  csMinR2Threshold: number;
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
}

/** non-gene eQTL Catalogue quant levels — filtered out unless includeAllQuantLevels is on. */
const NON_GENE_QUANT_LEVELS: ReadonlySet<QuantLevel> = new Set([
  "exon",
  "tx",
  "txrev",
  "leafcutter",
]);

/** a single membership passes the current filters. pure, no allocation per call beyond comparisons. */
const passesFilter = (cs: CredibleSetMembership, f: FilterState): boolean => {
  // pip >= threshold: inclusive, matching legacy `a.pip >= pip` so the boundary behavior is unchanged.
  if (cs.pip < f.pipThreshold) return false;
  if (cs.csMinR2 < f.csMinR2Threshold) return false;
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
        quantLevel: cs.quantLevel,
        cellType: cs.cellType,
        phenocodes: [cs.trait],
        pip: [cs.pip],
        mlog10p: [cs.mlog10p ?? NaN],
        beta: [cs.beta],
        csSize: [cs.csSize],
        csMinR2: [cs.csMinR2],
        maxPip: cs.pip,
        count: 1,
      };
    } else {
      g.phenocodes.push(cs.trait);
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
 * peak->gene enrichment (linkedGenes for caQTL) is intentionally NOT computed here: it requires a
 * lazy peak_to_genes fetch (refactor.md §2) which is a later concern (.21/.23). linkedGenes is left
 * undefined; the peak ids are aggregated internally so a follow-up enrichment hook can fill it in.
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
      // linkedGenes deferred: requires lazy peak_to_genes; peaks aggregated above for that hook.
    }))
    .sort((a, b) => b.variantCount - a.variantCount);
};
