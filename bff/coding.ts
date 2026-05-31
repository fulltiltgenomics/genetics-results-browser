// mirror of src/utils/coding.ts; the BFF tsconfig only includes ./bff/*.ts so the frontend module
// is not importable here. consequence tokens arrive with a "_variant" suffix and are stripped first.
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
  "coding_sequence",
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
