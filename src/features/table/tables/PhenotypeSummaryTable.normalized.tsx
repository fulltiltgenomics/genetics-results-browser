import { Box, Button, IconButton, Tooltip } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ChatIcon from "@mui/icons-material/ChatBubbleOutline";
import { MaterialReactTable, MRT_ColumnDef } from "material-react-table";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PhenoSummaryRow } from "../../../types/types.normalized";
import { summarizePhenotypes } from "../../../store/munge.normalized";
import { useDataStore } from "../../../store/store";
import { useChatSeedStore } from "../../../store/store.chatSeed";
import { formatTraitName } from "../utils/tableutil";
import { naInfSort } from "../utils/sorting";
import { PhenotypeTooltip } from "../../tooltips/PhenotypeTooltip";
import VariantMainTable from "./VariantMainTable";

/**
 * Phenotype summary tab for the credible-set-only data model (refactor.md §4).
 * Counts come from credible-set membership (summarizePhenotypes), not p-filtered associations.
 * Each row expands to the variants that are in a CS for that trait (re-uses VariantMainTable scoped
 * to the trait via the store's selectedPhenotype-style filter applied to the row's variant subset).
 *
 * HANDOFF (refactor.md §4 / §5): a per-row "search" button hands off to the Phenotype search tab for
 * the chosen trait by setting store.selectedPhenotype and switching the active tab (the search tab
 * preselects from selectedPhenotype). It used to navigate to a /annotate/phenotype-search route, but
 * that nested route 404'd on a server without SPA fallback; a tab keeps the variant context in-store.
 */

const PhenotypeSummaryTable = () => {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 });
  const filteredVariants = useDataStore((state) => state.filteredVariants);
  const phenotypes = useDataStore((state) => state.normalizedData?.phenotypes ?? {});
  const hasBetas = useDataStore((state) => state.normalizedData?.hasBetas ?? false);
  const setSelectedPhenotype = useDataStore((state) => state.setSelectedPhenotype);
  const setActiveTab = useDataStore((state) => state.setActiveTab);
  const setChatSeed = useChatSeedStore((state) => state.setChatSeed);
  const navigate = useNavigate();

  const data = useMemo(
    () => summarizePhenotypes(filteredVariants, phenotypes),
    [filteredVariants, phenotypes]
  );

  // handoff to the Phenotype search tab: stash the chosen trait in the store and switch tabs. the
  // search tab preselects from selectedPhenotype and immediately runs the per-variant sumstats lookup.
  const handoff = (row: PhenoSummaryRow) => {
    setSelectedPhenotype({ resource: row.resource, trait: row.trait });
    setActiveTab("phenotype_search");
  };

  // ask-the-assistant hand-off: seed a trait-context prompt scoped to the current input variants,
  // then route to /chat for review (no auto-send).
  const askAssistant = (row: PhenoSummaryRow) => {
    const trait = row.phenostring || row.trait;
    setChatSeed(
      `Summarize the credible-set evidence linking the input variants to ${trait} (${row.resource}, ${row.variantCount} variant${row.variantCount === 1 ? "" : "s"}).`
    );
    navigate("/chat");
  };

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
        // underscores -> spaces for display (consistent with the variant table / detail table)
        accessorFn: (row) => formatTraitName(row.phenostring),
        header: "trait",
        id: "trait",
        filterFn: "contains",
        sortingFn: "alphanumeric",
        muiFilterTextFieldProps: { placeholder: "trait" },
        // hover: phenocode, data type, dataset, and case/sample counts (lazy per-resource fetch)
        Cell: ({ row }) => (
          <PhenotypeTooltip
            resource={row.original.resource}
            phenocode={row.original.traitOriginal}
            phenostring={row.original.phenostring}
            dataType={row.original.dataType}
            dataset={row.original.dataset}
            content={
              <span style={{ textDecoration: "underline dotted", cursor: "help" }}>
                {formatTraitName(row.original.phenostring)}
              </span>
            }
          />
        ),
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
    cols.push({
      accessorFn: () => "",
      id: "handoff",
      header: "actions",
      enableSorting: false,
      enableColumnFilter: false,
      size: 130,
      Cell: ({ row }) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Tooltip title="See full summary-stat results for all input variants for this trait">
            <Button
              size="small"
              variant="outlined"
              startIcon={<SearchIcon fontSize="small" />}
              onClick={() => handoff(row.original)}>
              search
            </Button>
          </Tooltip>
          <Tooltip title="Ask the assistant about this trait across the input variants">
            <IconButton size="small" onClick={() => askAssistant(row.original)}>
              <ChatIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBetas]);

  return (
    <MaterialReactTable
      data={data}
      columns={columns}
      enableTopToolbar={true}
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
