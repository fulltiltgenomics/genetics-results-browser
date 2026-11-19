import { create } from "zustand";
import { persist } from "zustand/middleware";

export const GENE_EVIDENCE_TABS = [
  "ai summary",
  "annotation",
  "gene burden",
  "variant association",
  "qtl",
  "expression",
  "mendelian",
] as const;
export type GeneEvidenceTabName = (typeof GENE_EVIDENCE_TABS)[number];

export type BurdenTraitType = "all" | "binary" | "quantitative";
export type BurdenMaskMode = "top" | "all";
export type BurdenView = "table" | "plot";
// fine-mapped credible sets, or the approximate ones built from summary statistics and LD
export type CredibleSetKind = "all" | "susie" | "pseudo";
// every credible set, or per coding variant and dataset only the one the variant is strongest in
export type AssocTraitMode = "all" | "top";

// view preferences of the gene evidence tab, kept across gene changes and page reloads
interface GeneEvidenceState {
  activeTab: GeneEvidenceTabName;
  burdenTraitType: BurdenTraitType;
  burdenMaskMode: BurdenMaskMode;
  burdenView: BurdenView;
  assocTraitType: BurdenTraitType;
  assocCredibleSetKind: CredibleSetKind;
  assocTraitMode: AssocTraitMode;
  assocMinCodingPip: number;
  setActiveTab: (value: GeneEvidenceTabName) => void;
  setBurdenTraitType: (value: BurdenTraitType) => void;
  setBurdenMaskMode: (value: BurdenMaskMode) => void;
  setBurdenView: (value: BurdenView) => void;
  setAssocTraitType: (value: BurdenTraitType) => void;
  setAssocCredibleSetKind: (value: CredibleSetKind) => void;
  setAssocTraitMode: (value: AssocTraitMode) => void;
  setAssocMinCodingPip: (value: number) => void;
}

export const useGeneEvidenceStore = create<GeneEvidenceState>()(
  persist(
    (set) => ({
      activeTab: "gene burden",
      burdenTraitType: "all",
      burdenMaskMode: "top",
      burdenView: "table",
      assocTraitType: "all",
      assocCredibleSetKind: "all",
      assocTraitMode: "all",
      assocMinCodingPip: 0.05,
      setActiveTab: (value) => set({ activeTab: value }),
      setBurdenTraitType: (value) => set({ burdenTraitType: value }),
      setBurdenMaskMode: (value) => set({ burdenMaskMode: value }),
      setBurdenView: (value) => set({ burdenView: value }),
      setAssocTraitType: (value) => set({ assocTraitType: value }),
      setAssocCredibleSetKind: (value) => set({ assocCredibleSetKind: value }),
      setAssocTraitMode: (value) => set({ assocTraitMode: value }),
      setAssocMinCodingPip: (value) => set({ assocMinCodingPip: value }),
    }),
    {
      name: "gene-evidence-storage",
      // a stored tab name that is no longer offered would leave the tab strip with nothing selected
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<GeneEvidenceState>;
        const merged = { ...current, ...stored };
        return GENE_EVIDENCE_TABS.includes(merged.activeTab)
          ? merged
          : { ...merged, activeTab: current.activeTab };
      },
    }
  )
);
