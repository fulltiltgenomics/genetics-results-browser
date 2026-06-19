import { useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
  Box,
  Chip,
  CircularProgress,
  TextField,
  Typography,
  debounce,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { MaterialReactTable, MRT_ColumnDef } from "material-react-table";
import { useDataStore } from "../../store/store";
import { usePhenotypeSearch, useSummaryStats } from "../../store/serverQuery";
import { PhenoSearchRow, PhenotypeSearchHit } from "../../types/types.normalized";
import { naInfSort } from "../table/utils/sorting";
import { pValRepr } from "../table/utils/tableutil";
import GeneTooltip from "../tooltips/GeneToolTip";

/**
 * Phenotype search tab (refactor.md §5).
 *
 * For the user's INPUT variants, show the FULL summary statistics for one chosen phenotype plus a
 * per-variant inCredibleSet flag.
 *
 * Entry points:
 *   - the Phenotype Summary tab handoff (PhenotypeSummaryTable.normalized): it sets store.selectedPhenotype
 *     and switches to this tab. We preselect from selectedPhenotype and run immediately.
 *   - the in-view search box: debounced /search autocomplete restricted to phenotypes with full sumstats.
 *
 * Input variants come from store.normalizedData.inputVariants.found (the same variants the user queried
 * on /annotate). If none are present we prompt the user to enter variants first.
 *
 * inCredibleSet is derived from the per-variant credibleSets ALREADY in store.normalizedData — cheaper
 * and more precise than credible_sets_by_phenotype (which returns every CS member of the trait). A
 * variant is flagged in-CS when one of its memberships matches the chosen (resource, trait), and we
 * surface that membership's csId/pip.
 */

// the chosen phenotype carries resource + data_type so we can hit summary_stats/{resource}/{data_type}.
interface ChosenPhenotype {
  resource: string;
  dataType: string;
  code: string;
  name: string;
}

const PhenotypeSearchContainer = () => {
  const normalizedData = useDataStore((state) => state.normalizedData);
  const selectedPhenotype = useDataStore((state) => state.selectedPhenotype);

  const inputVariants = normalizedData?.inputVariants.found ?? [];

  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [chosen, setChosen] = useState<ChosenPhenotype | null>(null);

  // debounce the autocomplete input so we don't fire /search on every keystroke
  const setQueryDebounced = useMemo(
    () => debounce((value: string) => setDebouncedQuery(value), 300),
    []
  );

  const { data: searchHits = [], isFetching: searchFetching } =
    usePhenotypeSearch(debouncedQuery);

  // preselect from the Phenotype Summary handoff (store.selectedPhenotype). The handoff knows
  // resource+trait but not data_type — phenotypes that flow through that tab are credible-set GWAS
  // rows, so default the data_type to "gwas"; the phenostring is resolved from normalizedData.phenotypes.
  // Since this is now a persistent tab (not a remounted page), react to *changes* in selectedPhenotype
  // (tracked by a ref) so a second handoff re-runs, while a manual search-box pick is left untouched.
  const lastHandoffRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedPhenotype) return;
    const key = `${selectedPhenotype.resource}|${selectedPhenotype.trait}`;
    if (lastHandoffRef.current === key) return;
    lastHandoffRef.current = key;
    const meta = normalizedData?.phenotypes?.[key];
    setChosen({
      resource: selectedPhenotype.resource,
      dataType: (meta?.dataType ?? "gwas").toLowerCase(),
      code: selectedPhenotype.trait,
      name: meta?.phenostring ?? selectedPhenotype.trait,
    });
  }, [selectedPhenotype, normalizedData]);

  const {
    data: sumstatRows = [],
    isFetching: sumstatsFetching,
    isError: sumstatsError,
    error: sumstatsErrorObj,
  } = useSummaryStats(
    chosen?.resource,
    chosen?.dataType,
    inputVariants.length > 0 ? inputVariants : undefined,
    chosen?.code
  );

  // map each summary-stat row to a PhenoSearchRow, joining the CS-membership flag from the store.
  const rows = useMemo<PhenoSearchRow[]>(() => {
    if (!chosen) return [];
    // index the store's per-variant credible sets for the chosen (resource, trait).
    // genetics-results-browser-7rd: this join assumes the CS-membership `trait` (passed straight through
    // bff/normalize.normalizeCsRow from the upstream credible-set `trait` field) equals the /search
    // `code` (chosen.code) for the same phenotype. verified live (2026-06-01) for every sumstats-
    // searchable GWAS resource the search box surfaces — finngen, pgc, gp2, covid_hgi — where
    // code === trait === trait_original. QTL resources never appear in types=phenotypes search, and
    // ibd_gwas has summary stats but no credible sets (so its flag is correctly always false). a focused
    // alignment test (PhenotypeSearchContainer.test.tsx) pins this per resource; if a future resource's
    // CS-trait vocabulary diverges from its /search code, harden the match here (normalize both sides /
    // also accept cs.traitOriginal) and add a divergent-case test.
    const csByVariant = new Map<string, { csId: string; pip: number }>();
    for (const v of normalizedData?.variants ?? []) {
      const member = v.credibleSets.find(
        (cs) => cs.resource === chosen.resource && cs.trait === chosen.code
      );
      if (member) csByVariant.set(v.variant, { csId: member.csId, pip: member.pip });
    }
    // annotation lookup so we can show consequence/gene even when the sumstat row omits them.
    const annoByVariant = new Map(
      (normalizedData?.variants ?? []).map((v) => [v.variant, v.annotation])
    );

    return sumstatRows.map((r) => {
      const variant = `${r.chr}:${r.pos}:${r.ref}:${r.alt}`;
      const anno = annoByVariant.get(variant);
      const cs = csByVariant.get(variant);
      return {
        variant,
        rsid: r.rsids ?? anno?.rsid ?? null,
        gene: anno?.gene ?? r.nearest_genes ?? null,
        consequence: anno?.consequence ?? "",
        pval: r.pval,
        mlog10p: r.mlog10p,
        beta: r.beta,
        se: r.se,
        af: r.af,
        inCredibleSet: cs !== undefined,
        csId: cs?.csId,
        pip: cs?.pip,
      };
    });
  }, [sumstatRows, normalizedData, chosen]);

  // column order mirrors the Variant results table: variant, rsid, AF, most severe, most severe gene,
  // p-value, beta, se, then the per-phenotype in-credible-set flag.
  const columns = useMemo<MRT_ColumnDef<PhenoSearchRow>[]>(
    () => [
      { accessorKey: "variant", header: "variant", id: "variant", size: 150 },
      { accessorKey: "rsid", header: "rsid", id: "rsid", size: 110 },
      {
        accessorKey: "af",
        header: "AF",
        id: "af",
        size: 70,
        Cell: ({ cell }) => {
          const v = cell.getValue<number | null>();
          return v == null ? "" : v.toPrecision(3);
        },
      },
      { accessorKey: "consequence", header: "most severe", id: "consequence", size: 120 },
      {
        accessorKey: "gene",
        header: "most severe gene",
        id: "gene",
        size: 110,
        // hover: gene summary from mygene.info (matches the variant results table)
        Cell: ({ cell }) => {
          const gene = cell.getValue<string | null>();
          if (!gene) return "";
          return <GeneTooltip geneName={gene} content={<span>{gene}</span>} />;
        },
      },
      {
        // displayed as a p-value (pValRepr), matching the Variant results table; sorted on mlog10p.
        accessorKey: "mlog10p",
        header: "p-value",
        id: "mlog10p",
        sortingFn: naInfSort,
        sortDescFirst: true,
        size: 80,
        Cell: ({ row }) => {
          const m = row.original.mlog10p;
          return m == null || Number.isNaN(m) ? "" : pValRepr(m);
        },
      },
      {
        accessorKey: "beta",
        header: "beta",
        id: "beta",
        size: 70,
        Cell: ({ cell }) => {
          const v = cell.getValue<number>();
          return v == null || Number.isNaN(v) ? "" : v.toPrecision(3);
        },
      },
      {
        accessorKey: "se",
        header: "se",
        id: "se",
        size: 70,
        Cell: ({ cell }) => {
          const v = cell.getValue<number>();
          return v == null || Number.isNaN(v) ? "" : v.toPrecision(3);
        },
      },
      {
        accessorKey: "inCredibleSet",
        header: "in credible set",
        id: "inCredibleSet",
        size: 110,
        // yes/no in mild green/red so it reads at a glance; PIP (when in a CS) on hover.
        Cell: ({ row }) => {
          const inCs = row.original.inCredibleSet;
          const pip = row.original.pip;
          return (
            <Chip
              size="small"
              label={inCs ? "yes" : "no"}
              title={inCs && pip != null ? `PIP ${pip.toPrecision(2)}` : undefined}
              sx={{
                fontWeight: 600,
                backgroundColor: (t) =>
                  alpha(inCs ? t.palette.success.main : t.palette.error.main, 0.16),
                color: (t) => (inCs ? t.palette.success.dark : t.palette.error.dark),
              }}
            />
          );
        },
      },
    ],
    []
  );

  // no input variants: the view depends on them, so guide the user back to /annotate.
  if (inputVariants.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography>
          This tab shows full summary statistics for your input variants. Enter variants in the input
          box above (or the Variant results tab) first, then search for a phenotype here or use the
          search button in the Phenotype summary tab.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography sx={{ mb: 2 }}>
        Full summary statistics for your {inputVariants.length} input variant
        {inputVariants.length === 1 ? "" : "s"} for a chosen phenotype, plus whether each variant is
        in a credible set for that phenotype. Only phenotypes with full summary statistics are
        searchable.
      </Typography>

      <Autocomplete<PhenotypeSearchHit>
        sx={{ maxWidth: 600, mb: 2 }}
        options={searchHits}
        loading={searchFetching}
        filterOptions={(x) => x}
        // a phenotype is identified by resource + code; name alone can repeat across resources
        getOptionLabel={(o) => `${o.name} (${o.code})`}
        isOptionEqualToValue={(a, b) => a.resource === b.resource && a.code === b.code}
        inputValue={inputValue}
        onInputChange={(_e, value) => {
          setInputValue(value);
          setQueryDebounced(value);
        }}
        onChange={(_e, value) => {
          if (value) {
            setChosen({
              resource: value.resource,
              dataType: value.dataType.toLowerCase(),
              code: value.code,
              name: value.name,
            });
          }
        }}
        renderOption={(props, option) => (
          <li {...props} key={`${option.resource}|${option.code}`}>
            <Box>
              <Typography variant="body2">{option.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {option.code} · {option.resource} · {option.dataType}
                {option.sampleSize != null ? ` · n=${option.sampleSize.toLocaleString()}` : ""}
                {option.nCases != null ? ` · cases=${option.nCases.toLocaleString()}` : ""}
              </Typography>
            </Box>
          </li>
        )}
        renderInput={(params) => (
          <TextField
            {...params}
            label="search phenotype"
            placeholder="e.g. alzheimer, asthma"
            size="small"
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {searchFetching ? <CircularProgress size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
      />

      {chosen && (
        <Typography sx={{ mb: 1 }}>
          Showing <b>{chosen.name}</b> ({chosen.code}) — {chosen.resource} / {chosen.dataType}
        </Typography>
      )}

      {chosen && sumstatsFetching && (
        <Box display="flex" alignItems="center" gap={1}>
          <CircularProgress size={18} />
          <Typography variant="body2">loading summary statistics…</Typography>
        </Box>
      )}

      {chosen && sumstatsError && (
        <Typography color="error" variant="body2">
          failed to load summary statistics: {sumstatsErrorObj?.message}
        </Typography>
      )}

      {chosen && !sumstatsFetching && !sumstatsError && (
        <MaterialReactTable
          data={rows}
          columns={columns}
          enableTopToolbar={true}
          enableColumnFilters={false}
          enablePagination={rows.length > 20}
          initialState={{
            density: "compact",
            sorting: [{ id: "mlog10p", desc: true }],
            // 20 rows per page by default (matches the Variant results table), not MRT's default 10
            pagination: { pageIndex: 0, pageSize: 20 },
          }}
          sortingFns={{ naInfSort }}
          enableGlobalFilter={false}
          muiTableProps={{ sx: { tableLayout: "fixed" } }}
          muiPaginationProps={{ rowsPerPageOptions: [10, 20, 100, 1000] }}
          muiTableBodyCellProps={{ sx: { fontSize: "0.75rem" } }}
          renderEmptyRowsFallback={() => (
            <Box sx={{ p: 2 }}>
              <Typography variant="body2">
                none of your input variants have summary statistics for this phenotype.
              </Typography>
            </Box>
          )}
        />
      )}

      {!chosen && (
        <Typography variant="body2" color="text.secondary">
          search for a phenotype above to see results.
        </Typography>
      )}
    </Box>
  );
};

export default PhenotypeSearchContainer;
