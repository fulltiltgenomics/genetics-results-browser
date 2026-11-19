import { Box, CircularProgress, Tooltip, Typography } from "@mui/material";
import { MRT_Cell, MRT_RowData, MRT_TableInstance } from "material-react-table";
import { naInfSort } from "../table/utils/sorting";

/** pieces shared by the tables of the gene evidence tabs */

// fixed-precision number cell; renders blank for null/NaN. generic over the row type so it satisfies
// MRT's Cell prop signature for any of the three evidence tables.
export const numCell =
  (precision = 4) =>
  <T extends MRT_RowData>({ cell }: { cell: MRT_Cell<T, unknown> }) => {
    const v = cell.getValue<number | null>();
    return v == null || Number.isNaN(v) ? "" : v.toPrecision(precision);
  };

// thousands-separated integer cell; blank for null
export const countCell = <T extends MRT_RowData>({ cell }: { cell: MRT_Cell<T, unknown> }) => {
  const v = cell.getValue<number | null>();
  return v == null ? "" : v.toLocaleString();
};

// the column keeps its width whatever it holds, so a long value is cut and shown in full on hover
export const truncatedCell = (text: string) => (
  <Tooltip title={text} placement="top-start">
    <Box
      component="span"
      sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
      {text}
    </Box>
  </Tooltip>
);

// rows in the order the table shows them, before pagination, so a download is the whole sorted table
// rather than the visible page
export const sortedRows = <T extends MRT_RowData>(table: MRT_TableInstance<T>): T[] =>
  table.getPrePaginationRowModel().rows.map((r) => r.original);

/** small per-section wrapper handling loading / error / empty states consistently. */
export const Section = ({
  title,
  isPending,
  isError,
  error,
  isEmpty,
  emptyText,
  children,
}: {
  title?: string;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  isEmpty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) => (
  <Box sx={{ mb: 4 }}>
    {title && (
      <Typography variant="h6" sx={{ mb: 1 }}>
        {title}
      </Typography>
    )}
    {isPending ? (
      <Box display="flex" alignItems="center" gap={1}>
        <CircularProgress size={18} />
        <Typography variant="body2">loading…</Typography>
      </Box>
    ) : isError ? (
      <Typography color="error" variant="body2">
        failed to load: {error?.message}
      </Typography>
    ) : isEmpty ? (
      <Typography variant="body2" color="text.secondary">
        {emptyText}
      </Typography>
    ) : (
      children
    )}
  </Box>
);

export const evidenceTableProps = {
  enableTopToolbar: true,
  enableColumnFilters: false,
  enableGlobalFilter: false,
  enableDensityToggle: false,
  muiTableBodyCellProps: { sx: { fontSize: "0.75rem" } },
  sortingFns: { naInfSort },
} as const;
