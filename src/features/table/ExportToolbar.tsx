import { Box, Button } from "@mui/material";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import { MRT_RowData, MRT_TableInstance } from "material-react-table";
import {
  DataTypeSummaryRow,
  PhenoSearchRow,
  PhenoSummaryRow,
  TissueSummaryRow,
  VariantResult,
} from "../../types/types.normalized";
import { useDataStore } from "../../store/store";
import { makeTraitNameResolver } from "./utils/tableutil";
import {
  exportCredibleSets,
  exportDataTypeComparison,
  exportPhenoBetaGrid,
  exportPhenotypeSearch,
  exportPhenotypeSummaryTable,
  exportTissueSummaryTable,
  exportTissueWithVariants,
  exportVariantMainTable,
} from "./utils/export";
import { useMemo } from "react";

/**
 * Per-table TSV download toolbars, mounted via each table's renderTopToolbarCustomActions. They
 * re-instate the legacy ExportToolbar/PhenoExportToolbar/TissueExportToolbar downloads on the new
 * credible-set data model. Tables whose rows are the export shape pass their MRT instance so the
 * download respects the active column filters/sort; others pass their already-derived data directly.
 */

const toolbarSx = {
  display: "flex",
  gap: "0.75rem",
  p: "0.5rem",
  flexWrap: "wrap" as const,
  flexDirection: "row" as const,
};

// typed rows visible after column filtering/sorting, before pagination (so the export is the whole
// filtered table, not just the current page) — matches the legacy getExpandedRowModel() behaviour.
const visibleRows = <T extends MRT_RowData>(table: MRT_TableInstance<T>): T[] =>
  table.getPrePaginationRowModel().rows.map((r) => r.original);

const DownloadButton = ({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) => (
  <Button
    disabled={disabled}
    color="primary"
    onClick={onClick}
    startIcon={<FileDownloadIcon />}
    variant="contained"
    sx={{ whiteSpace: "nowrap", textTransform: "none" }}>
    {label}
  </Button>
);

export const VariantTableExportButtons = ({
  table,
  showTraitCounts,
}: {
  table: MRT_TableInstance<VariantResult>;
  showTraitCounts: boolean;
}) => {
  const variantInput = useDataStore((state) => state.variantInput) ?? "";
  const selectedPopulation = useDataStore((state) => state.selectedPopulation);
  const cisWindow = useDataStore((state) => state.cisWindow);
  const phenotypes = useDataStore((state) => state.normalizedData?.phenotypes);
  const hasBetas = useDataStore((state) => state.normalizedData?.hasBetas ?? false);
  const hasCustomValues = useDataStore((state) => state.normalizedData?.hasCustomValues ?? false);
  const traitName = useMemo(() => makeTraitNameResolver(phenotypes), [phenotypes]);

  const empty = table.getPrePaginationRowModel().rows.length === 0;

  return (
    <Box sx={toolbarSx}>
      <DownloadButton
        label="download variants table"
        disabled={empty}
        onClick={() =>
          exportVariantMainTable(
            variantInput,
            visibleRows(table),
            selectedPopulation,
            traitName,
            showTraitCounts,
            hasBetas,
            hasCustomValues
          )
        }
      />
      <DownloadButton
        label="download credible-set results"
        disabled={empty}
        onClick={() =>
          exportCredibleSets(
            variantInput,
            visibleRows(table),
            selectedPopulation,
            traitName,
            cisWindow
          )
        }
      />
    </Box>
  );
};

export const DataTypeExportButtons = ({
  table,
}: {
  table: MRT_TableInstance<DataTypeSummaryRow>;
}) => {
  const variantInput = useDataStore((state) => state.variantInput) ?? "";
  const selectedPopulation = useDataStore((state) => state.selectedPopulation);
  const empty = table.getPrePaginationRowModel().rows.length === 0;

  return (
    <Box sx={toolbarSx}>
      <DownloadButton
        label="download data type comparison"
        disabled={empty}
        onClick={() => exportDataTypeComparison(variantInput, visibleRows(table), selectedPopulation)}
      />
    </Box>
  );
};

export const PhenoSummaryExportButtons = ({
  table,
}: {
  table: MRT_TableInstance<PhenoSummaryRow>;
}) => {
  const variantInput = useDataStore((state) => state.variantInput) ?? "";
  const filteredVariants = useDataStore((state) => state.filteredVariants);
  const phenotypes = useDataStore((state) => state.normalizedData?.phenotypes ?? {});
  const hasBetas = useDataStore((state) => state.normalizedData?.hasBetas ?? false);
  const empty = table.getPrePaginationRowModel().rows.length === 0;

  return (
    <Box sx={toolbarSx}>
      <DownloadButton
        label="download phenotype summary table"
        disabled={empty}
        onClick={() => exportPhenotypeSummaryTable(variantInput, visibleRows(table), hasBetas)}
      />
      <DownloadButton
        label="download variant/phenotype beta grid"
        disabled={empty}
        onClick={() => exportPhenoBetaGrid(variantInput, filteredVariants, phenotypes)}
      />
    </Box>
  );
};

export const TissueExportButtons = ({
  summaryRows,
  tissueVariants,
  dataType,
}: {
  summaryRows: TissueSummaryRow[];
  // the same eQTL/caQTL-filtered variant set the tissue summary is derived from, for the with-variants export.
  tissueVariants: VariantResult[];
  dataType: "eQTL" | "caQTL";
}) => {
  const variantInput = useDataStore((state) => state.variantInput) ?? "";
  const selectedPopulation = useDataStore((state) => state.selectedPopulation);
  const phenotypes = useDataStore((state) => state.normalizedData?.phenotypes);
  const traitName = useMemo(() => makeTraitNameResolver(phenotypes), [phenotypes]);
  const empty = summaryRows.length === 0;

  return (
    <Box sx={toolbarSx}>
      <DownloadButton
        label="download tissue summary table"
        disabled={empty}
        onClick={() => exportTissueSummaryTable(variantInput, summaryRows, dataType)}
      />
      <DownloadButton
        label="download tissue table with variants"
        disabled={empty}
        onClick={() =>
          exportTissueWithVariants(
            variantInput,
            tissueVariants,
            dataType,
            selectedPopulation,
            traitName
          )
        }
      />
    </Box>
  );
};

export const PhenotypeSearchExportButton = ({
  rows,
  phenoCode,
  phenoResource,
}: {
  rows: PhenoSearchRow[];
  phenoCode: string;
  phenoResource: string;
}) => (
  <Box sx={toolbarSx}>
    <DownloadButton
      label="download search results"
      disabled={rows.length === 0}
      onClick={() => exportPhenotypeSearch(rows, phenoCode, phenoResource)}
    />
  </Box>
);
