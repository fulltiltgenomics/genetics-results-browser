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
import { formatPhenotypeCounts, pValRepr } from "../table/utils/tableutil";
import GeneTooltip from "../tooltips/GeneToolTip";
import { PhenotypeSearchExportButton } from "../table/ExportToolbar";

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
// `code` is the phenotype id summary_stats expects (see sumstatsPhenoId); `name` is for display only.
interface ChosenPhenotype {
  resource: string;
  dataType: string;
  code: string;
  name: string;
}

/**
 * The phenotype id summary_stats keys on, which differs by layer (verified live against the API):
 *   - GWAS: the phenocode, i.e. the credible-set `trait_original` (e.g. "AD_LO_EXMORE"). The
 *     credible-set `trait` is now a harmonized human-readable name ("Alzheimer’s_disease_(Late…)")
 *     which summary_stats 404s on.
 *   - QTLs: the molecular trait symbol, i.e. the credible-set `trait` (e.g. "APOE"). Here it's
 *     `trait_original` that 404s (it carries an assay suffix, "APOE_cross_batch_normalised_4118").
 * /search (GWAS-only, has_summary_stats) returns this phenocode as its `code`, so the search box and
 * the Phenotype-summary handoff resolve to the same id.
 */
const sumstatsPhenoId = (dataType: string, trait: string, traitOriginal: string): string =>
  dataType.toLowerCase() === "gwas" ? traitOriginal : trait;

const PhenotypeSearchContainer = () => {
  const normalizedData = useDataStore((state) => state.normalizedData);
  // handoff message from the Phenotype summary tab — preselect-only; it does NOT filter other tables.
  const handoffSelection = useDataStore((state) => state.phenotypeSearchSelection);

  const inputVariants = normalizedData?.inputVariants.found ?? [];

  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [chosen, setChosen] = useState<ChosenPhenotype | null>(null);

  // debounce the autocomplete input so we don't fire /search on every keystroke
  const setQueryDebounced = useMemo(
    () => debounce((value: string) => setDebouncedQuery(value), 300),
    []
  );

  // this tab looks up per-variant summary stats, so restrict the autocomplete to phenotypes that have
  // them (the main annotation search, by contrast, offers every credible-set phenotype).
  const { data: searchHits = [], isFetching: searchFetching } = usePhenotypeSearch(debouncedQuery, {
    requireSummaryStats: true,
  });

  // preselect from the Phenotype Summary handoff (store.phenotypeSearchSelection). The handoff carries
  // the resource + (display) trait + trait_original; the data_type comes from normalizedData.phenotypes
  // (keyed by `${resource}|${trait}`), defaulting to GWAS. The summary_stats id is then resolved
  // per-layer via sumstatsPhenoId. Since this is now a persistent tab (not a remounted page), react to
  // *changes* in the handoff (tracked by a ref) so a second handoff re-runs, while a manual
  // search-box pick is left untouched.
  const lastHandoffRef = useRef<string | null>(null);
  useEffect(() => {
    if (!handoffSelection) return;
    const key = `${handoffSelection.resource}|${handoffSelection.trait}`;
    if (lastHandoffRef.current === key) return;
    lastHandoffRef.current = key;
    const meta = normalizedData?.phenotypes?.[key];
    const dataType = meta?.dataType ?? "GWAS";
    setChosen({
      resource: handoffSelection.resource,
      dataType: dataType.toLowerCase(),
      code: sumstatsPhenoId(
        dataType,
        handoffSelection.trait,
        handoffSelection.traitOriginal ?? handoffSelection.trait
      ),
      name: meta?.phenostring ?? handoffSelection.trait,
    });
  }, [handoffSelection, normalizedData]);

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
    // index the store's per-variant credible sets for the chosen phenotype. chosen.code is the
    // summary_stats id, which equals the CS-membership trait_original for GWAS and trait for QTLs
    // (see sumstatsPhenoId), so match the same field per layer. The CS `trait` is now a harmonized
    // display name for GWAS, so the old `cs.trait === chosen.code` match no longer holds there.
    const csByVariant = new Map<string, { csId: string; pip: number }>();
    for (const v of normalizedData?.variants ?? []) {
      const member = v.credibleSets.find(
        (cs) =>
          cs.resource === chosen.resource &&
          sumstatsPhenoId(cs.dataType, cs.trait, cs.traitOriginal) === chosen.code
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

  // how many of the input variants the chosen phenotype's summary stats actually cover. The endpoint
  // is queried with the input variants and returns a row only for those it has, so the distinct
  // variant count here is the "found in sumstats" tally (often < inputVariants for sparse phenotypes).
  const foundCount = useMemo(() => new Set(rows.map((r) => r.variant)).size, [rows]);

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
          arrow before a trait in the Phenotype summary or Variant results tabs.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ py: 2 }}>
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
        renderOption={(props, option) => {
          const counts = formatPhenotypeCounts(option);
          return (
            <li {...props} key={`${option.resource}|${option.code}`}>
              <Box>
                <Typography variant="body2">{option.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {option.code} · {option.resource} · {option.dataType}
                  {counts ? ` · ${counts}` : ""}
                </Typography>
              </Box>
            </li>
          );
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="search for a phenotype"
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
          {!sumstatsFetching && !sumstatsError && (
            <>
              {" "}
              · <b>{foundCount.toLocaleString()}</b> of {inputVariants.length.toLocaleString()} input
              variant{inputVariants.length === 1 ? "" : "s"} found in these summary statistics
            </>
          )}
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
          {/* a 404 here means this phenotype has no full summary statistics (the upstream returns 404
              for unknown resource/data_type/phenotype) — show a plain message, not the axios error. */}
          {(sumstatsErrorObj as { response?: { status?: number } })?.response?.status === 404
            ? "No full summary statistics available for this phenotype."
            : `failed to load summary statistics: ${sumstatsErrorObj?.message}`}
        </Typography>
      )}

      {chosen && !sumstatsFetching && !sumstatsError && (
        <MaterialReactTable
          data={rows}
          columns={columns}
          enableTopToolbar={true}
          renderTopToolbarCustomActions={() => (
            <PhenotypeSearchExportButton
              rows={rows}
              phenoCode={chosen.code}
              phenoResource={chosen.resource}
            />
          )}
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

    </Box>
  );
};

export default PhenotypeSearchContainer;
