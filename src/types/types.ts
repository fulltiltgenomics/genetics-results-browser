type PhenoUrl = {
  label: string;
  url: string | null;
};

export type ResourceConfig = {
  data_types: DataType[];
  n_traits: string;
  p_thres?: number;
  pheno_urls: PhenoUrl[];
  resource: string;
  url: string | null;
  version: string;
  assoc?: boolean;
  finemapped?: boolean;
};

type AssocOrFinemappedConfig = {
  file: string;
  resources: ResourceConfig[];
};

type GnomadConfig = {
  file: string;
  populations: string[];
  url: string;
  version: string;
};

export type Config = {
  assoc: AssocOrFinemappedConfig;
  finemapped: AssocOrFinemappedConfig;
  gnomad: GnomadConfig;
};

export type ChangeLogItem = {
  type: string;
  text?: string;
  children?: Array<ChangeLogItem>;
};

export type GeneInfo = {
  _id: string;
  symbol: string;
  name: string;
  summary: string;
};

export type TableData = {
  data: Array<VariantRecord>;
  has_betas: boolean;
  has_custom_values: boolean;
  most_severe: Array<string>;
  phenos: PhenoMap;
  datasets: DatasetMap;
  input_variants: InputVariants;
  meta: ApiResponseMeta;
  freq_summary: Array<PopFreqSummary>;
  query_type: "variant" | "gene";
};

export type PopFreqSummary = {
  pop: string;
  max: number;
  maxPerc: number;
  min: number;
  minPerc: number;
};

export type VariantRecord = {
  variant: string;
  beta: number | undefined;
  value: string | undefined;
  anno: {
    rsid?: string;
    most_severe: string;
    gene_most_severe?: string;
    AF: number;
  };
  gnomad: GnomadRecord;
  assoc: {
    data: Array<AssocRecord>;
    groupedData: Array<GroupedAssocRecord>;
    counts: {
      resource: Record<string, { up: number; down: number; total: number }>;
      total: { up: number; down: number; total: number };
      eqtl: { up: number; down: number; total: number };
      pqtl: { up: number; down: number; total: number };
      sqtl: { up: number; down: number; total: number };
      edqtl: { up: number; down: number; total: number };
      qtl: { up: number; down: number; total: number };
      gwas: { up: number; down: number; total: number };
    };
    resources: Array<string>;
  };
  finemapped: {
    data: Array<FineMappedRecord>;
    groupedData: Array<GroupedFineMappedRecord>;
    counts: {
      resource: Record<string, { up: number; down: number; total: number }>;
      eqtl: { up: number; down: number; total: number };
      pqtl: { up: number; down: number; total: number };
      sqtl: { up: number; down: number; total: number };
      edqtl: { up: number; down: number; total: number };
      qtl: { up: number; down: number; total: number };
      gwas: { up: number; down: number; total: number };
      total: { up: number; down: number; total: number };
    };
    resources: Array<string>;
  };
};

export type PhenoMap = Record<string, Phenotype>;
export type DatasetMap = Record<string, Dataset>;

export type InputVariants = {
  found: Array<string>;
  not_found: Array<string>;
  unparsed: Array<string>;
  ac0: Array<string>;
  rsid_map: Record<string, Array<string>>;
};

export type Phenotype = {
  resource: string;
  data_type: DataType;
  phenocode: string;
  phenostring: string;
  chromosome?: string;
  gene_start?: number;
  gene_end?: number;
  strand?: number;
  num_cases: number;
  num_samples: number;
  trait_type: string;
  pub_author?: string;
  pub_date?: string;
  is_na?: boolean;
};

export type Dataset = {
  resource: string;
  data_type: DataType;
  dataset_id: string;
  study_id: string;
  study_label: string;
  sample_group: string;
  tissue_id: string;
  tissue_label: string;
  condition_label: string;
  sample_size: number;
  quant_method: string;
};

export type ApiResponseMeta = {
  gnomad: {
    populations: Array<string>;
    version: string;
    url: string;
  };
  assoc: {
    resources: Array<AssocResource>;
  };
  finemapped: {
    resources: Array<FineMappedResource>;
  };
};

export type AssocRecord = {
  resource: string;
  dataset: string;
  data_type: DataType;
  variant: string;
  phenocode: string;
  mlog10p: number;
  beta: number;
  sebeta: number;
  ld: boolean; // if the result is from open targets v2d ld data
  lead?: boolean; // if this is the lead variant
  overall_r2?: number;
  lead_chr?: string;
  lead_pos?: number; // position of lead variant when this is not the lead variant
  lead_ref?: string;
  lead_alt?: string;
  beta_input?: number;
};

export type GroupedAssocRecord = {
  id: string;
  resource: string;
  dataset: string;
  data_type: DataType;
  phenostring: string;
  phenocode: string[];
  mlog10p: number[];
  beta: number[];
  sebeta: number[];
  ld: boolean[];
  lead: boolean[];
  overall_r2: Array<number | undefined>;
  lead_chr: Array<string | undefined>;
  lead_pos: Array<number | undefined>;
  lead_ref: Array<string | undefined>;
  lead_alt: Array<string | undefined>;
  count: number;
};

export type AssocResource = {
  resource: string;
  data_types: DataType[];
  pheno_urls?: URLWithLabel[];
  file: string;
  p_thres: number;
};

export type FineMappedRecord = {
  resource: string;
  dataset: string;
  data_type: DataType;
  phenocode: string;
  cs_size: number;
  cs_min_r2: number;
  mlog10p: number;
  beta: number;
  se: number;
  pip: number;
};

export type GroupedFineMappedRecord = {
  id: string;
  resource: string;
  dataset: string;
  data_type: DataType;
  phenocode: string[];
  mlog10p: number[];
  beta: number[];
  pip: number[];
  cs_size: number[];
  cs_min_r2: number[];
  max_pip: number;
  count: number;
};

export enum DataType {
  GWAS = "GWAS",
  EQTL = "eQTL",
  PQTL = "pQTL",
  SQTL = "sQTL",
  EDQTL = "edQTL",
  METABOQTL = "metaboQTL",
  NA = "NA",
}

export enum QTLType {
  CIS = "CIS",
  TRANS = "TRANS",
}

export type FineMappedResource = {
  resource: string;
  data_types: DataType[];
};

export type GnomadRecord = {
  exomes?: GnomadVariantRecord;
  genomes?: GnomadVariantRecord;
  preferred: "genomes" | "exomes";
};

export type GnomadVariantRecord = {
  AF: number;
  rsids: string;
  most_severe: string;
  gene_most_severe: string;
  filters: string | null;
  consequences: Array<{ gene_symbol: string; consequence: string }>;
  popmax: { pop: string; af: number };
  popmin: { pop: string; af: number };
  // population AF_pop fields omitted here for maintainability
};

export type URLWithLabel = {
  url: string;
  label: string;
};

export type PhenoSummaryTableData = Array<PhenoSummaryTableRow>;

export type PhenoSummaryTableRow = {
  pheno: Phenotype;
  dataset: string;
  total: number;
  consistent: number;
  opposite: number;
};

export type TissueSummaryTableData = Array<TissueSummaryTableRow>;

export type TissueSummaryTableRow = {
  tissue: string;
  total: number;
  qtlAssocs: VariantRecord[];
};
