import { IconButton, Tooltip } from "@mui/material";
import ArrowRightAltIcon from "@mui/icons-material/ArrowRightAlt";
import { useMemo } from "react";
import { useDataStore } from "../../store/store";
import { CredibleSetDataType } from "../../types/types.normalized";

/**
 * (resource | lowercased data_type) pairs that actually expose full per-variant summary stats. The
 * handoff calls summary_stats/{resource}/{data_type}, which 404s for resources that have credible
 * sets but no sumstats (open_targets, eqtl_catalogue, ukbb pqtl, finngen caqtl, ...). CS dataType is
 * canonical-cased ("GWAS"/"pQTL"); /datasets data_type is lowercase — compare lowered.
 */
export const useSummaryStatsCapable = (): Set<string> => {
  const datasets = useDataStore((state) => state.normalizedData?.datasets ?? {});
  return useMemo(() => {
    const set = new Set<string>();
    for (const d of Object.values(datasets)) {
      if (d.hasSummaryStats) set.add(`${d.resource}|${d.dataType.toLowerCase()}`);
    }
    return set;
  }, [datasets]);
};

/**
 * Right-arrow affordance shown before a trait name that hands off to the "Single phenotype sumstats"
 * tab for that trait across all input variants (replaces the old per-row "search" button). Uses the
 * search-only handoff channel (not setSelectedPhenotype) so the other tables are not narrowed.
 *
 * Restricted to GWAS traits: the handoff addresses summary_stats by the credible-set trait, which only
 * resolves cleanly for GWAS (the phenocode). QTL handoff would need a gene×cell-type id — e.g. finngen
 * single-cell eQTL sumstats are keyed per cell type, so the bare gene symbol returns "No data found".
 * Still gated on the (resource, data type) sumstats capability so e.g. open_targets GWAS is excluded.
 */
export const PhenoSumstatsArrow = (props: {
  resource: string;
  trait: string;
  traitOriginal: string;
  dataType: CredibleSetDataType;
}) => {
  const capable = useSummaryStatsCapable();
  const setPhenotypeSearchSelection = useDataStore((state) => state.setPhenotypeSearchSelection);
  const setActiveTab = useDataStore((state) => state.setActiveTab);
  if (props.dataType !== "GWAS") return null;
  if (!capable.has(`${props.resource}|${props.dataType.toLowerCase()}`)) return null;
  return (
    <Tooltip title="See full summary-stat results for all input variants for this trait">
      <IconButton
        size="small"
        // stopPropagation so the click doesn't toggle the expandable row it sits in
        onClick={(e) => {
          e.stopPropagation();
          setPhenotypeSearchSelection({
            resource: props.resource,
            trait: props.trait,
            traitOriginal: props.traitOriginal,
          });
          setActiveTab("phenotype_search");
        }}
        sx={{ p: 0, mr: "3px" }}>
        <ArrowRightAltIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
};
