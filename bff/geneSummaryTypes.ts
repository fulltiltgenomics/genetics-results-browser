// genetics-results-api's /v1/gene_summary/{gene} response, passed through as it is: an AI-written
// summary of the suite's own evidence for a gene

// the gene page tabs a finding can point at
export type GeneSummaryTab =
  "gene burden" | "variant association" | "qtl" | "expression" | "mendelian" | "annotation";

export interface GeneSummary {
  gene: string;
  // the date the summary was written, YYYY-MM-DD, and the model that wrote it
  generated: string;
  model: string;
  headline: string;
  overview: string;
  findings: {
    statement: string;
    // where the reader can see the rows behind the statement
    tab: GeneSummaryTab;
    // the rows the statement rests on, each described in one line
    evidence: { id: string; label: string }[];
  }[];
  // what is absent, null or unavailable and matters for reading the rest
  gaps: string[];
}
