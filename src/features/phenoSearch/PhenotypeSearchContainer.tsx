import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Autocomplete,
  Box,
  Chip,
  CircularProgress,
  TextField,
  Typography,
  debounce,
} from "@mui/material";
import { MaterialReactTable, MRT_ColumnDef } from "material-react-table";
import { useDataStore } from "../../store/store";
import { usePhenotypeSearch, useSummaryStats } from "../../store/serverQuery";
import { PhenoSearchRow, PhenotypeSearchHit } from "../../types/types.normalized";
import { naInfSort } from "../table/utils/sorting";

/**
 * Phenotype search view (refactor.md §5, own route /annotate/phenotype-search).
 *
 * For the user's INPUT variants, show the FULL summary statistics for one chosen phenotype plus a
 * per-variant inCredibleSet flag.
 *
 * Entry points:
 *   - the Phenotype Summary tab handoff (PhenotypeSummaryTable.normalized): it sets store.selectedPhenotype
 *     AND navigates here with ?resource=&trait=. We preselect from those and run immediately.
 *   - the in-view search box: debounced /search autocomplete restricted to phenotypes with full sumstats.
 *
 * Input variants come from store.normalizedData.inputVariants.found (the same variants the user queried
 * on /annotate). If none are present (user navigated here directly) we prompt them back to /annotate.
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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

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

  // preselect from the .20 handoff: URL ?resource=&trait= (authoritative) backed by store.selectedPhenotype.
  // the handoff knows resource+trait but not data_type — phenotypes that flow through the Phenotype
  // Summary tab are credible-set GWAS rows, so default the data_type to "gwas"; the phenostring is
  // resolved from normalizedData.phenotypes when available.
  useEffect(() => {
    if (chosen) return;
    const resource = searchParams.get("resource") ?? selectedPhenotype?.resource;
    const trait = searchParams.get("trait") ?? selectedPhenotype?.trait;
    if (!resource || !trait) return;
    const meta = normalizedData?.phenotypes?.[`${resource}|${trait}`];
    setChosen({
      resource,
      dataType: (meta?.dataType ?? "gwas").toLowerCase(),
      code: trait,
      name: meta?.phenostring ?? trait,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, selectedPhenotype, normalizedData]);

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

  const columns = useMemo<MRT_ColumnDef<PhenoSearchRow>[]>(
    () => [
      { accessorKey: "variant", header: "variant", id: "variant", size: 150 },
      { accessorKey: "rsid", header: "rsid", id: "rsid", size: 110 },
      { accessorKey: "gene", header: "gene", id: "gene", size: 90 },
      { accessorKey: "consequence", header: "consequence", id: "consequence", size: 130 },
      {
        accessorKey: "mlog10p",
        header: "-log10(p)",
        id: "mlog10p",
        sortingFn: naInfSort,
        sortDescFirst: true,
        size: 90,
        Cell: ({ cell }) => {
          const v = cell.getValue<number>();
          return v == null || Number.isNaN(v) ? "" : v.toPrecision(4);
        },
      },
      {
        accessorKey: "beta",
        header: "beta",
        id: "beta",
        size: 80,
        Cell: ({ cell }) => {
          const v = cell.getValue<number>();
          return v == null || Number.isNaN(v) ? "" : v.toPrecision(3);
        },
      },
      {
        accessorKey: "se",
        header: "se",
        id: "se",
        size: 80,
        Cell: ({ cell }) => {
          const v = cell.getValue<number>();
          return v == null || Number.isNaN(v) ? "" : v.toPrecision(3);
        },
      },
      {
        accessorKey: "af",
        header: "af",
        id: "af",
        size: 80,
        Cell: ({ cell }) => {
          const v = cell.getValue<number | null>();
          return v == null ? "" : v.toPrecision(3);
        },
      },
      {
        accessorKey: "inCredibleSet",
        header: "in credible set",
        id: "inCredibleSet",
        size: 120,
        Cell: ({ row }) =>
          row.original.inCredibleSet ? (
            <Chip
              size="small"
              color="primary"
              label={
                row.original.pip != null
                  ? `PIP ${row.original.pip.toPrecision(2)}`
                  : "yes"
              }
            />
          ) : (
            <Chip size="small" variant="outlined" label="no" />
          ),
      },
    ],
    []
  );

  // no input variants: the view depends on them, so guide the user back to /annotate.
  if (inputVariants.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Phenotype search
        </Typography>
        <Typography>
          This view shows full summary statistics for your input variants. Start by entering
          variants on the{" "}
          <Box
            component="span"
            sx={{ color: "primary.main", cursor: "pointer", textDecoration: "underline" }}
            onClick={() => navigate("/annotate")}>
            variant table
          </Box>
          , then come back here or use the search button in the Phenotype summary tab.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Box display="flex" flexDirection="row" gap={2} alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6">Phenotype search</Typography>
        <Box
          sx={{ color: "primary.main", cursor: "pointer", textDecoration: "underline" }}
          onClick={() => navigate("/annotate")}>
          <Typography variant="body2">back to variant table</Typography>
        </Box>
      </Box>

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
          }}
          sortingFns={{ naInfSort }}
          enableGlobalFilter={false}
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
