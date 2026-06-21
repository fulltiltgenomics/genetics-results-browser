import { Box } from "@mui/material";
import { MaterialReactTable, MRT_ColumnDef } from "material-react-table";
import { useMemo, useState } from "react";
import { DataTypeSummaryRow, CredibleSetDataType } from "../../../types/types.normalized";
import { summarizeDataTypes, filterCredibleSets } from "../../../store/munge.normalized";
import { useDataStore } from "../../../store/store";
import { naInfSort, variantSort } from "../utils/sorting";
import { cleanConsequence } from "../utils/tableutil";
import { GnomadConsequenceTooltip } from "../../tooltips/GnomadConsequenceTooltip";
import { GnomadAfTooltip } from "../../tooltips/GnomadAfTooltip";
import GeneTooltip from "../../tooltips/GeneToolTip";
import { gnomadAf, afRepr } from "./VariantMainTable.columns.normalized";
import VariantCredibleSetTable from "./VariantCredibleSetTable";

/**
 * Data type comparison tab for the credible-set-only data model (refactor.md §4).
 * One row per input variant with a count column per data type, derived from credible-set membership
 * (summarizeDataTypes) — the legacy association/p-value counts are gone. Reactive to the global
 * filters via the store's filteredVariants. Rows expand to the shared per-variant CS detail table.
 */

// the data types we surface as columns, in display order. caQTL is new to the tool (refactor.md §2).
const DATA_TYPE_COLUMNS: CredibleSetDataType[] = ["GWAS", "eQTL", "pQTL", "sQTL", "caQTL"];

const getColumns = (
  selectedPopulation: string | undefined
): MRT_ColumnDef<DataTypeSummaryRow>[] => [
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
    // gnomAD AF for the selected population — identical to the variant results table column.
    accessorFn: (row) => afRepr(gnomadAf(row.gnomad, selectedPopulation)),
    id: "gnomad_af",
    header: `${selectedPopulation || "global"} AF`,
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "filter" },
    sortingFn: (a, b) => {
      const av = gnomadAf(a.original.gnomad, selectedPopulation);
      const bv = gnomadAf(b.original.gnomad, selectedPopulation);
      // sort missing/NaN to the bottom
      const an = av === null || Number.isNaN(av) ? Number.POSITIVE_INFINITY : av;
      const bn = bv === null || Number.isNaN(bv) ? Number.POSITIVE_INFINITY : bv;
      return an - bn;
    },
    sortDescFirst: false,
    size: 80,
    // hover: per-population gnomAD AF log plot + gnomAD link (matches the variant results table)
    Cell: ({ row }) => {
      const text = afRepr(gnomadAf(row.original.gnomad, selectedPopulation));
      if (!row.original.gnomad) return text;
      return (
        <GnomadAfTooltip variant={row.original.variant} gnomad={row.original.gnomad}>
          {text}
        </GnomadAfTooltip>
      );
    },
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
    // hover: gene summary fetched on demand from mygene.info (matches the variant results table)
    Cell: ({ row }) => {
      const gene = row.original.gene;
      if (!gene) return "-";
      return <GeneTooltip geneName={gene} content={<span>{gene}</span>} />;
    },
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
  const selectedPopulation = useDataStore((state) => state.selectedPopulation);

  // the data-type comparison deliberately IGNORES the global data-type toggles: its whole point is to
  // show the per-data-type CS counts (e.g. how many pQTL CS a variant has) even when that type is
  // toggled off elsewhere. so we re-derive from the raw variants applying every global filter EXCEPT
  // dataTypes, rather than reading the store's filteredVariants (which already drops toggled-off types).
  const normalizedData = useDataStore((state) => state.normalizedData);
  const pipThreshold = useDataStore((state) => state.pipThreshold);
  const pValueThreshold = useDataStore((state) => state.pValueThreshold);
  const resourceFilter = useDataStore((state) => state.resourceFilter);
  const includeAllQuantLevels = useDataStore((state) => state.includeAllQuantLevels);
  const selectedPhenotype = useDataStore((state) => state.selectedPhenotype);

  const filteredVariants = useMemo(
    () =>
      normalizedData
        ? filterCredibleSets(normalizedData.variants, {
            pipThreshold,
            pValueThreshold,
            resources: resourceFilter,
            dataTypes: {}, // empty = every data type enabled, so toggles don't affect this tab
            includeAllQuantLevels,
            selectedPhenotype,
          })
        : [],
    [
      normalizedData,
      pipThreshold,
      pValueThreshold,
      resourceFilter,
      includeAllQuantLevels,
      selectedPhenotype,
    ]
  );

  const data = useMemo(() => summarizeDataTypes(filteredVariants), [filteredVariants]);
  const columns = useMemo(() => getColumns(selectedPopulation), [selectedPopulation]);

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
