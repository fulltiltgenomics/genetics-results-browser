// TODO hash
export const isCoding = (mostSevere: string): boolean => {
  return (
    mostSevere === "missense" ||
    mostSevere === "frameshift" ||
    mostSevere === "inframe_insertion" ||
    mostSevere === "inframe_deletion" ||
    mostSevere === "transcript_ablation" ||
    mostSevere === "stop_gained" ||
    mostSevere === "stop_lost" ||
    mostSevere === "start_lost" ||
    mostSevere === "splice_acceptor" ||
    mostSevere === "splice_donor" ||
    mostSevere === "incomplete_terminal_codon" ||
    mostSevere === "protein_altering" ||
    mostSevere === "coding_sequence"
  );
};

export const isLoF = (mostSevere: string): boolean => {
  return (
    mostSevere === "transcript_ablation" ||
    mostSevere === "splice_acceptor" ||
    mostSevere === "splice_donor" ||
    mostSevere === "stop_gained" ||
    mostSevere === "frameshift" ||
    mostSevere === "stop_lost" ||
    mostSevere === "start_lost"
  );
};
