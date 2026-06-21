import { Box, Skeleton, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { MaterialReactTable, MRT_ColumnDef } from "material-react-table";
import { useMemo, useState } from "react";
import { TissueSummaryRow } from "../../../types/types.normalized";
import { filterCredibleSets, summarizeTissues } from "../../../store/munge.normalized";
import { useDataStore } from "../../../store/store";
import { usePeakGenes } from "../../../store/serverQuery";
import { naInfSort } from "../utils/sorting";
import { formatTissue } from "../utils/tableutil";
import GeneTooltip from "../../tooltips/GeneToolTip";

/**
 * "linked genes" cell for the caQTL view: resolves the row's ATAC peaks to the union of genes they
 * regulate via peak_to_genes (lazy — only the rows MRT actually renders fetch). Each gene carries the
 * mygene.info tooltip, matching the gene columns elsewhere.
 */
const LinkedGenesCell = ({ peaks }: { peaks: string[] }) => {
  const { genes, isLoading, isError } = usePeakGenes(peaks, peaks.length > 0);
  if (peaks.length === 0) return <span>—</span>;
  if (isLoading) return <Skeleton variant="text" width={120} />;
  if (isError || genes.length === 0) return <span>—</span>;
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: "2px 6px" }}>
      {genes.map((g, i) => (
        <span key={g}>
          <GeneTooltip geneName={g} content={<span>{g}</span>} />
          {i < genes.length - 1 ? "," : ""}
        </span>
      ))}
    </Box>
  );
};

/**
 * Tissue & cell type summary tab for the credible-set-only data model (refactor.md §4).
 *
 * DECOUPLED from the global data-type options (refactor.md §4): the old version showed nothing unless
 * QTLs were toggled on in the main controls, which was confusing. This tab owns its eQTL-vs-caQTL
 * selection via a LOCAL toggle and recomputes its source set itself — it deliberately ignores the
 * store's global data-type toggle (toggledCredibleSetDataTypes) so the tab always has QTL data to
 * show. It still honours the meaningful thresholds (PIP / cs_min_r2 / resource / quant level), so the
 * table stays consistent with the rest of the view.
 *
 * eQTL: tissueOrCellType is the tissue/cell label. caQTL: it is the ATAC cell type; peak->gene
 * enrichment (linkedGenes via peak_to_genes) is DEFERRED (refactor.md §2), shown as a TODO column.
 */

const getColumns = (dataType: "eQTL" | "caQTL"): MRT_ColumnDef<TissueSummaryRow>[] => {
  const cols: MRT_ColumnDef<TissueSummaryRow>[] = [
    {
      // "tibial_nerve|naive" -> "tibial nerve, naive" (display-only)
      accessorFn: (row) => formatTissue(row.tissueOrCellType),
      header: dataType === "caQTL" ? "cell type" : "tissue / cell type",
      id: "tissueOrCellType",
      filterFn: "contains",
      muiFilterTextFieldProps: { placeholder: "tissue" },
      size: 220,
    },
    {
      accessorKey: "variantCount",
      header: "variants",
      id: "variantCount",
      sortingFn: naInfSort,
      sortDescFirst: true,
      filterFn: "greaterThan",
      muiFilterTextFieldProps: { placeholder: "variants" },
      size: 80,
    },
  ];
  // caQTL traits are ATAC peaks; resolve each row's peaks to the genes they regulate, lazily per
  // rendered row via peak_to_genes (usePeakGenes in LinkedGenesCell).
  if (dataType === "caQTL") {
    cols.push({
      accessorFn: (row) => (row.peaks?.length ? row.peaks.length : 0),
      id: "linkedGenes",
      header: "linked genes",
      enableSorting: false,
      enableColumnFilter: false,
      size: 220,
      Cell: ({ row }) => <LinkedGenesCell peaks={row.original.peaks ?? []} />,
    });
  }
  return cols;
};

const TissueSummaryTable = () => {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 });
  // local eQTL/caQTL selection — owned by this tab, NOT the global controls (refactor.md §4).
  const [dataType, setDataType] = useState<"eQTL" | "caQTL">("eQTL");

  const normalizedData = useDataStore((state) => state.normalizedData);
  const pipThreshold = useDataStore((state) => state.pipThreshold);
  const pValueThreshold = useDataStore((state) => state.pValueThreshold);
  const resourceFilter = useDataStore((state) => state.resourceFilter);
  const includeAllQuantLevels = useDataStore((state) => state.includeAllQuantLevels);

  const data = useMemo(() => {
    if (!normalizedData) return [];
    // re-filter the RAW variants ourselves with an EMPTY dataTypes map so the global data-type toggle
    // is bypassed — this is the decoupling. all other thresholds still apply.
    const filtered = filterCredibleSets(normalizedData.variants, {
      pipThreshold,
      pValueThreshold,
      resources: resourceFilter,
      dataTypes: {},
      includeAllQuantLevels,
    });
    return summarizeTissues(filtered, dataType);
  }, [normalizedData, pipThreshold, pValueThreshold, resourceFilter, includeAllQuantLevels, dataType]);

  const columns = useMemo(() => getColumns(dataType), [dataType]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, padding: "8px 0" }}>
        <Typography variant="body2">Show:</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={dataType}
          onChange={(_e, value) => {
            // exclusive group emits null when the active button is re-clicked; ignore that.
            if (value) setDataType(value);
          }}
          aria-label="qtl data type">
          <ToggleButton value="eQTL" aria-label="eQTL">
            eQTL
          </ToggleButton>
          <ToggleButton value="caQTL" aria-label="caQTL">
            caQTL
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <MaterialReactTable
        data={data}
        columns={columns}
        enableTopToolbar={true}
        enableColumnFilters={true}
        initialState={{
          showColumnFilters: true,
          density: "compact",
          sorting: [{ id: "variantCount", desc: true }],
        }}
        localization={{
          noRecordsToDisplay: `No ${dataType} credible sets for the current variants and thresholds`,
        }}
        state={{ pagination }}
        onPaginationChange={setPagination}
        muiTableProps={{ sx: { tableLayout: "fixed" } }}
        muiTableBodyCellProps={{ sx: { fontSize: "0.75rem" } }}
        muiPaginationProps={{ rowsPerPageOptions: [10, 20, 100, 1000] }}
        sortingFns={{ naInfSort }}
        enableGlobalFilter={false}
      />
    </Box>
  );
};

export default TissueSummaryTable;
