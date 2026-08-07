import { useMemo } from "react";
import { Box, TextField, Tooltip, Typography } from "@mui/material";
import {
  MaterialReactTable,
  useMaterialReactTable,
  type MRT_Column,
  type MRT_ColumnDef,
  type MRT_FilterFn,
} from "material-react-table";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import RemoveCircleIcon from "@mui/icons-material/RemoveCircle";
import HelpIcon from "@mui/icons-material/Help";
import { naInfSort } from "@/features/table/utils/sorting";
import type { AdminSession } from "./adminApi";
import { localDayKey, parseUtcTimestamp, withinDayRange } from "./utils";

// known disposition / success_label option sets, used for the column filter dropdowns
const DISPOSITION_OPTIONS = [
  "good_answer",
  "agent_failure",
  "technical_failure",
  "out_of_scope",
  "unfinished",
  "weird_or_unclear",
];
const SUCCESS_LABEL_OPTIONS = [
  "successful",
  "neutral",
  "unsuccessful",
  "technical_failure",
  "out_of_scope",
  "unfinished",
  "weird_or_unclear",
  "unknown",
];

const RATING_OPTIONS = ["NA", "1", "2", "3", "4", "5"];

// map a success_label to an icon + colour; success-ish -> green check, error-ish -> red cancel,
// the in-between labels -> grey neutral circle, unknown/unmapped -> grey help
export function successIcon(label: string | null) {
  const fontSize = 18;
  switch (label) {
    case "successful":
      return <CheckCircleIcon sx={{ fontSize, color: "success.main" }} />;
    case "unsuccessful":
    case "technical_failure":
      return <CancelIcon sx={{ fontSize, color: "error.main" }} />;
    case "neutral":
    case "out_of_scope":
    case "unfinished":
    case "weird_or_unclear":
      return <RemoveCircleIcon sx={{ fontSize, color: "text.disabled" }} />;
    default:
      return <HelpIcon sx={{ fontSize, color: "text.disabled" }} />;
  }
}

/**
 * From/To date inputs rendered inside a date column's header, replacing the page-level filter
 * panel. Two native date inputs rather than MRT's `date-range` filter variant, which would
 * pull @mui/x-date-pickers and a date adapter in as direct dependencies for no gain.
 *
 * `what` names the column in the input labels ("created from", "updated to"), which is what
 * screen readers and the tests address the fields by.
 */
const makeDayRangeFilter = (what: string) => {
  const DayRangeFilter = ({ column }: { column: MRT_Column<AdminSession> }) => {
    const [from, to] = (column.getFilterValue() as [string, string] | undefined) ?? ["", ""];
    // clearing both bounds must clear the filter itself, or MRT keeps showing the column as filtered
    const set = (next: [string, string]) =>
      column.setFilterValue(next[0] || next[1] ? next : undefined);
    const field = (label: string, value: string, onChange: (v: string) => void) => (
      <TextField
        type="date"
        variant="standard"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        slotProps={{ htmlInput: { "aria-label": label, style: { fontSize: "0.7rem" } } }}
        sx={{ minWidth: 118 }}
      />
    );
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
        {field(`${what} from`, from, (v) => set([v, to]))}
        {field(`${what} to`, to, (v) => set([from, v]))}
      </Box>
    );
  };
  return DayRangeFilter;
};

// filters on the LOCAL calendar day of the timestamp, matching what the cell renders; the raw
// value is a UTC instant, so comparing it against a picked date without converting would file
// post-midnight conversations under the previous day
const dayRange =
  (field: "createdAt" | "updatedAt"): MRT_FilterFn<AdminSession> =>
  (row, _columnId, filterValue) =>
    withinDayRange(localDayKey(row.original[field]), filterValue as [string, string] | undefined);

// a session whose timestamp the API omitted parses to an invalid Date; show a dash instead of
// the "Invalid Date" string the locale formatters would produce
const DateCell = ({ value }: { value: Date }) =>
  Number.isNaN(value.getTime()) ? (
    <span>-</span>
  ) : (
    <Tooltip title={value.toLocaleString()}>
      <span>{value.toLocaleDateString()}</span>
    </Tooltip>
  );

const ellipsis = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

const getColumns = (): MRT_ColumnDef<AdminSession>[] => [
  {
    accessorKey: "id",
    header: "Session ID",
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "id" },
    size: 300,
  },
  {
    accessorKey: "userId",
    header: "User",
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "user" },
    size: 110,
    Cell: ({ row }) => (
      <Tooltip title={row.original.userId}>
        <Box component="span" sx={ellipsis}>
          {row.original.userId.split("@")[0]}
        </Box>
      </Tooltip>
    ),
  },
  {
    id: "title",
    accessorFn: (row) => row.title || row.preview || "",
    header: "Title",
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "text" },
    size: 205,
    Cell: ({ cell }) => {
      const text = cell.getValue<string>();
      return <Box sx={ellipsis}>{text || <em>No content</em>}</Box>;
    },
  },
  {
    accessorKey: "messageCount",
    header: "Messages",
    sortingFn: naInfSort,
    sortDescFirst: true,
    filterFn: "greaterThanOrEqualTo",
    muiFilterTextFieldProps: { placeholder: "min" },
    size: 100,
  },
  {
    id: "createdAt",
    // a Date so "datetime" sorting orders within a day too, not just by calendar day
    accessorFn: (row) => parseUtcTimestamp(row.createdAt),
    header: "Created",
    sortingFn: "datetime",
    enableGlobalFilter: false,
    filterFn: dayRange("createdAt"),
    Filter: makeDayRangeFilter("created"),
    size: 140,
    Cell: ({ cell }) => <DateCell value={cell.getValue<Date>()} />,
  },
  {
    id: "updatedAt",
    accessorFn: (row) => parseUtcTimestamp(row.updatedAt),
    header: "Updated",
    sortingFn: "datetime",
    enableGlobalFilter: false,
    filterFn: dayRange("updatedAt"),
    Filter: makeDayRangeFilter("updated"),
    size: 140,
    Cell: ({ cell }) => <DateCell value={cell.getValue<Date>()} />,
  },
  {
    id: "disposition",
    accessorFn: (row) => row.disposition ?? "",
    header: "Disposition",
    filterVariant: "multi-select",
    filterSelectOptions: DISPOSITION_OPTIONS,
    muiFilterTextFieldProps: { placeholder: "any" },
    size: 130,
    Cell: ({ cell }) => cell.getValue<string>().replace(/_/g, " ") || "-",
  },
  {
    accessorKey: "issueCount",
    header: "Issues",
    sortingFn: naInfSort,
    sortDescFirst: true,
    filterFn: "greaterThanOrEqualTo",
    muiFilterTextFieldProps: { placeholder: "min" },
    size: 80,
    Cell: ({ row }) =>
      row.original.issueCount > 0 ? (
        <Tooltip title={row.original.issueCategories.join(", ") || "no categories"}>
          <span>{row.original.issueCount}</span>
        </Tooltip>
      ) : (
        "-"
      ),
  },
  {
    id: "rating",
    // the accessor is the displayed label so the select filter matches what the cell shows;
    // naInfSort reads the raw numeric field off row.original, keeping NA at the bottom
    accessorFn: (row) => (row.rating == null ? "NA" : String(row.rating)),
    header: "User rating",
    sortingFn: naInfSort,
    filterVariant: "multi-select",
    filterSelectOptions: RATING_OPTIONS,
    muiFilterTextFieldProps: { placeholder: "any" },
    size: 85,
  },
  {
    id: "llmRating",
    accessorFn: (row) => (row.llmRating == null ? "NA" : String(row.llmRating)),
    header: "LLM rating",
    sortingFn: naInfSort,
    filterVariant: "multi-select",
    filterSelectOptions: RATING_OPTIONS,
    muiFilterTextFieldProps: { placeholder: "any" },
    size: 85,
  },
  {
    id: "successLabel",
    accessorFn: (row) => row.successLabel ?? "unknown",
    header: "Success",
    filterVariant: "multi-select",
    filterSelectOptions: SUCCESS_LABEL_OPTIONS,
    muiFilterTextFieldProps: { placeholder: "any" },
    size: 95,
    Cell: ({ row }) => (
      <Tooltip title={row.original.successLabel || "unknown"}>
        <Box component="span" sx={{ display: "inline-flex", verticalAlign: "middle" }}>
          {successIcon(row.original.successLabel)}
        </Box>
      </Tooltip>
    ),
  },
];

interface Props {
  sessions: AdminSession[];
  isLoading: boolean;
  isXs: boolean;
  onSelect: (sessionId: string) => void;
}

/**
 * Conversations table. Sorting, filtering and pagination all run client-side over the full
 * session list, so a sort covers every conversation rather than the visible page — the reason
 * AdminPage fetches the list unpaged.
 */
const ConversationsTable = ({ sessions, isLoading, isXs, onSelect }: Props) => {
  const columns = useMemo(getColumns, []);

  const table = useMaterialReactTable({
    columns,
    data: sessions,
    state: { isLoading },
    enableColumnFilters: true,
    enableGlobalFilter: true,
    // the per-column "..." menu costs ~25px of header width in every column, which is what
    // squeezed the labels into ellipses on a laptop. everything it offers is already one
    // click away: the header sorts, the filter sits under it, the toolbar hides columns.
    enableColumnActions: false,
    enableFacetedValues: true,
    enableDensityToggle: false,
    enableFullScreenToggle: false,
    initialState: {
      showColumnFilters: !isXs,
      density: "compact",
      sorting: [{ id: "updatedAt", desc: true }],
      pagination: { pageIndex: 0, pageSize: 25 },
      // the session id is a lookup aid rather than something to scan; reachable via the
      // columns button. narrow screens drop everything but the conversation's identity.
      columnVisibility: isXs
        ? {
            id: false,
            messageCount: false,
            createdAt: false,
            disposition: false,
            issueCount: false,
            rating: false,
            llmRating: false,
          }
        : { id: false },
    },
    sortingFns: { naInfSort },
    muiTableBodyRowProps: ({ row }) => ({
      onClick: () => onSelect(row.original.id),
      sx: { cursor: "pointer" },
    }),
    muiTableProps: { sx: { tableLayout: "fixed" } },
    muiTableBodyCellProps: { sx: { fontSize: "0.75rem" } },
    muiTableHeadCellProps: {
      sx: {
        fontSize: "0.75rem",
        // MRT ellipsises any header under 20 chars rather than wrapping it; let the
        // two-word ones ("User rating", "LLM rating") take a second line instead
        "& .Mui-TableHeadCell-Content-Wrapper": { whiteSpace: "normal", lineHeight: 1.25 },
      },
    },
    muiPaginationProps: { rowsPerPageOptions: [25, 50, 100, 500] },
    localization: { noRecordsToDisplay: "No conversations match the current filters" },
    renderBottomToolbarCustomActions: ({ table: t }) => (
      <Typography variant="caption" sx={{ color: "text.secondary", px: 1, alignSelf: "center" }}>
        {t.getFilteredRowModel().rows.length} of {sessions.length} conversation
        {sessions.length !== 1 ? "s" : ""}
      </Typography>
    ),
  });

  return <MaterialReactTable table={table} />;
};

export default ConversationsTable;
