import { GeneEvidenceTabName } from "@/store/store.geneEvidence";

// the stored tab names stay as they are, so a browser's remembered tab survives a relabelling
const TAB_LABELS: Partial<Record<GeneEvidenceTabName, string>> = {
  "variant association": "GWAS",
};

export const tabLabel = (tab: GeneEvidenceTabName): string => TAB_LABELS[tab] ?? tab;

// offered in the tab strip but with nothing behind them yet
export const COMING_SOON: ReadonlySet<GeneEvidenceTabName> = new Set(["qtl"]);
