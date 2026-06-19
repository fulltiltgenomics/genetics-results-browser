import { Box } from "@mui/material";
import { MaterialReactTable, MRT_ColumnDef } from "material-react-table";
import { useMemo, useState } from "react";
import { DataTypeSummaryRow, CredibleSetDataType } from "../../../types/types.normalized";
import { summarizeDataTypes } from "../../../store/munge.normalized";
import { useDataStore } from "../../../store/store";
import { naInfSort, variantSort } from "../utils/sorting";
import { cleanConsequence } from "../utils/tableutil";
import { GnomadConsequenceTooltip } from "../../tooltips/GnomadConsequenceTooltip";
import VariantCredibleSetTable from "./VariantCredibleSetTable";

/**
 * Data type comparison tab for the credible-set-only data model (refactor.md §4).
 * One row per input variant with a count column per data type, derived from credible-set membership
 * (summarizeDataTypes) — the legacy association/p-value counts are gone. Reactive to the global
 * filters via the store's filteredVariants. Rows expand to the shared per-variant CS detail table.
 */

// the data types we surface as columns, in display order. caQTL is new to the tool (refactor.md §2).
const DATA_TYPE_COLUMNS: CredibleSetDataType[] = ["GWAS", "eQTL", "pQTL", "sQTL", "caQTL"];

const getColumns = (): MRT_ColumnDef<DataTypeSummaryRow>[] => [
  {
    accessorKey: "variant",
    header: "variant",
    id: "variant",
    filterFn: "contains",
    sortingFn: "variantSort",
    muiFilterTextFieldProps: { placeholder: "variant" },
    size: 110,
  },
  {
    accessorFn: (row) => row.rsid ?? "-",
    id: "rsid",
    header: "rsid",
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "rsid" },
    size: 90,
  },
  {
    accessorFn: (row) => cleanConsequence(row.consequence ?? ""),
    id: "consequence",
    header: "most severe",
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "consequence" },
    size: 120,
    // hover: all gnomAD VEP consequences and their genes (matches the variant results table)
    Cell: ({ row }) => (
      <GnomadConsequenceTooltip consequences={row.original.consequences}>
        {cleanConsequence(row.original.consequence ?? "")}
      </GnomadConsequenceTooltip>
    ),
  },
  {
    accessorFn: (row) => row.gene ?? "-",
    id: "gene",
    header: "most severe gene",
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "gene" },
    enableSorting: false,
    size: 90,
  },
  ...DATA_TYPE_COLUMNS.map(
    (dt): MRT_ColumnDef<DataTypeSummaryRow> => ({
      // a missing count means zero CS memberships of that type for the variant.
      accessorFn: (row) => row.counts[dt] ?? 0,
      id: dt,
      header: `${dt} CS`,
      // no naInfSort here: the count lives under row.counts[dt], not row[dt], so naInfSort's
      // path lookup would miss it. the accessorFn already yields a number, so MRT's default sort works.
      sortDescFirst: true,
      filterFn: "greaterThan",
      muiFilterTextFieldProps: { placeholder: "filter" },
      size: 70,
    })
  ),
  {
    accessorKey: "total",
    header: "total CS",
    id: "total",
    sortingFn: naInfSort,
    sortDescFirst: true,
    filterFn: "greaterThan",
    muiFilterTextFieldProps: { placeholder: "filter" },
    size: 70,
  },
];

const DataTypeTable = (props: { enableTopToolbar: boolean }) => {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 });
  const filteredVariants = useDataStore((state) => state.filteredVariants);

  const data = useMemo(() => summarizeDataTypes(filteredVariants), [filteredVariants]);
  const columns = useMemo(getColumns, []);

  // map a summary row back to the underlying VariantResult so the detail panel can reuse the shared
  // credible-set table (summarizeDataTypes only carries counts, not the memberships themselves).
  const variantById = useMemo(
    () => new Map(filteredVariants.map((v) => [v.variant, v])),
    [filteredVariants]
  );

  return (
    <MaterialReactTable
      data={data}
      columns={columns}
      enableTopToolbar={props.enableTopToolbar}
      enableColumnFilterModes
      initialState={{
        showColumnFilters: true,
        density: "compact",
        sorting: [{ id: "total", desc: true }],
        columnOrder: ["mrt-row-expand"].concat(columns.map((c) => c.id!)),
      }}
      state={{ pagination, columnOrder: ["mrt-row-expand"].concat(columns.map((c) => c.id!)) }}
      onPaginationChange={setPagination}
      renderDetailPanel={({ row }) => {
        const variant = variantById.get(row.original.variant);
        return variant ? (
          <Box sx={{ margin: "auto", width: "100%" }}>
            <VariantCredibleSetTable data={variant} />
          </Box>
        ) : null;
      }}
      muiTableProps={{ sx: { tableLayout: "fixed" } }}
      muiTableBodyCellProps={{ sx: { fontSize: "0.75rem" } }}
      muiPaginationProps={{ rowsPerPageOptions: [10, 20, 100, 1000] }}
      sortingFns={{ naInfSort, variantSort }}
      enableGlobalFilter={false}
    />
  );
};

export default DataTypeTable;
