import {
  CellTypeExpressionDatasetRow,
  CellTypeExpressionSummaryRow,
  GeneBurdenRow,
  GeneExpressionRow,
} from "@/types/types.normalized";
import { ExportRow, NA, writeTsv } from "../table/utils/export";
import { datasetDisplayName, formatTraitName, pValRepr } from "../table/utils/tableutil";
import { gtexTissueLabel } from "./gtexTissues";
import { hpaLevelLabel, hpaTissueLabel } from "./hpa";

/**
 * TSV downloads for the gene evidence tab, in the same format as the variant-table exports: tab
 * separated, header row from the object keys, "NA" for absent values.
 *
 * Each table's rows carry the labels shown in the UI plus the machine-readable values behind them —
 * the raw tissue id, and -log10(p) alongside the formatted p-value, which underflows to 0 as a plain
 * number past ~1e-308. As with the other exports, `build*Rows` is pure so the TSV content is unit
 * tested without a browser download.
 */

const num = (v: number | null | undefined): string | number =>
  v == null || Number.isNaN(v) ? NA : v;

export const buildGeneBurdenRows = (rows: GeneBurdenRow[]): ExportRow[] =>
  rows.map((r) => ({
    gene: r.gene || NA,
    gene_id: r.geneId || NA,
    trait: formatTraitName(r.trait) || NA,
    trait_original: r.traitOriginal || NA,
    dataset: datasetDisplayName(r.dataset) || NA,
    annotation: r.annotation || NA,
    "p-value": r.mlog10pBurden == null ? NA : pValRepr(r.mlog10pBurden),
    mlog10p: num(r.mlog10pBurden),
    beta: num(r.beta),
    se: num(r.se),
    total_variants: num(r.totalVariants),
    n_cases: num(r.nCases),
    n_controls: num(r.nControls),
  }));

export const exportGeneBurden = (gene: string, rows: GeneBurdenRow[]): void => {
  const exportRows = buildGeneBurdenRows(rows);
  writeTsv(exportRows, `gene_burden_${gene}_${exportRows.length}_rows`);
};

export const buildGtexExpressionRows = (rows: GeneExpressionRow[]): ExportRow[] =>
  rows.map((r) => ({
    gene: r.geneName || NA,
    gene_id: r.geneId || NA,
    tissue: gtexTissueLabel(r.tissueCell),
    tissue_id: r.tissueCell,
    median_tpm: num(r.level),
    dataset: datasetDisplayName(r.dataset) || NA,
  }));

export const exportGtexExpression = (gene: string, rows: GeneExpressionRow[]): void => {
  const exportRows = buildGtexExpressionRows(rows);
  writeTsv(exportRows, `expression_gtex_${gene}_${exportRows.length}_tissues`);
};

export const buildHpaExpressionRows = (rows: GeneExpressionRow[]): ExportRow[] =>
  rows.map((r) => ({
    gene: r.geneName || NA,
    gene_id: r.geneId || NA,
    tissue_cell: hpaTissueLabel(r.tissueCell),
    tissue_cell_id: r.tissueCell,
    level: hpaLevelLabel(r.levelRaw) || NA,
    dataset: datasetDisplayName(r.dataset) || NA,
  }));

export const exportHpaExpression = (gene: string, rows: GeneExpressionRow[]): void => {
  const exportRows = buildHpaExpressionRows(rows);
  writeTsv(exportRows, `expression_hpa_${gene}_${exportRows.length}_rows`);
};

export const buildCellTypeSummaryRows = (rows: CellTypeExpressionSummaryRow[]): ExportRow[] =>
  rows.map((r) => ({
    gene: r.geneName || NA,
    gene_id: r.geneId || NA,
    cell_type: r.cellType,
    cell_type_id: r.cellTypeId,
    tissue: r.tissue,
    tissue_id: r.tissueId,
    mean_log1p_cp10k: num(r.meanLog1pCp10k),
    frac_expressing: num(r.fracExpressing),
    n_cells: num(r.nCells),
    n_donors: num(r.nDonors),
    n_datasets: num(r.nDatasets),
    tau: num(r.tau),
    donor_pseudobulk_mean_cp10k: num(r.donorPseudobulkMeanCp10k),
    donor_pseudobulk_n_donors: num(r.donorPseudobulkNDonors),
  }));

export const exportCellTypeSummary = (gene: string, rows: CellTypeExpressionSummaryRow[]): void => {
  const exportRows = buildCellTypeSummaryRows(rows);
  writeTsv(exportRows, `cell_type_expression_${gene}_${exportRows.length}_rows`);
};

export const buildCellTypeDatasetRows = (rows: CellTypeExpressionDatasetRow[]): ExportRow[] =>
  rows.map((r) => ({
    gene: r.geneName || NA,
    gene_id: r.geneId || NA,
    dataset_id: r.datasetId,
    status: r.status,
    tissue: r.tissue ?? NA,
    tissue_general: r.tissueGeneral ?? NA,
    cell_type: r.cellType ?? NA,
    cell_type_rollup: r.cellTypeRollup ?? NA,
    disease: r.disease ?? NA,
    assay: r.assay ?? NA,
    suspension_type: r.suspensionType ?? NA,
    n_cells: num(r.nCells),
    n_donors: num(r.nDonors),
    mean_log1p_cp10k: num(r.meanLog1pCp10k),
    frac_expressing: num(r.fracExpressing),
    donor_pseudobulk_mean_cp10k: num(r.donorPseudobulkMeanCp10k),
  }));

export const exportCellTypeDatasets = (gene: string, rows: CellTypeExpressionDatasetRow[]): void => {
  const exportRows = buildCellTypeDatasetRows(rows);
  writeTsv(exportRows, `cell_type_expression_by_dataset_${gene}_${exportRows.length}_rows`);
};
