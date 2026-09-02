export type CSDatum = {
  resource: string;
  dataset: string;
  dataType: string;
  trait: string;
  // upstream phenocode/molecular-trait id behind `trait`. equal to `trait` when the API could not
  // resolve a name (FinnGen drug ATC codes, lab OMOP codes), which is the cue to fall back to the
  // trait_name_mapping dictionary — see geneViewTraitName.
  traitOriginal?: string;
  // QTL tissue/context as "<tissue>|<condition>" (e.g. "macrophage|Listeria_5h"); null for GWAS
  cellType?: string | null;
  traitId: string;
  chr: string;
  variant: string[];
  pos: number[];
  pip: number[];
  mlog10p: number[];
  beta: number[];
  se: number[];
  csId: string; // TODO is this needed
  traitCSId: string;
  csNumber: number;
  numberOfCSs: number;
  csSize: number;
  csMinR2: number;
  consequence: string[];
  isCoding: boolean[];
  isLoF: boolean[];
  af: string[];
  gene: string[];
  rsid: string[];
};

/**
 * One gene drawn as a model. The body is geneStart..geneEnd and is NOT derivable from the
 * exons: the exons belong to one transcript (GENCODE's Ensembl-canonical one) while the gene
 * spans every transcript, so min/max over exonStarts/exonEnds draws a shorter gene than the
 * one the label names.
 *
 * The exon arrays are positional and equal length: exon i spans exonStarts[i]..exonEnds[i]
 * and its translated part is cdsStarts[i]..cdsEnds[i], null where that exon is entirely UTR.
 */
export type GeneModel = {
  geneName: string;
  ensg: string;
  chr: string;
  strand: number;
  geneStart: number;
  geneEnd: number;
  exonStarts: number[];
  exonEnds: number[];
  cdsStarts: (number | null)[];
  cdsEnds: (number | null)[];
};

export type TraitStatus = {
  csOverlappingTraits: number;
  variantOverlappingTraits: number;
};

export type CSStatus = {
  csSize: number;
  csMinR2: number;
};

export type SelectedVariantStats = {
  variant: string;
  consequence: string;
  isLoF: boolean;
  isCoding: boolean;
  mlog10p: number;
  pip: number;
  beta: number;
  se: number;
  af: string;
};
