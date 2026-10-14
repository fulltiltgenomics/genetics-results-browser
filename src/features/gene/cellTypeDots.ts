import { CellTypeExpressionSummaryRow } from "@/types/types.normalized";

/**
 * Layout of the tissue x cell type dot plot: rows are cell types, columns are tissues, and a dot
 * exists only for pairs the summary file has a row for (most pairs do not exist).
 */

export interface DotGrid {
  cellTypes: string[]; // row order: strongest-expressing first
  tissues: string[]; // column order: strongest-expressing first
  dots: CellTypeExpressionSummaryRow[]; // only rows with a numeric mean and fraction
  maxMean: number;
  maxFrac: number;
}

const maxBy = (rows: CellTypeExpressionSummaryRow[], key: (r: CellTypeExpressionSummaryRow) => string) => {
  const best = new Map<string, number>();
  for (const r of rows) {
    best.set(key(r), Math.max(best.get(key(r)) ?? -Infinity, r.meanLog1pCp10k ?? -Infinity));
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
};

/** `maxCellTypes` keeps the plot legible: a gene can have hundreds of cell types. */
export const buildDotGrid = (rows: CellTypeExpressionSummaryRow[], maxCellTypes: number): DotGrid => {
  const usable = rows.filter((r) => r.meanLog1pCp10k != null && r.fracExpressing != null);
  const cellTypes = maxBy(usable, (r) => r.cellType).slice(0, maxCellTypes);
  const keep = new Set(cellTypes);
  const dots = usable.filter((r) => keep.has(r.cellType));
  return {
    cellTypes,
    tissues: maxBy(dots, (r) => r.tissue),
    dots,
    maxMean: Math.max(0, ...dots.map((r) => r.meanLog1pCp10k!)),
    maxFrac: Math.max(0, ...dots.map((r) => r.fracExpressing!)),
  };
};

// the CELLxGENE explorer for one dataset, addressed by dataset id
export const explorerUrl = (datasetId: string): string =>
  `https://cellxgene.cziscience.com/e/${encodeURIComponent(datasetId)}.cxg/`;

export const CELLXGENE_GENE_EXPRESSION_URL = "https://cellxgene.cziscience.com/gene-expression";
