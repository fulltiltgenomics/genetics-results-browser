import { Box, Tooltip } from "@mui/material";
import { MaterialReactTable, MRT_ColumnDef } from "material-react-table";
import { useMemo, useState } from "react";
import { PhenoSummaryRow } from "../../../types/types.normalized";
import { summarizePhenotypes } from "../../../store/munge.normalized";
import { useDataStore } from "../../../store/store";
import { formatTraitName } from "../utils/tableutil";
import { naInfSort } from "../utils/sorting";
import { PhenotypeTooltip } from "../../tooltips/PhenotypeTooltip";
import { PhenoSumstatsArrow } from "../PhenoSumstatsLink";
import VariantMainTable from "./VariantMainTable";
import { PhenoSummaryExportButtons } from "../ExportToolbar";

/**
 * Phenotype summary tab for the credible-set-only data model (refactor.md §4).
 * Counts come from credible-set membership (summarizePhenotypes), not p-filtered associations.
 * Each row expands to the variants that are in a CS for that trait (re-uses VariantMainTable scoped
 * to the trait via the store's selectedPhenotype-style filter applied to the row's variant subset).
 *
 * HANDOFF (refactor.md §4 / §5): a right-arrow before each trait (PhenoSumstatsArrow) hands off to
 * the "Single phenotype sumstats" tab for the chosen trait by setting the search-only selection and
 * switching the active tab. The arrow only shows for (resource, data type) pairs that expose summary
 * stats, so it never routes to a guaranteed 404.
 */

const PhenotypeSummaryTable = () => {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 });
  const filteredVariants = useDataStore((state) => state.filteredVariants);
  const phenotypes = useDataStore((state) => state.normalizedData?.phenotypes ?? {});
  const hasBetas = useDataStore((state) => state.normalizedData?.hasBetas ?? false);

  const data = useMemo(
    () => summarizePhenotypes(filteredVariants, phenotypes),
    [filteredVariants, phenotypes]
  );

  const columns = useMemo<MRT_ColumnDef<PhenoSummaryRow>[]>(() => {
    const cols: MRT_ColumnDef<PhenoSummaryRow>[] = [
      {
        accessorKey: "dataType",
        header: "type",
        id: "dataType",
        filterFn: "contains",
        muiFilterTextFieldProps: { placeholder: "type" },
        size: 70,
      },
      {
        accessorKey: "resource",
        header: "resource",
        id: "resource",
        filterFn: "contains",
        muiFilterTextFieldProps: { placeholder: "resource" },
        size: 100,
      },
      {
        // underscores -> spaces for display (consistent with the variant table / detail table).
        // caQTL: show the peak's linked gene(s) instead of the peak id (peak -> tooltip).
        accessorFn: (row) =>
          row.linkedGenes?.length ? row.linkedGenes.join(", ") : formatTraitName(row.phenostring),
        header: "trait",
        id: "trait",
        filterFn: "contains",
        sortingFn: "alphanumeric",
        muiFilterTextFieldProps: { placeholder: "trait" },
        // hover: phenocode, data type, dataset, and case/sample counts (lazy per-resource fetch)
        Cell: ({ row }) => {
          const r = row.original;
          const arrow = (
            <PhenoSumstatsArrow
              resource={r.resource}
              trait={r.trait}
              traitOriginal={r.traitOriginal}
              dataType={r.dataType}
            />
          );
          if (r.linkedGenes?.length) {
            return (
              <Box sx={{ display: "flex", alignItems: "center" }}>
                {arrow}
                <Tooltip title={`ATAC peak: ${r.peak ?? r.trait}`} arrow>
                  <span style={{ textDecoration: "underline dotted", cursor: "help" }}>
                    {r.linkedGenes.join(", ")}
                  </span>
                </Tooltip>
              </Box>
            );
          }
          return (
            <Box sx={{ display: "flex", alignItems: "center" }}>
              {arrow}
              <PhenotypeTooltip
                resource={r.resource}
                phenocode={r.traitOriginal}
                phenostring={r.phenostring}
                dataType={r.dataType}
                dataset={r.dataset}
                content={
                  <span style={{ textDecoration: "underline dotted", cursor: "help" }}>
                    {formatTraitName(r.phenostring)}
                  </span>
                }
              />
            </Box>
          );
        },
      },
      {
        accessorKey: "variantCount",
        header: "variants",
        id: "variantCount",
        sortingFn: naInfSort,
        sortDescFirst: true,
        filterFn: "greaterThan",
        muiFilterTextFieldProps: { placeholder: "variants" },
        size: 70,
      },
    ];
    // direction-agreement columns only when the user supplied betas (matches summarizePhenotypes).
    if (hasBetas) {
      cols.push(
        {
          accessorFn: (row) => row.consistentCount ?? 0,
          id: "consistentCount",
          header: "consistent",
          sortingFn: naInfSort,
          sortDescFirst: true,
          filterFn: "greaterThan",
          muiFilterTextFieldProps: { placeholder: "consistent" },
          size: 70,
        },
        {
          accessorFn: (row) => row.oppositeCount ?? 0,
          id: "oppositeCount",
          header: "opposite",
          sortingFn: naInfSort,
          sortDescFirst: true,
          filterFn: "greaterThan",
          muiFilterTextFieldProps: { placeholder: "opposite" },
          size: 70,
        }
      );
    }
    return cols;
  }, [hasBetas]);

  return (
    <MaterialReactTable
      data={data}
      columns={columns}
      enableTopToolbar={true}
      renderTopToolbarCustomActions={({ table }) => <PhenoSummaryExportButtons table={table} />}
      enableColumnFilters={true}
      initialState={{
        showColumnFilters: true,
        density: "compact",
        sorting: [{ id: "variantCount", desc: true }],
        columnOrder: ["mrt-row-expand"].concat(columns.map((c) => c.id!)),
      }}
      state={{ pagination, columnOrder: ["mrt-row-expand"].concat(columns.map((c) => c.id!)) }}
      onPaginationChange={setPagination}
      renderDetailPanel={({ row }) => {
        // scope the per-trait variant list to those variants actually in a CS for this trait, and
        // keep only the matching memberships so the expanded table shows just this trait's signals.
        const wanted = new Set(row.original.variants);
        const subset = filteredVariants
          .filter((v) => wanted.has(v.variant))
          .map((v) => ({
            ...v,
            credibleSets: v.credibleSets.filter(
              (cs) => cs.resource === row.original.resource && cs.trait === row.original.trait
            ),
          }));
        return (
          <Box sx={{ margin: "auto", width: "100%" }}>
            <VariantMainTable data={subset} showTraitCounts={false} enableTopToolbar={false} />
          </Box>
        );
      }}
      muiTableProps={{ sx: { tableLayout: "fixed" } }}
      muiTableBodyCellProps={{ sx: { fontSize: "0.75rem" } }}
      muiPaginationProps={{ rowsPerPageOptions: [10, 20, 100, 1000] }}
      sortingFns={{ naInfSort }}
      enableGlobalFilter={false}
    />
  );
};

export default PhenotypeSummaryTable;
