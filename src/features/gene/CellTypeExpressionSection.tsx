import { useMemo, useState } from "react";
import { Box, Button, CircularProgress, Link, Typography } from "@mui/material";
import { MaterialReactTable, MRT_Cell, MRT_ColumnDef, MRT_RowData } from "material-react-table";
import {
  CellTypeExpressionNotConfigured,
  CellTypeExpressionNotYetAvailable,
  useCellTypeExpressionDatasets,
  useCellTypeExpressionSummary,
} from "@/store/serverQuery";
import {
  CellTypeExpressionDatasetRow,
  CellTypeExpressionSummaryRow,
} from "@/types/types.normalized";
import { naInfSort } from "../table/utils/sorting";
import { DownloadButton, toolbarSx } from "../table/ExportToolbar";
import CellTypeDotPlot from "./CellTypeDotPlot";
import { CELLXGENE_GENE_EXPRESSION_URL, explorerUrl } from "./cellTypeDots";
import { exportCellTypeDatasets, exportCellTypeSummary } from "./geneEvidenceExport";

/**
 * Single-cell expression by cell type (CELLxGENE) for the gene evidence tab. Renders nothing at all
 * where the deployment has no such data. All values are log1p CP10K, not TPM.
 */

const DEFAULT_CELL_TYPES = 30;

const numCell =
  (precision: number) =>
  <T extends MRT_RowData>({ cell }: { cell: MRT_Cell<T, unknown> }) => {
    const v = cell.getValue<number | null>();
    return v == null || Number.isNaN(v) ? "" : v.toPrecision(precision);
  };

const countCell = <T extends MRT_RowData>({ cell }: { cell: MRT_Cell<T, unknown> }) => {
  const v = cell.getValue<number | null>();
  return v == null ? "" : v.toLocaleString();
};

const summaryColumns: MRT_ColumnDef<CellTypeExpressionSummaryRow>[] = [
  { accessorKey: "cellType", header: "cell type", id: "cellType", size: 200 },
  { accessorKey: "tissue", header: "tissue", id: "tissue", size: 140 },
  {
    accessorKey: "meanLog1pCp10k",
    header: "mean log1p CP10K",
    id: "meanLog1pCp10k",
    sortingFn: naInfSort,
    sortDescFirst: true,
    size: 150,
    Cell: numCell(3),
  },
  {
    accessorKey: "fracExpressing",
    header: "fraction expressing",
    id: "fracExpressing",
    sortingFn: naInfSort,
    sortDescFirst: true,
    size: 150,
    Cell: numCell(3),
  },
  { accessorKey: "nCells", header: "cells", id: "nCells", sortingFn: naInfSort, size: 90, Cell: countCell },
  { accessorKey: "nDonors", header: "donors", id: "nDonors", sortingFn: naInfSort, size: 80, Cell: countCell },
  { accessorKey: "nDatasets", header: "datasets", id: "nDatasets", sortingFn: naInfSort, size: 80, Cell: countCell },
  { accessorKey: "tau", header: "tau", id: "tau", sortingFn: naInfSort, size: 70, Cell: numCell(3) },
  {
    // secondary measure: per-donor means in CP10K, blank where the group has no usable donors
    accessorKey: "donorPseudobulkMeanCp10k",
    header: "donor pseudobulk mean CP10K (secondary)",
    id: "donorPseudobulkMeanCp10k",
    sortingFn: naInfSort,
    sortDescFirst: true,
    size: 190,
    Cell: numCell(3),
  },
  {
    accessorKey: "donorPseudobulkNDonors",
    header: "pseudobulk donors",
    id: "donorPseudobulkNDonors",
    sortingFn: naInfSort,
    size: 110,
    Cell: countCell,
  },
];

const datasetColumns: MRT_ColumnDef<CellTypeExpressionDatasetRow>[] = [
  {
    accessorKey: "datasetId",
    header: "dataset",
    id: "datasetId",
    size: 200,
    Cell: ({ cell }) => (
      <Link href={explorerUrl(cell.getValue<string>())} target="_blank" rel="noopener noreferrer">
        {cell.getValue<string>().slice(0, 8)}…
      </Link>
    ),
  },
  {
    accessorKey: "status",
    header: "status",
    id: "status",
    size: 150,
    Cell: ({ cell }) =>
      cell.getValue<string>() === "measured_no_row" ? (
        <Typography variant="inherit" color="text.secondary" sx={{ fontStyle: "italic" }}>
          measured, not detected
        </Typography>
      ) : (
        "present"
      ),
  },
  {
    id: "cellType",
    header: "cell type",
    accessorFn: (r) => r.cellTypeRollup ?? r.cellType ?? "",
    size: 180,
  },
  {
    id: "tissue",
    header: "tissue",
    accessorFn: (r) => r.tissue ?? r.tissueGeneral ?? "",
    size: 150,
  },
  { accessorKey: "disease", header: "disease", id: "disease", size: 130 },
  { accessorKey: "assay", header: "assay", id: "assay", size: 130 },
  {
    accessorKey: "meanLog1pCp10k",
    header: "mean log1p CP10K",
    id: "meanLog1pCp10k",
    sortingFn: naInfSort,
    sortDescFirst: true,
    size: 140,
    Cell: numCell(3),
  },
  {
    accessorKey: "fracExpressing",
    header: "fraction expressing",
    id: "fracExpressing",
    sortingFn: naInfSort,
    size: 140,
    Cell: numCell(3),
  },
  { accessorKey: "nCells", header: "cells", id: "nCells", sortingFn: naInfSort, size: 90, Cell: countCell },
  { accessorKey: "nDonors", header: "donors", id: "nDonors", sortingFn: naInfSort, size: 80, Cell: countCell },
  {
    accessorKey: "donorPseudobulkMeanCp10k",
    header: "donor pseudobulk mean CP10K (secondary)",
    id: "donorPseudobulkMeanCp10k",
    sortingFn: naInfSort,
    size: 190,
    Cell: numCell(3),
  },
];

const tableProps = {
  enableTopToolbar: true,
  enableColumnFilters: false,
  enableGlobalFilter: false,
  enableDensityToggle: false,
  muiTableBodyCellProps: { sx: { fontSize: "0.75rem" } },
  sortingFns: { naInfSort },
} as const;

const CellTypeExpressionSection = ({ geneName }: { geneName: string }) => {
  const summary = useCellTypeExpressionSummary(geneName);
  const [view, setView] = useState<"plot" | "table">("plot");
  const [showAll, setShowAll] = useState(false);
  const [drill, setDrill] = useState(false);
  const datasets = useCellTypeExpressionDatasets(geneName, drill);

  const rows = useMemo(() => summary.data?.rows ?? [], [summary.data]);
  const datasetRows = useMemo(() => datasets.data?.rows ?? [], [datasets.data]);

  if (summary.error instanceof CellTypeExpressionNotConfigured) {
    return null;
  }

  const title = "Expression by cell type (CELLxGENE)";
  const release = summary.data?.release;
  let body: React.ReactNode;
  if (summary.isPending) {
    body = (
      <Box display="flex" alignItems="center" gap={1}>
        <CircularProgress size={18} />
        <Typography variant="body2">loading…</Typography>
      </Box>
    );
  } else if (summary.error instanceof CellTypeExpressionNotYetAvailable) {
    body = (
      <Typography variant="body2" color="text.secondary">
        single-cell expression data is not yet available
      </Typography>
    );
  } else if (summary.isError) {
    body = (
      <Typography color="error" variant="body2">
        failed to load: {summary.error.message}
      </Typography>
    );
  } else if (rows.length === 0) {
    body = (
      <Typography variant="body2" color="text.secondary">
        no single-cell expression data for this gene
      </Typography>
    );
  } else {
    body = (
      <>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1, flexWrap: "wrap" }}>
          <Button size="small" variant={view === "plot" ? "contained" : "outlined"} onClick={() => setView("plot")}>
            dot plot
          </Button>
          <Button size="small" variant={view === "table" ? "contained" : "outlined"} onClick={() => setView("table")}>
            table
          </Button>
          <DownloadButton
            label="DOWNLOAD CELL TYPE EXPRESSION"
            disabled={rows.length === 0}
            onClick={() => exportCellTypeSummary(geneName, rows)}
          />
          <Link href={CELLXGENE_GENE_EXPRESSION_URL} target="_blank" rel="noopener noreferrer" variant="body2">
            CELLxGENE Gene Expression
          </Link>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          normal tissue pooled across datasets. Values are mean log1p CP10K (not TPM); dot colour is the
          mean, dot size the fraction of cells expressing. Donor pseudobulk is a secondary measure.
        </Typography>
        {view === "plot" ? (
          <>
            <CellTypeDotPlot rows={rows} maxCellTypes={showAll ? Infinity : DEFAULT_CELL_TYPES} />
            {new Set(rows.map((r) => r.cellType)).size > DEFAULT_CELL_TYPES && (
              <Button size="small" onClick={() => setShowAll((v) => !v)}>
                {showAll ? `show top ${DEFAULT_CELL_TYPES} cell types` : "show all cell types"}
              </Button>
            )}
          </>
        ) : (
          <MaterialReactTable
            {...tableProps}
            data={rows}
            columns={summaryColumns}
            enablePagination={rows.length > 20}
            initialState={{ density: "compact", sorting: [{ id: "meanLog1pCp10k", desc: true }] }}
          />
        )}

        <Box sx={{ mt: 2 }}>
          {!drill ? (
            <Button size="small" variant="outlined" onClick={() => setDrill(true)}>
              show per-dataset breakdown
            </Button>
          ) : datasets.isPending ? (
            <CircularProgress size={18} />
          ) : datasets.isError ? (
            <Typography color="error" variant="body2">
              failed to load datasets: {datasets.error.message}
            </Typography>
          ) : (
            <>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Per dataset
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                each link opens the dataset in the CELLxGENE explorer, whose page carries its citation.
                Datasets that did not measure this gene, or whose every group was suppressed, are absent.
              </Typography>
              <MaterialReactTable
                {...tableProps}
                data={datasetRows}
                columns={datasetColumns}
                enablePagination={datasetRows.length > 20}
                initialState={{ density: "compact", sorting: [{ id: "meanLog1pCp10k", desc: true }] }}
                renderTopToolbarCustomActions={({ table }) => (
                  <Box sx={toolbarSx}>
                    <DownloadButton
                      label="DOWNLOAD PER-DATASET EXPRESSION"
                      disabled={datasetRows.length === 0}
                      onClick={() =>
                        exportCellTypeDatasets(
                          geneName,
                          table.getPrePaginationRowModel().rows.map((r) => r.original)
                        )
                      }
                    />
                  </Box>
                )}
              />
            </>
          )}
        </Box>
      </>
    );
  }

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        {title}
        {release && (
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            release {release}
          </Typography>
        )}
      </Typography>
      {body}
    </Box>
  );
};

export default CellTypeExpressionSection;
