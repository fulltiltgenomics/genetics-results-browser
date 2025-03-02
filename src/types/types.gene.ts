export type CSDatum = {
  resource: string;
  dataset: string;
  trait: string;
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
};

export type GeneModel = {
  geneName: string;
  ensg: string;
  strand: number;
  exonStarts: number[];
  exonEnds: number[];
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
  mlog10p: number;
  pip: number;
  beta: number;
  se: number;
  af: string;
};
