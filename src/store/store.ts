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
  NormalizedResponse,
  VariantResult,
} from "../types/types.normalized";
import config from "@/config.json";

/**
 * assemble the munge.normalized FilterState from the store's normalized-path fields.
 * field names are aligned 1:1 with FilterState so this is a plain projection (no adapter/renaming).
 * defined at module scope so both setNormalizedData and every setter can recompute identically.
 */
const buildFilterState = (state: DataState): FilterState => ({
  pipThreshold: state.pipThreshold,
  csMinR2Threshold: state.csMinR2Threshold,
  resources: state.resourceFilter,
  dataTypes: state.toggledCredibleSetDataTypes,
  includeAllQuantLevels: state.includeAllQuantLevels,
  selectedPhenotype: state.selectedPhenotype,
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
  cisWindow: number;
  setCisWindow: (cisWindow: number) => void;
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
  /**
   * reactive stage-2 result: normalizedData.variants with each variant's credibleSets filtered by
   * the current FilterState. recomputed on every relevant change WITHOUT refetching. grouping and
   * per-tab summaries (groupCredibleSets/summarizePhenotypes/summarizeTissues) are left to the
   * components: they differ per tab (and the tissue tab manages its own data-type selection,
   * refactor.md §4), so precomputing them here would be wasted work — this mirrors the legacy store,
   * which precomputed only the single shared clientData and let components derive the rest.
   */
  filteredVariants: VariantResult[];
  /** keep memberships with csMinR2 >= threshold (refactor.md §4). 0 keeps everything. */
  csMinR2Threshold: number;
  setCsMinR2Threshold: (csMinR2Threshold: number) => void;
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
  subscribeWithSelector((set) => ({
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
      set((state) => ({
        cisWindow: cisWindow,
        clientData: filterRows(
          state.serverData!,
          state.toggledDataTypes,
          state.toggledGWASTypes,
          state.toggledQTLTypes,
          cisWindow,
          state.pThreshold,
          state.pipThreshold,
          state.selectedPheno,
          true
        ),
      })),
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
        const next = { ...state, normalizedData: data };
        return { normalizedData: data, filteredVariants: recomputeFilteredVariants(next) };
      }),
    filteredVariants: [],
    csMinR2Threshold: 0,
    setCsMinR2Threshold: (csMinR2Threshold) =>
      set((state) => {
        const next = { ...state, csMinR2Threshold };
        return { csMinR2Threshold, filteredVariants: recomputeFilteredVariants(next) };
      }),
    resourceFilter: undefined,
    setResourceFilter: (resources) =>
      set((state) => {
        const next = { ...state, resourceFilter: resources };
        return { resourceFilter: resources, filteredVariants: recomputeFilteredVariants(next) };
      }),
    toggleResource: (resource) =>
      set((state) => {
        // toggling out of the "no filter" (undefined) state seeds from the resources actually present,
        // so the first click removes exactly the clicked resource rather than hiding everything else.
        const base =
          state.resourceFilter ??
          new Set(
            (state.normalizedData?.variants ?? []).flatMap((v) =>
              v.credibleSets.map((cs) => cs.resource)
            )
          );
        const resources = new Set(base);
        if (resources.has(resource)) resources.delete(resource);
        else resources.add(resource);
        const next = { ...state, resourceFilter: resources };
        return { resourceFilter: resources, filteredVariants: recomputeFilteredVariants(next) };
      }),
    toggledCredibleSetDataTypes: {},
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
