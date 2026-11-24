import { create } from "zustand";
import { persist } from "zustand/middleware";

export const GENE_EVIDENCE_TABS = [
  "ai summary",
  "gene burden",
  "variant association",
  "qtl",
  "expression",
  "protein",
  "mendelian",
  "annotation",
] as const;
export type GeneEvidenceTabName = (typeof GENE_EVIDENCE_TABS)[number];

export const EXPRESSION_TABS = ["gtex", "cellxgene", "hpa"] as const;
export type ExpressionTabName = (typeof EXPRESSION_TABS)[number];

export type BurdenTraitType = "all" | "binary" | "quantitative";
export type BurdenMaskMode = "top" | "all";
export type BurdenView = "table" | "plot";
// fine-mapped credible sets, or the approximate ones built from summary statistics and LD
export type CredibleSetKind = "all" | "susie" | "pseudo";
// a table row per credible set, or per variant and dataset only the set the variant is strongest in
export type AssocTraitMode = "all" | "top";
// the variant a credible set has to have to pass: any, a coding one (LoF included), or a LoF one
export type AssocVariantMode = "any" | "coding" | "lof";

// filters that take results out of view. they last from gene to gene while the gene page is open
// and are not stored: one left on from an earlier visit would make a gene look short of evidence
const FILTER_DEFAULTS = {
  burdenTraitType: "all" as BurdenTraitType,
  assocTraitType: "all" as BurdenTraitType,
  assocCredibleSetKind: "all" as CredibleSetKind,
  assocVariantMode: "any" as AssocVariantMode,
};

// how the results are laid out, kept across gene changes and page reloads
interface GeneEvidencePreferences {
  activeTab: GeneEvidenceTabName;
  expressionTab: ExpressionTabName;
  burdenMaskMode: BurdenMaskMode;
  burdenView: BurdenView;
  assocTraitMode: AssocTraitMode;
}

const PREFERENCE_DEFAULTS: GeneEvidencePreferences = {
  activeTab: "gene burden",
  expressionTab: "gtex",
  burdenMaskMode: "top",
  burdenView: "table",
  assocTraitMode: "all",
};

const preferencesOf = (state: Partial<GeneEvidencePreferences>): Partial<GeneEvidencePreferences> =>
  Object.fromEntries(
    Object.keys(PREFERENCE_DEFAULTS)
      .filter((key) => key in state)
      .map((key) => [key, state[key as keyof GeneEvidencePreferences]])
  );

type GeneEvidenceState = GeneEvidencePreferences &
  typeof FILTER_DEFAULTS & {
    setActiveTab: (value: GeneEvidenceTabName) => void;
    setExpressionTab: (value: ExpressionTabName) => void;
    setBurdenTraitType: (value: BurdenTraitType) => void;
    setBurdenMaskMode: (value: BurdenMaskMode) => void;
    setBurdenView: (value: BurdenView) => void;
    setAssocTraitType: (value: BurdenTraitType) => void;
    setAssocCredibleSetKind: (value: CredibleSetKind) => void;
    setAssocTraitMode: (value: AssocTraitMode) => void;
    setAssocVariantMode: (value: AssocVariantMode) => void;
    resetFilters: () => void;
  };

export const useGeneEvidenceStore = create<GeneEvidenceState>()(
  persist(
    (set) => ({
      ...PREFERENCE_DEFAULTS,
      ...FILTER_DEFAULTS,
      setActiveTab: (value) => set({ activeTab: value }),
      setExpressionTab: (value) => set({ expressionTab: value }),
      setBurdenTraitType: (value) => set({ burdenTraitType: value }),
      setBurdenMaskMode: (value) => set({ burdenMaskMode: value }),
      setBurdenView: (value) => set({ burdenView: value }),
      setAssocTraitType: (value) => set({ assocTraitType: value }),
      setAssocCredibleSetKind: (value) => set({ assocCredibleSetKind: value }),
      setAssocTraitMode: (value) => set({ assocTraitMode: value }),
      setAssocVariantMode: (value) => set({ assocVariantMode: value }),
      resetFilters: () => set(FILTER_DEFAULTS),
    }),
    {
      name: "gene-evidence-storage",
      partialize: (state) => preferencesOf(state),
      // only the preferences are read back, so a filter left in storage by an older build is
      // dropped. a stored tab name that is no longer offered would leave the tab strip with
      // nothing selected
      merge: (persisted, current) => {
        const merged = { ...current, ...preferencesOf(persisted ?? {}) };
        return GENE_EVIDENCE_TABS.includes(merged.activeTab)
          ? merged
          : { ...merged, activeTab: current.activeTab };
      },
    }
  )
);
