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
 * One gene drawn as a model. The body is min(exonStarts)..max(exonEnds) — the span of the ONE
 * transcript being drawn, GENCODE's Ensembl-canonical one, and deliberately not the gene
 * record's own start and end. A gene record spans every transcript it has, which for TUBA1C
 * is 86 kb against a 9.5 kb canonical transcript, so drawing the record puts the exons in a
 * corner of a long bare line and the gene reads as being somewhere it is not. A row the API
 * sent no exons for arrives as one full-length exon, so the same min/max gives the record
 * back where that is all there is.
 *
 * The exon arrays are positional and equal length: exon i spans exonStarts[i]..exonEnds[i]
 * and its translated part is cdsStarts[i]..cdsEnds[i], null where that exon is entirely UTR.
 */
export type GeneModel = {
  geneName: string;
  ensg: string;
  chr: string;
  strand: number;
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
