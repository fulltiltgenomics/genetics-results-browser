// the /v1/gene_annotation response; import-free so the frontend can share it as a type

export interface GoTerm {
  id: string;
  term: string;
}

export interface GeneAnnotation {
  symbol: string;
  name: string | null;
  summary: string | null;
  cytoband: string | null;
  typeOfGene: string | null;
  ncbiGeneId: string | null;
  ensemblGeneId: string | null;
  omimId: string | null;
  uniprotId: string | null;
  pharmgkbId: string | null;
  go: { BP: GoTerm[]; MF: GoTerm[]; CC: GoTerm[] };
  pathways: {
    source: "kegg" | "reactome" | "wikipathways";
    id: string;
    name: string;
  }[];
  interpro: { id: string; desc: string }[];
  clingen: {
    disease: string;
    classification: string;
    modeOfInheritance: string | null;
    report: string | null;
  }[];
}

// the /v1/gene_constraint response: gnomAD's constraint of a gene, null where it has none, and
// the gene's ClinVar variants counted by classification
export interface GeneConstraint {
  pLI: number | null;
  // upper bound of the 90% interval of LoF observed/expected
  loeuf: number | null;
  observedLof: number | null;
  observedMissense: number | null;
  flags: string[];
  clinvar: {
    pathogenic: number;
    pathogenicLikelyPathogenic: number;
    likelyPathogenic: number;
  };
}
