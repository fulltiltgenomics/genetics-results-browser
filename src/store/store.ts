import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { Phenotype, TableData, DataType, QTLType } from "../types/types";
import { filterRows } from "./munge";
import {
  FilterState,
  SelectedPhenotype,
  filterCredibleSets,
} from "./munge.normalized";
import {
  CredibleSetDataType,
  GnomadFreq,
  NormalizedResponse,
  VariantResult,
} from "../types/types.normalized";
import { fetchGnomadForVariants } from "./gnomad";
import config from "@/config.json";

// per-variant in-flight gnomAD fetches (genetics-results-browser-3lu.1). gnomAD is loaded lazily —
// per visible page, and in full only when sort/filter/export by the AF column needs every row — so
// concurrent callers (a page load racing the "ensure all" path) must never double-fetch a variant.
// module scope because the store is a process-wide singleton; cleared when a new query is ingested.
const gnomadInflight = new Map<string, Promise<void>>();

/**
 * assemble the munge.normalized FilterState from the store's normalized-path fields.
 * field names are aligned 1:1 with FilterState so this is a plain projection (no adapter/renaming).
 * defined at module scope so both setNormalizedData and every setter can recompute identically.
 */
const buildFilterState = (state: DataState): FilterState => ({
  pipThreshold: state.pipThreshold,
  pValueThreshold: state.pValueThreshold,
  resources: state.resourceFilter,
  dataTypes: state.toggledCredibleSetDataTypes,
  includeAllQuantLevels: state.includeAllQuantLevels,
  selectedPhenotype: state.selectedPhenotype,
  cisWindow: state.cisWindow,
  showCis: state.showCisQtl,
  showTrans: state.showTransQtl,
});

/**
 * stage-2 reactive recompute (mirrors the legacy clientData/filterRows pattern): re-derive
 * filteredVariants from the raw normalizedData + current filters. client-side only — never refetches.
 * returns [] when there is no normalized data yet so consumers can treat it as "empty, not loading".
 */
const recomputeFilteredVariants = (state: DataState): VariantResult[] =>
  state.normalizedData
    ? filterCredibleSets(state.normalizedData.variants, buildFilterState(state))
    : [];

interface DataState {
  message: string | undefined;
  setMessage: (message: string | undefined) => void;
  variantInput: string | undefined;
  setVariantInput: (variantInput: string) => void;
  /** @deprecated legacy fat-aggregation payload; superseded by normalizedData. removed once components migrate (.17+). */
  serverData: TableData | undefined;
  /** @deprecated legacy setter; superseded by setNormalizedData. */
  setServerData: (serverData: TableData) => void;
  /** @deprecated legacy precomputed table; superseded by filteredVariants. */
  clientData: TableData | undefined;
  toggledDataTypesTurnedOn: Record<string, boolean>;
  /** @deprecated legacy GWAS/QTL data-type toggle; superseded by toggledCredibleSetDataTypes. */
  toggledDataTypes: Record<string, boolean>;
  /** @deprecated */
  toggleDataType: (DataType: DataType) => void;
  toggledGWASTypes: Record<string, boolean>;
  toggleGWASType: (GWASType: string) => void;
  toggledQTLTypes: Record<string, boolean>;
  toggleQTLType: (QTLType: QTLType) => void;
  // cis-window half-width (Mb); shared by the normalized path's cis/trans classification.
  cisWindow: number;
  setCisWindow: (cisWindow: number) => void;
  // QTL cis/trans display toggles (normalized path). default both on, mirroring the legacy CIS/TRANS
  // QTL switches; classification uses cisWindow + per-membership geneTargets (munge.normalized).
  showCisQtl: boolean;
  showTransQtl: boolean;
  setShowCisQtl: (show: boolean) => void;
  setShowTransQtl: (show: boolean) => void;
  /** @deprecated p-value threshold loses meaning with credible-set-only data (refactor.md §4). */
  pThreshold: number;
  /** @deprecated */
  setPThreshold: (pThreshold: number) => void;
  // pipThreshold is REUSED by the normalized path: semantics match munge.normalized (keep pip >= threshold).
  pipThreshold: number;
  setPipThreshold: (pipThreshold: number) => void;
  /** @deprecated legacy single-phenotype focus (Phenotype); superseded by selectedPhenotype (SelectedPhenotype). */
  selectedPheno: Phenotype | undefined;
  /** @deprecated */
  setSelectedPheno: (pheno: Phenotype | undefined) => void;
  // shared by both paths: gnomAD population display.
  selectedPopulation: string | undefined;
  setSelectedPopulation: (pop: string | undefined) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;

  // ── normalized credible-set path (refactor.md §1/§4) ──────────────────────
  /** raw stage-1 payload from useNormalizedQuery; stage-2 filtering happens client-side. */
  normalizedData: NormalizedResponse | undefined;
  setNormalizedData: (data: NormalizedResponse | undefined) => void;

  // ── deferred gnomAD enrichment (genetics-results-browser-3lu.1) ────────────
  /** variant ids whose gnomAD has been fetched (present OR confirmed absent), so they aren't refetched. */
  gnomadLoaded: Set<string>;
  /** true once every result variant's gnomAD is loaded — the state the whole-result AF features need. */
  gnomadFullyLoaded: boolean;
  /** true while any gnomAD fetch is in flight (drives the table's progress indicator). */
  gnomadLoading: boolean;
  /** merge a fetched gnomAD subset into normalizedData + mark the requested ids loaded; recomputes. */
  mergeGnomad: (requested: string[], gnomadByVariant: Record<string, GnomadFreq>) => void;
  /** lazily load gnomAD for a variant subset (the current table page). de-dupes in-flight/loaded ids. */
  loadGnomadForVariants: (variantIds: string[]) => Promise<void>;
  /** the single shared "ensure gnomAD for ALL rows" path sort/filter/export await before proceeding. */
  ensureAllGnomadLoaded: () => Promise<void>;
  /**
   * reactive stage-2 result: normalizedData.variants with each variant's credibleSets filtered by
   * the current FilterState. recomputed on every relevant change WITHOUT refetching. grouping and
   * per-tab summaries (groupCredibleSets/summarizePhenotypes/summarizeTissues) are left to the
   * components: they differ per tab (and the tissue tab manages its own data-type selection,
   * refactor.md §4), so precomputing them here would be wasted work — this mirrors the legacy store,
   * which precomputed only the single shared clientData and let components derive the rest.
   */
  filteredVariants: VariantResult[];
  /** keep memberships whose p-value <= threshold (refactor.md §4). 1 keeps everything. default 0.05. */
  pValueThreshold: number;
  setPValueThreshold: (pValueThreshold: number) => void;
  /** enabled resources; undefined = no filter (keep all). lifted resource filter (refactor.md §4). */
  resourceFilter: Set<string> | undefined;
  setResourceFilter: (resources: Set<string> | undefined) => void;
  toggleResource: (resource: string) => void;
  /** per-data-type toggle in munge.normalized's shape; absent key = enabled (permissive default). */
  toggledCredibleSetDataTypes: Partial<Record<CredibleSetDataType, boolean>>;
  toggleCredibleSetDataType: (dataType: CredibleSetDataType) => void;
  /** eQTL quant-level option; default false = gene-level (ge) only (refactor.md §4). */
  includeAllQuantLevels: boolean;
  setIncludeAllQuantLevels: (includeAllQuantLevels: boolean) => void;
  /** normalized-path single-trait focus (resource+trait), mirrors legacy selectedPheno. Narrows the
   * global filteredVariants (and thus every table) to one phenotype. */
  selectedPhenotype: SelectedPhenotype | undefined;
  setSelectedPhenotype: (pheno: SelectedPhenotype | undefined) => void;
  /** the phenotype the Phenotype search tab should preselect, set by the Phenotype summary handoff.
   * Distinct from selectedPhenotype: this is a handoff message ONLY and must NOT filter the global
   * filteredVariants — the other tables stay unaffected by what's viewed in phenotype search. */
  phenotypeSearchSelection: SelectedPhenotype | undefined;
  setPhenotypeSearchSelection: (pheno: SelectedPhenotype | undefined) => void;
}

export const useDataStore = create<DataState>()(
  subscribeWithSelector((set, get) => ({
    message: undefined,
    setMessage: (message) => set({ message }),
    variantInput: undefined,
    setVariantInput: (variantInput) => set({ variantInput }),
    serverData: undefined,
    setServerData: (data: TableData) =>
      set((state) => ({
        serverData: data,
        // filter and group the data when server data changes
        clientData: filterRows(
          data,
          state.toggledDataTypes,
          state.toggledGWASTypes,
          state.toggledQTLTypes,
          state.cisWindow,
          state.pThreshold,
          state.pipThreshold,
          state.selectedPheno,
          true
        ),
      })),
    clientData: undefined,
    toggledDataTypesTurnedOn: {
      ...config.data_types.reduce((acc, dataType) => {
        acc[dataType] = true;
        return acc;
      }, {} as Record<string, boolean>),
    },
    toggledDataTypes: {
      ...config.data_types.reduce((acc, dataType) => {
        acc[dataType] = dataType === "GWAS";
        return acc;
      }, {} as Record<string, boolean>),
    },
    toggleDataType: (dataType: string) => {
      set((state) => {
        const newDataTypes = {
          ...state.toggledDataTypes,
          [dataType]: !state.toggledDataTypes[dataType],
        } as Record<string, boolean>;
        return {
          toggledDataTypes: newDataTypes,
          clientData: filterRows(
            state.serverData!,
            newDataTypes,
            state.toggledGWASTypes,
            state.toggledQTLTypes,
            state.cisWindow,
            state.pThreshold,
            state.pipThreshold,
            state.selectedPheno,
            true
          ),
        };
      });
    },
    toggledQTLTypes: {
      CIS: true,
      TRANS: true,
    },
    toggleQTLType: (QTLType: string) => {
      set((state) => {
        const newQTLTypes = {
          ...state.toggledQTLTypes,
          [QTLType]: !state.toggledQTLTypes[QTLType],
        } as Record<string, boolean>;
        return {
          toggledQTLTypes: newQTLTypes,
          clientData: filterRows(
            state.serverData!,
            state.toggledDataTypes,
            state.toggledGWASTypes,
            newQTLTypes,
            state.cisWindow,
            state.pThreshold,
            state.pipThreshold,
            state.selectedPheno,
            true
          ),
        };
      });
    },
    toggledGWASTypes: {
      "case-control": true,
      continuous: true,
    },
    toggleGWASType: (GWASType: string) => {
      set((state) => {
        const newGWASTypes = {
          ...state.toggledGWASTypes,
          [GWASType]: !state.toggledGWASTypes[GWASType],
        } as Record<string, boolean>;
        return {
          toggledGWASTypes: newGWASTypes,
          clientData: filterRows(
            state.serverData!,
            state.toggledDataTypes,
            newGWASTypes,
            state.toggledQTLTypes,
            state.cisWindow,
            state.pThreshold,
            state.pipThreshold,
            state.selectedPheno,
            true
          ),
        };
      });
    },
    cisWindow: 1.5,
    setCisWindow: (cisWindow) =>
      set((state) => {
        const next = { ...state, cisWindow };
        return {
          cisWindow,
          // guard the dead legacy recompute (serverData is undefined on the normalized path, which
          // would deref undefined in filterRows); recompute the normalized filteredVariants instead.
          clientData: state.serverData
            ? filterRows(
                state.serverData,
                state.toggledDataTypes,
                state.toggledGWASTypes,
                state.toggledQTLTypes,
                cisWindow,
                state.pThreshold,
                state.pipThreshold,
                state.selectedPheno,
                true
              )
            : state.clientData,
          filteredVariants: recomputeFilteredVariants(next),
        };
      }),
    showCisQtl: true,
    showTransQtl: true,
    setShowCisQtl: (show) =>
      set((state) => {
        const next = { ...state, showCisQtl: show };
        return { showCisQtl: show, filteredVariants: recomputeFilteredVariants(next) };
      }),
    setShowTransQtl: (show) =>
      set((state) => {
        const next = { ...state, showTransQtl: show };
        return { showTransQtl: show, filteredVariants: recomputeFilteredVariants(next) };
      }),
    pThreshold: 5e-8,
    setPThreshold: (pThreshold) =>
      set((state) => {
        return {
          pThreshold: pThreshold,
          clientData: filterRows(
            state.serverData!,
            state.toggledDataTypes,
            state.toggledGWASTypes,
            state.toggledQTLTypes,
            state.cisWindow,
            pThreshold,
            state.pipThreshold,
            state.selectedPheno,
            true
          ),
        };
      }),
    pipThreshold: 0.01,
    setPipThreshold: (pipThreshold) =>
      set((state) => ({
        pipThreshold: pipThreshold,
        // guard the legacy recompute: pipThreshold is now shared with the normalized path, which can
        // be active before any legacy serverData exists (filterRows would deref undefined.data).
        clientData: state.serverData
          ? filterRows(
              state.serverData,
              state.toggledDataTypes,
              state.toggledGWASTypes,
              state.toggledQTLTypes,
              state.cisWindow,
              state.pThreshold,
              pipThreshold,
              state.selectedPheno,
              true
            )
          : state.clientData,
        // pipThreshold is shared with the normalized path, so recompute filteredVariants too.
        filteredVariants: recomputeFilteredVariants({ ...state, pipThreshold }),
      })),
    selectedPheno: undefined,
    setSelectedPheno: (pheno) =>
      set((state) => ({
        selectedPheno: pheno,
        clientData: filterRows(
          state.serverData!,
          state.toggledDataTypes,
          state.toggledGWASTypes,
          state.toggledQTLTypes,
          state.cisWindow,
          state.pThreshold,
          state.pipThreshold,
          pheno,
          true
        ),
      })),
    selectedPopulation: undefined,
    setSelectedPopulation: (pop) => set({ selectedPopulation: pop }),
    activeTab: "variants",
    setActiveTab: (tab) => set({ activeTab: tab }),

    // ── normalized credible-set path ────────────────────────────────────────
    // every setter below recomputes filteredVariants from the (unchanged) raw normalizedData via
    // recomputeFilteredVariants — no refetch. set((state) => ...) gives us the post-update state by
    // spreading the new field into a fresh object before deriving, so the recompute sees the new value.
    normalizedData: undefined,
    setNormalizedData: (data) =>
      set((state) => {
        // a new query invalidates any pending lazy gnomAD fetches and the loaded set.
        gnomadInflight.clear();
        const next = { ...state, normalizedData: data, gnomadLoaded: new Set<string>() };
        return {
          normalizedData: data,
          filteredVariants: recomputeFilteredVariants(next),
          gnomadLoaded: new Set<string>(),
          // only the variant path defers gnomAD (loaded lazily per page); nothing else needs tracking.
          gnomadFullyLoaded: data?.queryType !== "variant",
          gnomadLoading: false,
        };
      }),

    // ── deferred gnomAD enrichment (genetics-results-browser-3lu.1) ──────────
    gnomadLoaded: new Set<string>(),
    gnomadFullyLoaded: true,
    gnomadLoading: false,
    mergeGnomad: (requested, gnomadByVariant) =>
      set((state) => {
        if (!state.normalizedData) return {};
        const req = new Set(requested);
        // attach gnomAD only to the requested variants (fresh copies so React/the table re-render);
        // an id gnomAD had no row for stays without a gnomad field — still marked loaded so we don't refetch.
        const variants = state.normalizedData.variants.map((v) =>
          req.has(v.variant) ? { ...v, gnomad: gnomadByVariant[v.variant] } : v
        );
        const normalizedData = { ...state.normalizedData, variants };
        const gnomadLoaded = new Set(state.gnomadLoaded);
        for (const v of requested) gnomadLoaded.add(v);
        const gnomadFullyLoaded = normalizedData.variants.every((v) => gnomadLoaded.has(v.variant));
        const next = { ...state, normalizedData, gnomadLoaded };
        return {
          normalizedData,
          gnomadLoaded,
          gnomadFullyLoaded,
          filteredVariants: recomputeFilteredVariants(next),
        };
      }),
    loadGnomadForVariants: async (variantIds) => {
      const state = get();
      const data = state.normalizedData;
      if (!data) return;
      const known = new Set(data.variants.map((v) => v.variant));
      const loaded = state.gnomadLoaded;
      // ids present in the result, not yet loaded, and not already being fetched by another caller.
      const toFetch = variantIds.filter(
        (v) => known.has(v) && !loaded.has(v) && !gnomadInflight.has(v)
      );
      // in-flight fetches (started elsewhere) that also cover ids we need — await those too.
      const awaiting = variantIds
        .filter((v) => gnomadInflight.has(v))
        .map((v) => gnomadInflight.get(v)!);

      if (toFetch.length > 0) {
        set({ gnomadLoading: true });
        const p = fetchGnomadForVariants(toFetch)
          .then((gnomadByVariant) => get().mergeGnomad(toFetch, gnomadByVariant))
          // best-effort: a failed lazy load leaves those variants unmarked so a later page/ensure
          // retries them; never crash the table over a gnomAD blip.
          .catch(() => {})
          .finally(() => {
            for (const v of toFetch) gnomadInflight.delete(v);
            if (gnomadInflight.size === 0) set({ gnomadLoading: false });
          });
        // register synchronously (before any await) so a concurrent caller sees these as in-flight.
        for (const v of toFetch) gnomadInflight.set(v, p);
        awaiting.push(p);
      }
      await Promise.all(awaiting);
    },
    ensureAllGnomadLoaded: async () => {
      const data = get().normalizedData;
      if (!data) return;
      await get().loadGnomadForVariants(data.variants.map((v) => v.variant));
    },

    filteredVariants: [],
    pValueThreshold: 0.05,
    setPValueThreshold: (pValueThreshold) =>
      set((state) => {
        const next = { ...state, pValueThreshold };
        return { pValueThreshold, filteredVariants: recomputeFilteredVariants(next) };
      }),
    resourceFilter: undefined,
    setResourceFilter: (resources) =>
      set((state) => {
        const next = { ...state, resourceFilter: resources };
        return { resourceFilter: resources, filteredVariants: recomputeFilteredVariants(next) };
      }),
    toggleResource: (resource) =>
      set((state) => {
        // toggling out of the "no filter" (undefined) state seeds the set to every resource the filter
        // DISPLAYS — the union of ResourceMeta entries with credible sets and the resources present in
        // the CS data (mirrors ResourceFilter.availableResources). seeding only from present-in-data
        // resources dropped CS-capable-but-zero-row ones (e.g. pseudo gp2/covid_hgi/pgc), so the first
        // untoggle appeared to switch several toggles off at once.
        const base =
          state.resourceFilter ??
          new Set([
            ...(state.normalizedData?.resources ?? [])
              .filter((r) => r.hasCredibleSets)
              .map((r) => r.id),
            ...(state.normalizedData?.variants ?? []).flatMap((v) =>
              v.credibleSets.map((cs) => cs.resource)
            ),
          ]);
        const resources = new Set(base);
        if (resources.has(resource)) resources.delete(resource);
        else resources.add(resource);
        const next = { ...state, resourceFilter: resources };
        return { resourceFilter: resources, filteredVariants: recomputeFilteredVariants(next) };
      }),
    // GWAS / eQTL / pQTL are on by default (absent key = enabled); the rarer QTL layers start off.
    toggledCredibleSetDataTypes: {
      sQTL: false,
      caQTL: false,
      edQTL: false,
      metaboQTL: false,
    },
    toggleCredibleSetDataType: (dataType) =>
      set((state) => {
        // absent key means "enabled" (passesFilter only drops on === false), so the first toggle
        // flips an unset type to explicitly false.
        const toggledCredibleSetDataTypes = {
          ...state.toggledCredibleSetDataTypes,
          [dataType]: state.toggledCredibleSetDataTypes[dataType] === false,
        };
        const next = { ...state, toggledCredibleSetDataTypes };
        return { toggledCredibleSetDataTypes, filteredVariants: recomputeFilteredVariants(next) };
      }),
    includeAllQuantLevels: false,
    setIncludeAllQuantLevels: (includeAllQuantLevels) =>
      set((state) => {
        const next = { ...state, includeAllQuantLevels };
        return { includeAllQuantLevels, filteredVariants: recomputeFilteredVariants(next) };
      }),
    selectedPhenotype: undefined,
    setSelectedPhenotype: (pheno) =>
      set((state) => {
        const next = { ...state, selectedPhenotype: pheno };
        return { selectedPhenotype: pheno, filteredVariants: recomputeFilteredVariants(next) };
      }),
    // handoff-only: does NOT recompute filteredVariants, so picking a phenotype in the search tab
    // leaves the variant/data-type/summary/tissue tables untouched.
    phenotypeSearchSelection: undefined,
    setPhenotypeSearchSelection: (pheno) => set({ phenotypeSearchSelection: pheno }),
  }))
);
