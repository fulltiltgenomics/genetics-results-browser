import { Box, MenuItem, useTheme } from "@mui/material";
import ChatIcon from "@mui/icons-material/ChatBubbleOutline";
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
import { cleanConsequence } from "../utils/tableutil";

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

  const columns = useMemo(
    () =>
      getVariantMainTableColumnsNormalized(
        selectedPopulation,
        props.showTraitCounts,
        normalizedData?.hasBetas ?? false,
        normalizedData?.hasCustomValues ?? false
      ),
    [selectedPopulation, props.showTraitCounts, normalizedData?.hasBetas, normalizedData?.hasCustomValues]
  );

  const tableData: VariantResult[] = props.data ?? filteredVariants;

  return (
    <MaterialReactTable
      data={tableData}
      columns={columns}
      enableTopToolbar={props.enableTopToolbar}
      // legacy ExportButtons (and its useServerQuery call) are intentionally not mounted here: the
      // BFF /v1/results now returns NormalizedResponse and the legacy export path reads the old
      // top-level data.data shape, so it always errors. csv/tsv export is migrated in its own task.
      enableColumnFilterModes
      // per-row "ask the assistant" hand-off: seed the chat with a variant-context prompt, then
      // route to /chat where ChatPage consumes the seed and prefills the input (no auto-send).
      enableRowActions
      positionActionsColumn="first"
      renderRowActionMenuItems={({ row, closeMenu }) => [
        <MenuItem
          key="ask-assistant"
          onClick={() => {
            setChatSeed(buildVariantSeed(row.original));
            closeMenu();
            navigate("/chat");
          }}>
          <ChatIcon fontSize="small" sx={{ mr: 1 }} />
          Ask the assistant
        </MenuItem>,
      ]}
      initialState={{
        showColumnFilters: true,
        density: "compact",
        columnOrder: ["mrt-row-expand", "mrt-row-actions"].concat(columns.map((c) => c.id!)),
      }}
      state={{
        isLoading,
        showAlertBanner: isError,
        showProgressBars: isFetching,
        pagination,
        columnOrder: ["mrt-row-expand", "mrt-row-actions"].concat(columns.map((c) => c.id!)),
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
