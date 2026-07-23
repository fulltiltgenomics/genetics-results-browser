import { GnomadFreq } from "../types/types.normalized";
import api from "./api";

/**
 * Deferred gnomAD enrichment (genetics-results-browser-3lu.1). gnomAD is the slowest upstream fan-out,
 * so the variant path no longer fetches it up front with the rest of the /v1/results assembly. Instead
 * the client loads it lazily via POST /v1/gnomad — for the currently visible table page, and for ALL
 * variants when a whole-result-set feature (sort / filter / export by the AF column) needs every row.
 *
 * Returns a map keyed by canonical "chr:pos:ref:alt" variant id; variants gnomAD has no row for are
 * simply omitted (same as before the deferral — an absent gnomad field is not fabricated).
 */
export const fetchGnomadForVariants = async (
  variantIds: string[]
): Promise<Record<string, GnomadFreq>> => {
  if (variantIds.length === 0) return {};
  const { data } = await api.post<{ gnomad: Record<string, GnomadFreq> }>("/v1/gnomad", {
    variants: variantIds,
  });
  return data.gnomad ?? {};
};
