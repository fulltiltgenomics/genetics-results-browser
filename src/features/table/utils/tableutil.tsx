import { PhenotypeSearchHit } from "../../../types/types.normalized";

// shown on the "*" marker in the resource filter and the greyed PIP cells in the CS table. pseudo
// credible sets are approximate (LD + association based), not formal fine-mapping, so their PIPs are
// heuristic. wording mirrors the genetics-mcp-server pseudo-CS definition.
export const PSEUDO_CS_TOOLTIP =
  "Pseudo credible sets: approximate sets built from GWAS summary statistics and FinnGen LD around " +
  "the lead variant, not formal SuSiE fine-mapping. Their PIPs are heuristic and should be " +
  "interpreted with caution.";

export const pValRepr = (mlog10p: number | null): string => {
  // Open Targets omits mlog10p on many credible-set members; without this a missing value coerces
  // to 0 in the `<= 0` branch below and is reported as a p-value of exactly 1
  if (mlog10p == null || Number.isNaN(mlog10p)) {
    return "NA";
  }
  // @ts-expect-error typed number
  if (mlog10p == "NA") {
    return "";
  }
  if (mlog10p <= 0) {
    return "1";
  }
  const p = Math.pow(10, -mlog10p);
  let repr = p.toExponential(2);
  // in case of underflow put the string together
  if (p == 0) {
    const digits = Math.round(1000 * Math.pow(10, -(mlog10p - Math.floor(mlog10p)))) / 100;
    const exp = Math.ceil(mlog10p);
    repr = `${digits}e-${exp}`;
  }
  return repr;
};

export const afRepr = (af: string): string => {
  const afNumber = parseFloat(af);
  if (afNumber === 0) {
    return "0";
  }
  if (afNumber < 0.001) {
    return afNumber.toExponential(2);
  }
  return afNumber.toPrecision(2);
};

export const cleanConsequence = (consequence: string): string => {
  // strip the "variant" suffix whether the source separates words with "_" or " "
  // (the credible-set data is space-separated, e.g. "missense variant" -> "missense")
  return consequence.replace(/[ _]variant/g, "").replace(/_/g, " ");
};

// display formatter for trait / phenotype names: underscores -> spaces across the whole UI
// (e.g. "COVID_B2" -> "COVID B2", "macrophage_naive" -> "macrophage naive"). raw trait codes are
// still used unchanged for API matching / navigation; this is display-only.
export const formatTraitName = (name: string): string => name.replace(/_/g, " ");

// frontend display overrides for dataset ids whose raw name (a column value baked into the credible-set
// data) lacks the proteomics platform that FinnGen's dataset names carry inline. UKB-PPP is Olink
// Explore 3072 (3K), so surfacing the panel explains why a protein may have a FinnGen pQTL but no UKBB
// one (e.g. only on the 5K panel). Remove once the API can rename datasets (genetics-results-api issue).
const DATASET_LABEL_OVERRIDES: Record<string, string> = {
  UKB_PPP: "UKBB PPP (Olink 3K)",
};

// canonical dataset display name, shared by every view so the same dataset reads identically in the
// anno tables and the gene view. eQTL Catalogue sub-datasets (QTD ids) are enriched separately by their
// callers; this just applies the override map and spaces out the raw id.
export const datasetDisplayName = (dataset: string): string =>
  DATASET_LABEL_OVERRIDES[dataset] ?? dataset.replace(/_/g, " ");

/**
 * Build the canonical trait display-name resolver from the BFF-populated phenotypes map. The map is
 * keyed by `${resource}|${trait}` and its phenostring is already resolved by the trait IDENTIFIER
 * (trait_original) on the BFF side, so callers look up by the credible set's `trait` and get the
 * human-readable name (underscores -> spaces), falling back to the raw trait when unmapped.
 *
 * Centralized so every table (variant results, the credible-set detail, data-type comparison,
 * phenotype summary) resolves names identically — pass the store's normalizedData.phenotypes.
 */
export const makeTraitNameResolver =
  (phenotypes?: Record<string, { phenostring?: string }>) =>
  (resource: string, trait: string): string =>
    formatTraitName(phenotypes?.[`${resource}|${trait}`]?.phenostring ?? trait);

// display formatter for tissue / cell-type labels: underscores -> spaces and the "|" tissue/condition
// separator -> ", " (e.g. "tibial_nerve|naive" -> "tibial nerve, naive"). display-only.
export const formatTissue = (label: string): string =>
  label.replace(/_/g, " ").replace(/\|/g, ", ");

// counts line for a phenotype-search option: "12,345 cases, 67,890 controls" when both are known
// (case/control study), else "100,000 samples" (continuous trait / no control count), else "".
export const formatPhenotypeCounts = (
  hit: Pick<PhenotypeSearchHit, "sampleSize" | "nCases" | "nControls">
): string => {
  if (hit.nCases != null && hit.nControls != null) {
    return `${hit.nCases.toLocaleString()} cases, ${hit.nControls.toLocaleString()} controls`;
  }
  if (hit.sampleSize != null) return `${hit.sampleSize.toLocaleString()} samples`;
  return "";
};
