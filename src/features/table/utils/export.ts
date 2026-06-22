import { SHA256 } from "crypto-js";
import { download, generateCsv, mkConfig } from "export-to-csv";

import {
  CredibleSetDataType,
  DataTypeSummaryRow,
  GnomadFreq,
  NormalizedResponse,
  PhenoSearchRow,
  PhenoSummaryRow,
  TissueSummaryRow,
  VariantResult,
} from "../../../types/types.normalized";
import { cleanConsequence, formatTissue, formatTraitName, pValRepr } from "./tableutil";
import { gnomadAf } from "../tables/VariantMainTable.columns.normalized";
import { classifyCisTrans } from "../../../store/munge.normalized";

/**
 * TSV exports for the credible-set-native annotation tables (re-instates the legacy ExportToolbar
 * downloads removed during the refactor). Unlike the legacy export.ts — which dug values out of
 * rendered React elements (val.props.children…) and was explicitly flagged as error-prone — these
 * build straight from the typed normalized data, so they stay correct as the columns evolve.
 *
 * File format is unchanged from before the refactor: tab-separated, header row from the object keys,
 * no quoting/BOM, "." decimals, and a filename suffixed with a short hash of the query so repeated
 * downloads are distinguishable.
 *
 * Each export splits into a pure `build*Rows` (returns the array of records that becomes the TSV) and
 * a thin `export*` wrapper that names the file and triggers the download — the builders are unit-tested
 * (export.test.ts) so the TSV content is verified without a real browser download.
 */

// "NA" is the legacy sentinel for an absent value in these TSVs (kept so downstream parsers match).
const NA = "NA";
type Cell = string | number;
export type ExportRow = Record<string, Cell>;

const shortHash = (s: string): string => SHA256(s).toString().substring(0, 7);

// internal variant ids are "chr:pos:ref:alt"; the legacy downloads used "chr-pos-ref-alt", so emit
// dash form everywhere a variant id reaches a TSV (kept for backward-compatible parsers).
const toDashVariant = (v: string): string => v.replace(/:/g, "-");

const tsvConfig = (filename: string) =>
  mkConfig({
    fieldSeparator: "\t",
    filename,
    quoteStrings: false,
    decimalSeparator: ".",
    useBom: false,
    useKeysAsHeaders: true,
    useTextFile: true,
  });

// generateCsv throws on an empty array (it can't infer headers); callers disable their buttons when
// there is nothing to export, but guard here too so a stray click is a no-op rather than a crash.
const writeTsv = (rows: ExportRow[], filename: string): void => {
  if (rows.length === 0) return;
  const cfg = tsvConfig(filename);
  download(cfg)(generateCsv(cfg)(rows));
};

type TraitName = (resource: string, trait: string) => string;
type Membership = VariantResult["credibleSets"][number];

// gnomAD AF for the selected population as a plain number (or NA) — machine-readable, unlike the
// display column which formats via afRepr.
const afValue = (gnomad: GnomadFreq | undefined, pop: string | undefined): Cell => {
  const af = gnomadAf(gnomad, pop);
  return af === null || Number.isNaN(af) ? NA : af;
};

// header key for the AF column, e.g. "global_af" or "fin_af" (mirrors the table's "{pop} AF" header).
const afKey = (pop: string | undefined): string => `${pop || "global"}_af`;

// the five variant-identity columns shared by the variant-level and the flattened detail exports.
const variantIdentity = (v: VariantResult, pop: string | undefined): ExportRow => ({
  variant: toDashVariant(v.variant),
  rsid: v.annotation.rsid ?? NA,
  [afKey(pop)]: afValue(v.gnomad, pop),
  most_severe: cleanConsequence(v.annotation.consequence ?? "") || NA,
  most_severe_gene: v.annotation.gene ?? NA,
});

// the most significant (max mlog10p) credible-set membership of a variant — the "top association".
const topMembership = (v: VariantResult): Membership | undefined => {
  let best: Membership | undefined;
  let bestM = Number.NEGATIVE_INFINITY;
  for (const cs of v.credibleSets) {
    const m = cs.mlog10p ?? Number.NEGATIVE_INFINITY;
    if (best === undefined || m > bestM) {
      best = cs;
      bestM = m;
    }
  }
  return best;
};

// distinct traits (resource|trait) split by the direction of their most significant credible set —
// mirrors the variant table's "traits up"/"traits down" columns.
const traitDirectionCounts = (v: VariantResult): { up: number; down: number } => {
  const repByTrait = new Map<string, Membership>();
  for (const cs of v.credibleSets) {
    const key = `${cs.resource}|${cs.trait}`;
    const cur = repByTrait.get(key);
    if (
      !cur ||
      (cs.mlog10p ?? Number.NEGATIVE_INFINITY) > (cur.mlog10p ?? Number.NEGATIVE_INFINITY)
    ) {
      repByTrait.set(key, cs);
    }
  }
  let up = 0;
  let down = 0;
  for (const cs of repByTrait.values()) {
    if (cs.beta > 0) up += 1;
    else if (cs.beta < 0) down += 1;
  }
  return { up, down };
};

// caQTL shows the peak's linked gene(s); other QTLs/GWAS show the resolved trait name. Falls back to
// the raw trait when no gene/name resolves (matches the credible-set table's displayName).
const displayTrait = (cs: Membership, traitName: TraitName): string => {
  if (cs.dataType === "caQTL") {
    const genes = (cs.geneTargets ?? []).map((t) => t.symbol);
    return genes.length ? genes.join(", ") : cs.trait;
  }
  return traitName(cs.resource, cs.trait);
};

/* ────────────────────────────────────────────────────────────────────────────
 * Variant results table — one row per (filtered) input variant.
 * ──────────────────────────────────────────────────────────────────────────── */

export const buildVariantMainRows = (
  variants: VariantResult[],
  selectedPopulation: string | undefined,
  traitName: TraitName,
  showTraitCounts: boolean,
  hasBetas: boolean,
  hasCustomValues: boolean
): ExportRow[] =>
  variants.map((v) => {
    const row: ExportRow = variantIdentity(v, selectedPopulation);
    if (showTraitCounts) {
      row.traits = new Set(v.credibleSets.map((cs) => `${cs.resource}|${cs.trait}`)).size;
      const { up, down } = traitDirectionCounts(v);
      row.traits_up = up;
      row.traits_down = down;
    }
    const top = topMembership(v);
    if (top) {
      const label = displayTrait(top, traitName);
      row.top_association =
        top.dataType === "caQTL" && top.cellType ? `${label} (${formatTissue(top.cellType)})` : label;
      row["p-value"] = top.mlog10p === null ? NA : pValRepr(top.mlog10p);
      row.beta = top.beta;
    } else {
      row.top_association = NA;
      row["p-value"] = NA;
      row.beta = NA;
    }
    if (hasBetas) row.my_beta = v.beta ?? NA;
    if (hasCustomValues) row.my_value = v.value ?? NA;
    return row;
  });

export const exportVariantMainTable = (
  variantInput: string,
  variants: VariantResult[],
  selectedPopulation: string | undefined,
  traitName: TraitName,
  showTraitCounts: boolean,
  hasBetas: boolean,
  hasCustomValues: boolean
): void => {
  const rows = buildVariantMainRows(
    variants,
    selectedPopulation,
    traitName,
    showTraitCounts,
    hasBetas,
    hasCustomValues
  );
  writeTsv(rows, `variant_annotation_${rows.length}_variants_${shortHash(variantInput)}`);
};

/* ────────────────────────────────────────────────────────────────────────────
 * Credible-set / fine-mapping results — flattened, one row per membership.
 * Replaces the legacy separate "fine-mapping" and "association" exports, which split a signal the
 * new data model keeps unified as one credible-set membership.
 * ──────────────────────────────────────────────────────────────────────────── */

export const buildCredibleSetRows = (
  variants: VariantResult[],
  selectedPopulation: string | undefined,
  traitName: TraitName,
  cisWindow: number
): ExportRow[] => {
  const rows: ExportRow[] = [];
  for (const v of variants) {
    const identity = variantIdentity(v, selectedPopulation);
    for (const cs of v.credibleSets) {
      rows.push({
        ...identity,
        type: cs.dataType,
        resource: cs.resource,
        dataset: cs.dataset,
        trait: displayTrait(cs, traitName),
        trait_id: cs.trait,
        cis_trans: classifyCisTrans(cs, cisWindow) ?? NA,
        cell_type: cs.cellType ?? NA,
        "p-value": cs.mlog10p === null ? NA : pValRepr(cs.mlog10p),
        beta: cs.beta,
        pip: Number.isNaN(cs.pip) ? NA : cs.pip,
        cs_size: cs.csSize,
        cs_min_r2: cs.csMinR2,
      });
    }
  }
  return rows;
};

export const exportCredibleSets = (
  variantInput: string,
  variants: VariantResult[],
  selectedPopulation: string | undefined,
  traitName: TraitName,
  cisWindow: number
): void => {
  const rows = buildCredibleSetRows(variants, selectedPopulation, traitName, cisWindow);
  writeTsv(
    rows,
    `variant_annotation_${variants.length}_variants_credible_sets_${shortHash(variantInput)}`
  );
};

/* ────────────────────────────────────────────────────────────────────────────
 * Data type comparison — per-variant CS-membership counts per data type.
 * ──────────────────────────────────────────────────────────────────────────── */

const DATA_TYPE_COLUMNS: CredibleSetDataType[] = ["GWAS", "eQTL", "pQTL", "sQTL", "caQTL"];

export const buildDataTypeRows = (
  rows: DataTypeSummaryRow[],
  selectedPopulation: string | undefined
): ExportRow[] =>
  rows.map((r) => {
    const row: ExportRow = {
      variant: toDashVariant(r.variant),
      rsid: r.rsid ?? NA,
      [afKey(selectedPopulation)]: afValue(r.gnomad, selectedPopulation),
      most_severe: cleanConsequence(r.consequence ?? "") || NA,
      most_severe_gene: r.gene ?? NA,
    };
    for (const dt of DATA_TYPE_COLUMNS) row[`${dt}_CS`] = r.counts[dt] ?? 0;
    row.total_CS = r.total;
    return row;
  });

export const exportDataTypeComparison = (
  variantInput: string,
  rows: DataTypeSummaryRow[],
  selectedPopulation: string | undefined
): void => {
  const exportRows = buildDataTypeRows(rows, selectedPopulation);
  writeTsv(
    exportRows,
    `variant_annotation_${exportRows.length}_variants_data_types_${shortHash(variantInput)}`
  );
};

/* ────────────────────────────────────────────────────────────────────────────
 * Phenotype summary — the displayed per-trait counts table.
 * ──────────────────────────────────────────────────────────────────────────── */

export const buildPhenotypeSummaryRows = (
  rows: PhenoSummaryRow[],
  hasBetas: boolean
): ExportRow[] =>
  rows.map((r) => {
    const row: ExportRow = {
      type: r.dataType,
      resource: r.resource,
      trait: r.linkedGenes?.length ? r.linkedGenes.join(", ") : formatTraitName(r.phenostring),
      peak: r.peak ?? NA,
      variants: r.variantCount,
    };
    if (hasBetas) {
      row.consistent = r.consistentCount ?? 0;
      row.opposite = r.oppositeCount ?? 0;
    }
    return row;
  });

export const exportPhenotypeSummaryTable = (
  variantInput: string,
  rows: PhenoSummaryRow[],
  hasBetas: boolean
): void => {
  const exportRows = buildPhenotypeSummaryRows(rows, hasBetas);
  writeTsv(exportRows, `pheno_annotation_${exportRows.length}_phenos_${shortHash(variantInput)}`);
};

/**
 * Variant × phenotype beta grid (legacy "download variant/phenotype beta grid"): a matrix with one
 * row per trait and one column per input variant, the cell holding that variant's effect-size beta in
 * the trait's credible set, or NA when it is not a member (after the current filters). Rows are sorted
 * by how many variants have a non-NA value, matching the legacy export.
 */
export const buildPhenoBetaGridRows = (
  variants: VariantResult[],
  phenotypes: NormalizedResponse["phenotypes"]
): ExportRow[] => {
  const variantIds = variants.map((v) => v.variant);
  interface TraitAcc {
    resource: string;
    traitOriginal: string;
    phenostring: string;
    betas: Map<string, number>;
  }
  const acc = new Map<string, TraitAcc>();
  for (const v of variants) {
    for (const cs of v.credibleSets) {
      const id = `${cs.resource}|${cs.trait}`;
      let a = acc.get(id);
      if (!a) {
        a = {
          resource: cs.resource,
          traitOriginal: cs.traitOriginal,
          phenostring: phenotypes[id]?.phenostring ?? cs.trait,
          betas: new Map(),
        };
        acc.set(id, a);
      }
      // a variant can be in several of a trait's credible sets; keep the strongest-effect beta.
      const prev = a.betas.get(v.variant);
      if (prev === undefined || Math.abs(cs.beta) > Math.abs(prev)) a.betas.set(v.variant, cs.beta);
    }
  }

  return [...acc.values()]
    .map((a) => {
      const row: ExportRow = { phenotype: `${a.resource}:${a.traitOriginal}:${a.phenostring}` };
      let nonNA = 0;
      for (const vid of variantIds) {
        const beta = a.betas.get(vid);
        // colon `vid` indexes the betas map; the emitted column header is the legacy dash form.
        const col = toDashVariant(vid);
        if (beta === undefined) {
          row[col] = NA;
        } else {
          row[col] = beta;
          nonNA += 1;
        }
      }
      return { row, nonNA };
    })
    .sort((a, b) => b.nonNA - a.nonNA)
    .map((x) => x.row);
};

export const exportPhenoBetaGrid = (
  variantInput: string,
  variants: VariantResult[],
  phenotypes: NormalizedResponse["phenotypes"]
): void => {
  const rows = buildPhenoBetaGridRows(variants, phenotypes);
  writeTsv(
    rows,
    `pheno_annotation_${rows.length}_phenos_variant_beta_grid_${shortHash(variantInput)}`
  );
};

/* ────────────────────────────────────────────────────────────────────────────
 * Tissue & cell type summary — the displayed counts, plus a flattened with-variants export.
 * ──────────────────────────────────────────────────────────────────────────── */

export const buildTissueSummaryRows = (rows: TissueSummaryRow[]): ExportRow[] =>
  rows.map((r) => ({
    tissue: formatTissue(r.tissueOrCellType),
    type: r.dataType,
    variants: r.variantCount,
  }));

export const exportTissueSummaryTable = (
  variantInput: string,
  rows: TissueSummaryRow[],
  dataType: "eQTL" | "caQTL"
): void => {
  const exportRows = buildTissueSummaryRows(rows);
  writeTsv(
    exportRows,
    `tissue_summary_${dataType}_${exportRows.length}_tissues_${shortHash(variantInput + dataType)}`
  );
};

/**
 * Tissue table with variants (legacy "download tissue table with variants"): one row per QTL
 * credible-set membership of the chosen data type (eQTL/caQTL), carrying the per-variant stats.
 */
export const buildTissueWithVariantsRows = (
  variants: VariantResult[],
  dataType: "eQTL" | "caQTL",
  selectedPopulation: string | undefined,
  traitName: TraitName
): ExportRow[] => {
  const rows: ExportRow[] = [];
  for (const v of variants) {
    for (const cs of v.credibleSets) {
      if (cs.dataType !== dataType || !cs.cellType) continue;
      rows.push({
        tissue: formatTissue(cs.cellType),
        ...variantIdentity(v, selectedPopulation),
        type: cs.dataType,
        dataset: cs.dataset,
        trait: displayTrait(cs, traitName),
        "p-value": cs.mlog10p === null ? NA : pValRepr(cs.mlog10p),
        beta: cs.beta,
        pip: Number.isNaN(cs.pip) ? NA : cs.pip,
      });
    }
  }
  return rows;
};

export const exportTissueWithVariants = (
  variantInput: string,
  variants: VariantResult[],
  dataType: "eQTL" | "caQTL",
  selectedPopulation: string | undefined,
  traitName: TraitName
): void => {
  const rows = buildTissueWithVariantsRows(variants, dataType, selectedPopulation, traitName);
  writeTsv(
    rows,
    `tissue_${dataType}_with_variants_${rows.length}_rows_${shortHash(variantInput + dataType)}`
  );
};

/* ────────────────────────────────────────────────────────────────────────────
 * Phenotype search — the per-variant summary-stat results for one chosen phenotype.
 * ──────────────────────────────────────────────────────────────────────────── */

export const buildPhenotypeSearchRows = (rows: PhenoSearchRow[]): ExportRow[] =>
  rows.map((r) => ({
    variant: toDashVariant(r.variant),
    rsid: r.rsid ?? NA,
    af: r.af === null || Number.isNaN(r.af) ? NA : r.af,
    most_severe: cleanConsequence(r.consequence ?? "") || NA,
    most_severe_gene: r.gene ?? NA,
    "p-value": r.mlog10p === null || Number.isNaN(r.mlog10p) ? NA : pValRepr(r.mlog10p),
    beta: Number.isNaN(r.beta) ? NA : r.beta,
    se: Number.isNaN(r.se) ? NA : r.se,
    in_credible_set: r.inCredibleSet ? "yes" : "no",
    pip: r.pip ?? NA,
  }));

export const exportPhenotypeSearch = (
  rows: PhenoSearchRow[],
  phenoCode: string,
  phenoResource: string
): void => {
  const exportRows = buildPhenotypeSearchRows(rows);
  writeTsv(
    exportRows,
    `phenotype_search_${phenoResource}_${phenoCode}_${exportRows.length}_variants_${shortHash(
      `${phenoResource}:${phenoCode}`
    )}`
  );
};
