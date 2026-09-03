// mirror of src/utils/coding.ts; the BFF tsconfig only includes ./bff/*.ts so the frontend module
// is not importable here. consequence tokens arrive with a "_variant" suffix and are stripped
// first. The two files must stay byte-identical below this header — see the note there for the
// other three copies of this definition and for why synonymous and coding_sequence are out.
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
