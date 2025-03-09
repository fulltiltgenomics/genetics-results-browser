import { persist, subscribeWithSelector } from "zustand/middleware";
import { GeneViewState } from "@/types/types.store";
import { create } from "zustand";
import config from "@/config.json";

export const useGeneViewStore = create<GeneViewState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        activeTab: "cis",
        setActiveTab: (tab) => set({ activeTab: tab }),
        resourceToggles: config.gene_view.resources.reduce((acc, resource) => {
          acc[resource.dataName] = true;
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
      }
    )
  )
);
