import { Box, Button } from "@mui/material";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import { MRT_RowData, MRT_TableInstance } from "material-react-table";
import {
  DataTypeSummaryRow,
  GnomadFreq,
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
  withLatestGnomad,
} from "./utils/export";
import { useMemo } from "react";

// freshest gnomAD per variant from the store — read AFTER awaiting ensureAllGnomadLoaded so an export
// that emits the AF column carries the fully-loaded values regardless of React re-render timing.
const latestGnomadByVariant = (): Map<string, GnomadFreq | undefined> =>
  new Map(
    (useDataStore.getState().normalizedData?.variants ?? []).map((v) => [v.variant, v.gnomad])
  );

/**
 * Per-table TSV download toolbars, mounted via each table's renderTopToolbarCustomActions. They
 * re-instate the legacy ExportToolbar/PhenoExportToolbar/TissueExportToolbar downloads on the new
 * credible-set data model. Tables whose rows are the export shape pass their MRT instance so the
 * download respects the active column filters/sort; others pass their already-derived data directly.
 */

export const toolbarSx = {
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

export const DownloadButton = ({
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
  const ensureAllGnomadLoaded = useDataStore((state) => state.ensureAllGnomadLoaded);
  const traitName = useMemo(() => makeTraitNameResolver(phenotypes), [phenotypes]);

  const empty = table.getPrePaginationRowModel().rows.length === 0;

  // both exports emit the gnomAD AF column, so ensure gnomAD is loaded for EVERY row first, then
  // re-read it from the store onto the visible (whole filtered/sorted) rows.
  const onDownloadVariants = async () => {
    await ensureAllGnomadLoaded();
    exportVariantMainTable(
      variantInput,
      withLatestGnomad(visibleRows(table), latestGnomadByVariant()),
      selectedPopulation,
      traitName,
      showTraitCounts,
      hasBetas,
      hasCustomValues
    );
  };
  const onDownloadFullResults = async () => {
    await ensureAllGnomadLoaded();
    exportCredibleSets(
      variantInput,
      withLatestGnomad(visibleRows(table), latestGnomadByVariant()),
      selectedPopulation,
      traitName,
      cisWindow
    );
  };

  return (
    <Box sx={toolbarSx}>
      <DownloadButton label="DOWNLOAD VARIANTS TABLE" disabled={empty} onClick={onDownloadVariants} />
      <DownloadButton
        label="DOWNLOAD FULL RESULTS"
        disabled={empty}
        onClick={onDownloadFullResults}
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
  const ensureAllGnomadLoaded = useDataStore((state) => state.ensureAllGnomadLoaded);
  const empty = table.getPrePaginationRowModel().rows.length === 0;

  // this export emits the gnomAD AF column too, so load gnomAD for every row before building it.
  const onDownload = async () => {
    await ensureAllGnomadLoaded();
    exportDataTypeComparison(
      variantInput,
      withLatestGnomad(visibleRows(table), latestGnomadByVariant()),
      selectedPopulation
    );
  };

  return (
    <Box sx={toolbarSx}>
      <DownloadButton label="DOWNLOAD DATA TYPE COMPARISON" disabled={empty} onClick={onDownload} />
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
        label="DOWNLOAD PHENOTYPE SUMMARY TABLE"
        disabled={empty}
        onClick={() => exportPhenotypeSummaryTable(variantInput, visibleRows(table), hasBetas)}
      />
      <DownloadButton
        label="DOWNLOAD VARIANT/PHENOTYPE BETA GRID"
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
  const ensureAllGnomadLoaded = useDataStore((state) => state.ensureAllGnomadLoaded);
  const traitName = useMemo(() => makeTraitNameResolver(phenotypes), [phenotypes]);
  const empty = summaryRows.length === 0;

  // the summary export carries no gnomAD; the with-variants export emits the AF column, so that one
  // ensures gnomAD is loaded for every row first and re-reads it from the store.
  const onDownloadWithVariants = async () => {
    await ensureAllGnomadLoaded();
    exportTissueWithVariants(
      variantInput,
      withLatestGnomad(tissueVariants, latestGnomadByVariant()),
      dataType,
      selectedPopulation,
      traitName
    );
  };

  return (
    <Box sx={toolbarSx}>
      <DownloadButton
        label="DOWNLOAD TISSUE SUMMARY TABLE"
        disabled={empty}
        onClick={() => exportTissueSummaryTable(variantInput, summaryRows, dataType)}
      />
      <DownloadButton
        label="DOWNLOAD TISSUE TABLE WITH VARIANTS"
        disabled={empty}
        onClick={onDownloadWithVariants}
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
      label="DOWNLOAD SEARCH RESULTS"
      disabled={rows.length === 0}
      onClick={() => exportPhenotypeSearch(rows, phenoCode, phenoResource)}
    />
  </Box>
);
