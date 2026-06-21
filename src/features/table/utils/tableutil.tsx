import { TableData } from "../../../types/types";

// shown on the "*" marker in the resource filter and the greyed PIP cells in the CS table. pseudo
// credible sets are approximate (LD + association based), not formal fine-mapping, so their PIPs are
// heuristic. wording mirrors the genetics-mcp-server pseudo-CS definition.
export const PSEUDO_CS_TOOLTIP =
  "Pseudo credible set: an approximate set built from GWAS summary statistics and LD around the lead " +
  "variant, not formal fine-mapping (e.g. SuSiE/FINEMAP). Its PIPs are heuristic — interpret with caution.";

export const pValRepr = (mlog10p: number): string => {
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
  return consequence.replace(/_variant/g, "").replace(/_/g, " ");
};

// display formatter for trait / phenotype names: underscores -> spaces across the whole UI
// (e.g. "COVID_B2" -> "COVID B2", "macrophage_naive" -> "macrophage naive"). raw trait codes are
// still used unchanged for API matching / navigation; this is display-only.
export const formatTraitName = (name: string): string => name.replace(/_/g, " ");

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

// TODO if the threshold is the same across resources, just show the number
export const renderPThreshold = (clientData: TableData, thres: number): string => {
  if (thres === 1) {
    return clientData!.meta.assoc.resources.map((r) => `${r.p_thres} (${r.resource})`).join(", ");
  }
  return `the chosen threshold of ${thres}`;
};

// TODO should use the raw data instead of the HTML in these functions
// or make all HTML columns use the same format, e.g. give a value prop
// or use the meta property of the columns
export const filterAbsGreaterThanHTML = (row: any, id: string, filterValue: any): boolean => {
  const rowVal = row.getValue(id) as any;
  const val =
    typeof rowVal === "number"
      ? rowVal
      : typeof rowVal === "string"
      ? Number(rowVal)
      : rowVal.props.value !== undefined
      ? rowVal.props.value
      : typeof rowVal.props.children == "string"
      ? Number(rowVal.props.children)
      : rowVal.props.children[1] !== undefined
      ? Number(rowVal.props.children[1].props.children)
      : Number(rowVal.props.children.props.children);
  return Math.abs(val) > filterValue;
};

export const filterLessThanHTML = (row: any, id: string, filterValue: any): boolean => {
  const rowVal = row.getValue(id) as any;
  const val = id.toLowerCase().startsWith("gnomad.af")
    ? Number(row.getValue("af_hidden"))
    : typeof rowVal.props.children == "string"
    ? Number(rowVal.props.children)
    : Number(rowVal.props.children[1].props.children);
  return val < filterValue;
};

export const filterContainsWithTooltip = (row: any, id: string, filterValue: any): boolean => {
  const val = row.getValue(id) as any;
  if (typeof val === "string") {
    return (val as string).toLowerCase().indexOf(filterValue.toLowerCase()) > -1;
  } else if (typeof val === "object") {
    if (val.props.content !== undefined) {
      if (typeof filterValue === "object") {
        // multi-select
        return filterValue.length > 0
          ? filterValue.some(
              (f: string) =>
                val.props.content.props.children.toLowerCase().indexOf(f.toLowerCase()) > -1
            )
          : true;
      } else {
        if (val.props.phenos !== undefined) {
          return (
            val.props.phenos[0].phenostring.toLowerCase().indexOf(filterValue.toLowerCase()) > -1
          );
        }
        // text
        // no tooltip - blank field
        if (val.props.content.props.children === null) {
          return false;
        }
        return (
          val.props.content.props.children.toLowerCase().indexOf(filterValue.toLowerCase()) > -1
        );
      }
    }
    if (val.props.children.props !== undefined) {
      // tooltip
      return (
        val.props.children.props.children.toLowerCase().indexOf(filterValue.toLowerCase()) > -1
      );
    } else {
      //no tooltip
      return val.props.children.toLowerCase().indexOf(filterValue.toLowerCase()) > -1;
    }
  }
  return false;
};
