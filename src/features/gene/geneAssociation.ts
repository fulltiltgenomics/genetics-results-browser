import type { GeneCSApiRow } from "@/store/geneCS";
import type { AssocTraitMode, BurdenTraitType, CredibleSetKind } from "@/store/store.geneEvidence";
import { isCoding, isLoF } from "@/utils/coding";
import { datasetDisplayName, formatTraitName } from "../table/utils/tableutil";
import { matchesTraitType } from "./geneBurden";
import type { VariantClass } from "./GeneModelPlot";

/**
 * GWAS credible sets that hold a coding variant of the gene, one row per credible set, for the
 * variant association tab. Kept pure so the table, the gene-model track and the download agree and
 * the logic is tested without rendering.
 */

export interface CredibleSetVariant {
  variant: string;
  pos: number;
  pip: number;
  mlog10p: number | null;
  beta: number | null;
  consequence: string | null;
  // by consequence alone, so a neighbouring gene's coding variant is coloured as one
  variantClass: VariantClass;
  // annotated to the viewed gene; only these can qualify a credible set for the table
  inGene: boolean;
}

export interface CodingCredibleSet {
  key: string;
  resource: string;
  dataset: string;
  trait: string;
  traitOriginal: string;
  csId: string;
  chr: string;
  // of the whole credible set, which can reach beyond the gene
  csSize: number;
  csMinR2: number | null;
  // the members inside the region the caller fetched, in genomic order
  variants: CredibleSetVariant[];
  // the gene's coding variants in the set, highest PIP first; never empty
  codingVariants: CredibleSetVariant[];
}

const variantClass = (row: GeneCSApiRow): VariantClass =>
  !row.most_severe
    ? "other"
    : isLoF(row.most_severe)
      ? "lof"
      : isCoding(row.most_severe)
        ? "coding"
        : "other";

export const groupCodingCredibleSets = (
  rows: GeneCSApiRow[],
  gene: string
): CodingCredibleSet[] => {
  const sets = new Map<string, CodingCredibleSet>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.data_type !== "GWAS") {
      continue;
    }
    const key = `${row.resource}|${row.dataset}|${row.trait_original}|${row.cs_id}`;
    const variant = `${row.chr}:${row.pos}:${row.ref}:${row.alt}`;
    // the API can serve a variant of a set twice
    if (seen.has(`${key}|${variant}`)) {
      continue;
    }
    seen.add(`${key}|${variant}`);
    let cs = sets.get(key);
    if (!cs) {
      cs = {
        key,
        resource: row.resource,
        dataset: row.dataset,
        trait: row.trait,
        traitOriginal: row.trait_original,
        csId: row.cs_id,
        chr: String(row.chr),
        csSize: row.cs_size,
        csMinR2: row.cs_min_r2,
        variants: [],
        codingVariants: [],
      };
      sets.set(key, cs);
    }
    cs.variants.push({
      variant,
      pos: row.pos,
      pip: row.pip,
      mlog10p: row.mlog10p,
      beta: row.beta,
      consequence: row.most_severe,
      variantClass: variantClass(row),
      inGene: row.gene_most_severe === gene,
    });
  }
  const out: CodingCredibleSet[] = [];
  for (const cs of sets.values()) {
    cs.codingVariants = cs.variants
      .filter((v) => v.inGene && v.variantClass !== "other")
      .sort((a, b) => b.pip - a.pip);
    if (cs.codingVariants.length > 0) {
      cs.variants.sort((a, b) => a.pos - b.pos);
      out.push(cs);
    }
  }
  return out;
};

type DatasetFlag = { resource: string; dataset?: string; hasPseudoCredibleSets: boolean };

/**
 * Whether a dataset's credible sets are pseudo, from the /v1/datasets flag. The flag is per dataset
 * and one resource can hold both kinds, so the dataset label decides; a /v1/datasets row without a
 * label speaks for its whole resource.
 */
export const pseudoCredibleSetLookup = (
  datasets: DatasetFlag[] | undefined
): ((resource: string, dataset: string) => boolean) => {
  const byDataset = new Map<string, boolean>();
  const byResource = new Map<string, boolean>();
  for (const d of datasets ?? []) {
    if (d.dataset) {
      const key = `${d.resource}|${d.dataset}`;
      byDataset.set(key, (byDataset.get(key) ?? false) || d.hasPseudoCredibleSets);
    } else {
      byResource.set(d.resource, (byResource.get(d.resource) ?? false) || d.hasPseudoCredibleSets);
    }
  }
  return (resource, dataset) =>
    byDataset.get(`${resource}|${dataset}`) ?? byResource.get(resource) ?? false;
};

export interface CodingCredibleSetRow extends CodingCredibleSet {
  traitName: string;
  // null until the resource's phenotype metadata has answered, or when it does not list the trait
  quantitative: boolean | null;
  pseudo: boolean;
}

type TraitMetadata = Record<string, Record<string, { name: string; traitType: string | null }>>;

export const annotateCredibleSets = (
  sets: CodingCredibleSet[],
  metadata: TraitMetadata,
  isPseudo: (resource: string, dataset: string) => boolean
): CodingCredibleSetRow[] =>
  sets.map((cs) => {
    const meta = metadata[cs.resource]?.[cs.traitOriginal];
    // the credible-set endpoint leaves some phenocodes unresolved and serves the code as the name
    const unresolved = cs.trait === cs.traitOriginal;
    return {
      ...cs,
      traitName: unresolved && meta?.name ? meta.name : formatTraitName(cs.trait),
      quantitative: meta?.traitType == null ? null : meta.traitType === "quantitative",
      pseudo: isPseudo(cs.resource, cs.dataset),
    };
  });

export interface AssociationFilters {
  traitType: BurdenTraitType;
  credibleSetKind: CredibleSetKind;
  // a coding variant below this PIP does not count: not for the table, not for the gene model
  minCodingPip: number;
  traitMode: AssocTraitMode;
  search: string;
}

const searchText = (r: CodingCredibleSetRow): string =>
  [r.traitName, r.trait, r.traitOriginal, r.dataset, datasetDisplayName(r.dataset)]
    .join("\n")
    .toLowerCase();

// the stronger of two sets for one variant: its PIP there, then the p-value, which many Open
// Targets members lack
const outranks = (a: CredibleSetVariant, b: CredibleSetVariant): boolean =>
  a.pip !== b.pip ? a.pip > b.pip : (a.mlog10p ?? -Infinity) > (b.mlog10p ?? -Infinity);

type TopSets = Map<string, { row: CodingCredibleSetRow; variant: CredibleSetVariant; n: number }>;

// per coding variant and dataset, the credible set the variant is strongest in
const topSets = (rows: CodingCredibleSetRow[]): TopSets => {
  const top: TopSets = new Map();
  for (const row of rows) {
    for (const variant of row.codingVariants) {
      const key = `${variant.variant}|${row.dataset}`;
      const best = top.get(key);
      if (!best) {
        top.set(key, { row, variant, n: 1 });
      } else {
        best.n += 1;
        if (outranks(variant, best.variant)) {
          best.row = row;
          best.variant = variant;
        }
      }
    }
  }
  return top;
};

/**
 * A set whose trait type is not known yet passes only the unfiltered trait-type setting. Rows come
 * back with their coding variants cut to the PIP threshold, so the table's top variant, the "+N"
 * beside it and the gene model all count the same variants. The top-trait pick runs last, among
 * what the other filters keep.
 */
export const filterCredibleSetRows = (
  rows: CodingCredibleSetRow[],
  { traitType, credibleSetKind, minCodingPip, traitMode, search }: AssociationFilters
): CodingCredibleSetRow[] => {
  const needle = search.trim().toLowerCase();
  const kept = rows
    .filter(
      (r) =>
        (traitType === "all" ||
          (r.quantitative != null && matchesTraitType(traitType, r.quantitative))) &&
        (credibleSetKind === "all" || (credibleSetKind === "pseudo") === r.pseudo) &&
        (needle === "" || searchText(r).includes(needle))
    )
    .map((r) => ({ ...r, codingVariants: r.codingVariants.filter((v) => v.pip >= minCodingPip) }))
    .filter((r) => r.codingVariants.length > 0);
  if (traitMode === "all") {
    return kept;
  }
  const best = new Set([...topSets(kept).values()].map((t) => t.row));
  return kept.filter((r) => best.has(r));
};

export interface VariantDatasetSummary {
  dataset: string;
  // the trait whose credible set the variant is strongest in, and the variant's statistics there
  traitName: string;
  pip: number;
  mlog10p: number | null;
  beta: number | null;
  csSize: number;
  // traits of this dataset with a credible set holding the variant, among the rows given
  nTraits: number;
}

export interface CodingVariantSummary {
  variant: string;
  pos: number;
  consequence: string | null;
  variantClass: VariantClass;
  datasets: VariantDatasetSummary[];
}

/** The coding variants of the given rows, in genomic order, each with its top trait per dataset. */
export const summarizeCodingVariants = (rows: CodingCredibleSetRow[]): CodingVariantSummary[] => {
  const byVariant = new Map<string, CodingVariantSummary>();
  for (const { row, variant, n } of topSets(rows).values()) {
    let summary = byVariant.get(variant.variant);
    if (!summary) {
      summary = {
        variant: variant.variant,
        pos: variant.pos,
        consequence: variant.consequence,
        variantClass: variant.variantClass,
        datasets: [],
      };
      byVariant.set(variant.variant, summary);
    }
    summary.datasets.push({
      dataset: row.dataset,
      traitName: row.traitName,
      pip: variant.pip,
      mlog10p: variant.mlog10p,
      beta: variant.beta,
      csSize: row.csSize,
      nTraits: n,
    });
  }
  const out = [...byVariant.values()].sort((a, b) => a.pos - b.pos);
  for (const v of out) {
    v.datasets.sort((a, b) => a.dataset.localeCompare(b.dataset));
  }
  return out;
};
