import { create } from "zustand";
import { persist } from "zustand/middleware";

// persisted preference for the phenotype-search boxes: when on, restrict autocomplete results to
// FinnGen-resource phenotypes only. Off by default.
interface PhenoFilterState {
  onlyFinnGen: boolean;
  setOnlyFinnGen: (value: boolean) => void;
}

export const usePhenoFilterStore = create<PhenoFilterState>()(
  persist(
    (set) => ({
      onlyFinnGen: false,
      setOnlyFinnGen: (value: boolean) => set({ onlyFinnGen: value }),
    }),
    {
      name: "pheno-filter-storage",
    }
  )
);
