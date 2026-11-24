// the /v1/gene_association response; import-free so the frontend can share it as a type

/**
 * Every GWAS credible set with a member in the gene or `window` bp either side of it, without the
 * per-member statistics. Columnar and dictionary-encoded: each `sets.*` array has one entry per
 * credible set, each `variants.*` array one per unique variant, and a number in a column named
 * after a dictionary is an index into it.
 */
export interface GeneAssociationSummary {
  gene: string;
  chr: string;
  window: number;
  // names the sets and their order; GeneAssociationSetIds answers with the same one
  setsKey: string;
  datasets: string[];
  resources: string[];
  consequences: string[];
  // the gene each variant's most severe consequence is annotated to
  genes: string[];
  // sorted by position
  variants: {
    pos: number[];
    ref: string[];
    alt: string[];
    // -1 where the API has no consequence or gene for the variant
    consequence: number[];
    gene: number[];
    variantClass: VariantClassCode[];
  };
  // one entry per trait of a resource
  traits: {
    resource: number[];
    code: string[];
    // the API's name, or the resource metadata's where the API served the code as the name
    name: string[];
    type: TraitTypeCode[];
  };
  sets: {
    trait: number[];
    dataset: number[];
    pseudo: (0 | 1)[];
    // of the whole credible set, which can reach beyond the window
    size: number[];
    minR2: (number | null)[];
    // the member with the highest PIP among those inside the window, and its statistics
    lead: number[];
    leadMlog10p: (number | null)[];
    leadBeta: (number | null)[];
    // members inside the window; the set's members are the next this-many entries of `members`
    memberCount: number[];
  };
  // all sets' members end to end, each set's in genomic order
  members: {
    variant: number[];
    // PIP × PIP_SCALE, an integer: the API serves PIPs to four decimals
    pip: number[];
  };
}

/**
 * The credible-set ids of a summary's sets, in the summary's order. Its own response because the
 * ids are needed only to open a set or to download the table, and are close to half of the
 * compressed bytes otherwise: most are hashes, which do not compress.
 */
export interface GeneAssociationSetIds {
  setsKey: string;
  csId: string[];
}

export const PIP_SCALE = 10_000;

export const VARIANT_CLASS = { other: 0, coding: 1, lof: 2 } as const;
export type VariantClassCode = (typeof VARIANT_CLASS)[keyof typeof VARIANT_CLASS];

export const TRAIT_TYPE = { unknown: 0, binary: 1, quantitative: 2 } as const;
export type TraitTypeCode = (typeof TRAIT_TYPE)[keyof typeof TRAIT_TYPE];
