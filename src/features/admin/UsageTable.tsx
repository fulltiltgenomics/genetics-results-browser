import { useMemo } from "react";
import { Box, Tooltip, Typography } from "@mui/material";
import {
  MaterialReactTable,
  useMaterialReactTable,
  type MRT_ColumnDef,
} from "material-react-table";
import { naInfSort } from "@/features/table/utils/sorting";
import type { UserUsageRow } from "./adminApi";

const ellipsis = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

// the numeric columns share one shape: sorted with NA (null) at the bottom, filtered on a
// minimum, rendered to a fixed number of decimals or a dash when the value is unknown
const numeric = (
  key: keyof UserUsageRow,
  header: string,
  decimals: number,
  size = 110
): MRT_ColumnDef<UserUsageRow> => ({
  accessorKey: key,
  header,
  sortingFn: naInfSort,
  sortDescFirst: true,
  filterFn: "greaterThanOrEqualTo",
  muiFilterTextFieldProps: { placeholder: "min" },
  size,
  muiTableBodyCellProps: { align: "right" },
  muiTableHeadCellProps: { align: "right" },
  Cell: ({ cell }) => {
    const v = cell.getValue<number | null>();
    return v == null ? "–" : v.toFixed(decimals);
  },
});

const getColumns = (): MRT_ColumnDef<UserUsageRow>[] => [
  {
    accessorKey: "user",
    header: "User",
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "user" },
    size: 150,
    Cell: ({ row }) => (
      <Tooltip title={row.original.user}>
        <Box component="span" sx={ellipsis}>
          {row.original.user.split("@")[0]}
        </Box>
      </Tooltip>
    ),
  },
  numeric("conversations", "Conversations", 0),
  numeric("avgMessages", "Avg messages per conversation", 1),
  numeric("maxMessages", "Max messages per conversation", 0),
  numeric("usd", "USD", 2, 90),
  numeric("avgUsd", "Avg USD per conversation", 2),
  numeric("maxUsd", "Max USD per conversation", 2),
];

interface Props {
  users: UserUsageRow[];
  isLoading: boolean;
  isXs: boolean;
}

/** Per-user LLM spend for the Usage tab; sorts, filters and pages client-side like ConversationsTable. */
const UsageTable = ({ users, isLoading, isXs }: Props) => {
  const columns = useMemo(getColumns, []);
  const total = users.reduce((sum, u) => sum + u.usd, 0);

  const table = useMaterialReactTable({
    columns,
    data: users,
    state: { isLoading },
    enableColumnFilters: true,
    enableGlobalFilter: true,
    enableColumnActions: false,
    enableDensityToggle: false,
    enableFullScreenToggle: false,
    initialState: {
      showColumnFilters: !isXs,
      density: "compact",
      sorting: [{ id: "usd", desc: true }],
      pagination: { pageIndex: 0, pageSize: 25 },
      columnVisibility: isXs
        ? { avgMessages: false, maxMessages: false, avgUsd: false, maxUsd: false }
        : {},
    },
    sortingFns: { naInfSort },
    muiTableProps: { sx: { tableLayout: "fixed" } },
    muiTableBodyCellProps: { sx: { fontSize: "0.75rem" } },
    muiTableHeadCellProps: {
      sx: {
        fontSize: "0.75rem",
        "& .Mui-TableHeadCell-Content-Wrapper": { whiteSpace: "normal", lineHeight: 1.25 },
      },
    },
    muiPaginationProps: { rowsPerPageOptions: [25, 50, 100, 500] },
    localization: { noRecordsToDisplay: "No usage in this period" },
    renderBottomToolbarCustomActions: ({ table: t }) => (
      <Typography variant="caption" sx={{ color: "text.secondary", px: 1, alignSelf: "center" }}>
        {t.getFilteredRowModel().rows.length} of {users.length} user{users.length !== 1 ? "s" : ""},{" "}
        {total.toFixed(2)} USD total
      </Typography>
    ),
  });

  return <MaterialReactTable table={table} />;
};

export default UsageTable;
