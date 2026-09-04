// The suite's shared definition of a coding variant, matched against `most_severe`. The other
// four copies are bff/coding.ts (a mirror, because the BFF tsconfig only includes ./bff/*.ts),
// genetics-results-api's app/config/common.py `coding_set`, and genetics-mcp-server's
// sdk/plots.py `_CODING_CONSEQUENCES` plus the chat prompt's Terminology block. Changing one
// means changing all five.
//
// `synonymous_variant` and `coding_sequence_variant` are deliberately absent: neither changes
// the protein, which is what this set is for. `splice_region_variant` is absent for a different
// reason — VEP assigns it up to 8 bp into an intron, so it does not establish a coding position.
//
// STRIPPING IS DONE HERE, not at the call sites. The annotation carries `missense_variant` while
// these tokens are suffix-less, and a call site that forgot to strip silently matched only the
// six terms whose SO name has no suffix — under-reporting coding variants rather than failing.
const CODING = new Set([
  "missense",
  "frameshift",
  "inframe_insertion",
  "inframe_deletion",
  "transcript_ablation",
  "stop_gained",
  "stop_lost",
  "start_lost",
  "splice_acceptor",
  "splice_donor",
  "incomplete_terminal_codon",
  "protein_altering",
]);

const LOF = new Set([
  "transcript_ablation",
  "splice_acceptor",
  "splice_donor",
  "stop_gained",
  "frameshift",
  "stop_lost",
  "start_lost",
]);

const strip = (mostSevere: string): string => mostSevere.replace("_variant", "");

export const isCoding = (mostSevere: string): boolean => CODING.has(strip(mostSevere));
export const isLoF = (mostSevere: string): boolean => LOF.has(strip(mostSevere));
