import { Box, useTheme } from "@mui/material";
import { MaterialReactTable, MRT_SortingState } from "material-react-table";
import { useNavigate } from "react-router-dom";
import { naInfSort, variantSort } from "../utils/sorting";
import VariantCredibleSetTable from "./VariantCredibleSetTable";
import { VariantResult } from "../../../types/types.normalized";
import { useMemo, useState } from "react";
import { getVariantMainTableColumnsNormalized } from "./VariantMainTable.columns.normalized";
import { useDataStore } from "../../../store/store";
import { useNormalizedQuery } from "../../../store/serverQuery";
import { useChatSeedStore } from "../../../store/store.chatSeed";
import { cleanConsequence, makeTraitNameResolver } from "../utils/tableutil";

// build a concise, context-rich chat prompt from a variant row for the annotation -> chat hand-off
const buildVariantSeed = (row: VariantResult): string => {
  const rsid = row.annotation?.rsid;
  const gene = row.annotation?.gene;
  const consequence = cleanConsequence(row.annotation?.consequence ?? "");
  const descriptors = [rsid, gene, consequence].filter(Boolean).join(", ");
  const suffix = descriptors ? ` (${descriptors})` : "";
  return `Explain variant ${row.variant}${suffix}. What credible sets and colocalizations involve it?`;
};

/**
 * Credible-set-native main results table (refactor.md §4). Renders the store's reactive
 * filteredVariants (VariantResult[]) and expands each row into the single credible-set detail table.
 * The legacy "Association results" sub-table is gone (replaced by VariantCredibleSetTable).
 */
const VariantMainTable = (props: {
  data?: VariantResult[];
  showTraitCounts: boolean;
  enableTopToolbar: boolean;
}) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const setChatSeed = useChatSeedStore((state) => state.setChatSeed);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 });

  const variantInput = useDataStore((state) => state.variantInput)!;
  const filteredVariants = useDataStore((state) => state.filteredVariants);
  const normalizedData = useDataStore((state) => state.normalizedData);
  const selectedPopulation = useDataStore((state) => state.selectedPopulation);

  const { error, isError, isFetching, isLoading } = useNormalizedQuery(variantInput);

  const [sorting, setSorting] = useState<MRT_SortingState>([]);

  // seed the assistant chat from a variant row and route to /chat (triggered by the inline speech
  // bubble in the variant column — replaces the former row-actions menu).
  const askAssistant = (row: VariantResult) => {
    setChatSeed(buildVariantSeed(row));
    navigate("/chat");
  };

  // resolve a credible set's resource+trait to its human-readable phenostring (BFF-populated from
  // trait_name_mapping); falls back to the raw trait id for QTL gene symbols / unmapped codes.
  // underscores -> spaces for display (covers the top-association column and the detail table).
  const phenotypes = normalizedData?.phenotypes;
  // stable identity (depends only on phenotypes) so the columns memo that closes over it doesn't
  // rebuild every render — unstable columns/data are what trip MRT's reset-on-change loop.
  const traitName = useMemo(() => makeTraitNameResolver(phenotypes), [phenotypes]);

  const columns = useMemo(
    () =>
      getVariantMainTableColumnsNormalized(
        selectedPopulation,
        props.showTraitCounts,
        normalizedData?.hasBetas ?? false,
        normalizedData?.hasCustomValues ?? false,
        askAssistant,
        traitName
      ),
    [selectedPopulation, props.showTraitCounts, normalizedData?.hasBetas, normalizedData?.hasCustomValues, phenotypes]
  );

  // only show variants that are a member of at least one credible set after stage-2 filtering, so
  // toggling resources / data types / thresholds visibly changes the rows (mirrors the legacy table,
  // which dropped variants with no passing associations).
  // MUST be memoized: MaterialReactTable watches the `data` reference for its auto-reset, so a fresh
  // array every render makes it call setPagination -> re-render -> new array -> "Maximum update depth
  // exceeded" infinite loop (armed after the first expand/sort interaction).
  const tableData: VariantResult[] = useMemo(
    () => (props.data ?? filteredVariants).filter((v) => v.credibleSets.length > 0),
    [props.data, filteredVariants]
  );

  return (
    <MaterialReactTable
      data={tableData}
      columns={columns}
      enableTopToolbar={props.enableTopToolbar}
      // legacy ExportButtons (and its useServerQuery call) are intentionally not mounted here: the
      // BFF /v1/results now returns NormalizedResponse and the legacy export path reads the old
      // top-level data.data shape, so it always errors. csv/tsv export is migrated in its own task.
      enableColumnFilterModes
      // belt-and-suspenders against the reset-on-data-change loop above: never auto-reset the page
      // index when data/filters change (also nicer UX — expanding a row keeps your page/position).
      autoResetPageIndex={false}
      // the detail panel cell carries the default 1px row-separator border; during MUI's Collapse
      // open animation it briefly shows as a full-width line under the row before content fills in.
      // drop the border (and its padding when collapsed) so no line flashes on expand.
      muiDetailPanelProps={{ sx: { borderBottom: "none", borderTop: "none" } }}
      initialState={{
        showColumnFilters: true,
        density: "compact",
        columnOrder: ["mrt-row-expand"].concat(columns.map((c) => c.id!)),
      }}
      state={{
        isLoading,
        showAlertBanner: isError,
        showProgressBars: isFetching,
        pagination,
        columnOrder: ["mrt-row-expand"].concat(columns.map((c) => c.id!)),
        sorting,
      }}
      onSortingChange={setSorting}
      onPaginationChange={setPagination}
      // stable row id keyed on the variant so the expanded credible-set detail (and the lazy coloc
      // panel nested inside it) survives re-renders triggered by the per-CS coloc query resolving
      getRowId={(row) => row.variant}
      renderDetailPanel={({ row }) => (
        <Box sx={{ margin: "auto", width: "100%" }}>
          <VariantCredibleSetTable data={row.original} />
        </Box>
      )}
      muiTableProps={{ sx: { tableLayout: "fixed" } }}
      muiTableBodyCellProps={{ sx: { fontSize: "0.75rem" } }}
      muiToolbarAlertBannerProps={
        isError
          ? {
              color: "error",
              // @ts-ignore axios error shape
              children: error?.response?.data?.message || error?.message,
            }
          : undefined
      }
      muiPaginationProps={{ rowsPerPageOptions: [10, 20, 100, 1000] }}
      muiTableBodyRowProps={({ row }) => ({
        sx: {
          backgroundColor:
            Number(row.original.value) % 2 == 1 ? theme.palette.background.default : "inherit",
        },
      })}
      sortingFns={{ naInfSort, variantSort }}
      enableGlobalFilter={false}
    />
  );
};

export default VariantMainTable;
