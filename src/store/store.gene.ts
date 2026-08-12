import { persist, subscribeWithSelector } from "zustand/middleware";
import { GeneViewState } from "@/types/types.store";
import { create } from "zustand";
import config from "@/config.json";

const DEFAULT_OFF_RESOURCES = new Set(["Open_Targets"]);

export const useGeneViewStore = create<GeneViewState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        activeTab: "cis",
        setActiveTab: (tab) => set({ activeTab: tab }),
        resourceToggles: config.gene_view.resources.reduce((acc, resource) => {
          // Open Targets alone contributes ~7000 credible sets at a dense locus like APOE, several
          // times the rest of the view put together, so it starts off and is opted into
          acc[resource.dataName] = !DEFAULT_OFF_RESOURCES.has(resource.dataName);
          return acc;
        }, {} as Record<string, boolean>),
        toggleResource: (resource: string) =>
          set((state) => ({
            resourceToggles: {
              ...state.resourceToggles,
              [resource]: !state.resourceToggles[resource],
            },
          })),
      }),
      {
        name: "gene-view-store",
        partialize: (state) => ({
          activeTab: state.activeTab,
          resourceToggles: state.resourceToggles,
        }),
        // the default merge replaces resourceToggles wholesale, so a resource added to
        // config.gene_view.resources after this browser last persisted its toggles was missing from
        // the stored map and read back as undefined: DatasetOptions rendered its switch on (?? true)
        // and counted its credible sets, while the plot filter dropped every one of its rows. merge
        // per resource instead — stored choices win, resources the storage never saw default to on.
        merge: (persisted, current) => {
          const stored = (persisted ?? {}) as Partial<GeneViewState>;
          return {
            ...current,
            ...stored,
            resourceToggles: { ...current.resourceToggles, ...(stored.resourceToggles ?? {}) },
          };
        },
      }
    )
  )
);
