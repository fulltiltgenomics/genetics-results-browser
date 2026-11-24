import { createHash } from "node:crypto";
import { isCoding, isLoF } from "./coding.js";
import {
  PIP_SCALE,
  TRAIT_TYPE,
  VARIANT_CLASS,
  type GeneAssociationSetIds,
  type GeneAssociationSummary,
  type TraitTypeCode,
  type VariantClassCode,
} from "./geneAssociationTypes.js";

// a credible_sets_by_gene row as parseTsv returns it: every value a string, null for NA
export type CredibleSetTsvRow = Record<string, string | null>;

export interface TraitMeta {
  name: string;
  traitType: string | null;
}

export interface SummaryLookups {
  // resource -> phenotype code -> metadata; a resource without metadata is absent
  traitMeta: Map<string, Map<string, TraitMeta>>;
  isPseudo: (resource: string, dataset: string) => boolean;
  // the type every trait of a dataset shares, null where the dataset mixes both
  datasetTraitType: (resource: string, dataset: string) => string | null;
}

const num = (v: string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const traitTypeCode = (t: string | null | undefined): TraitTypeCode =>
  t === "binary"
    ? TRAIT_TYPE.binary
    : t === "quantitative"
      ? TRAIT_TYPE.quantitative
      : TRAIT_TYPE.unknown;

const classOf = (mostSevere: string | null): VariantClassCode =>
  !mostSevere
    ? VARIANT_CLASS.other
    : isLoF(mostSevere)
      ? VARIANT_CLASS.lof
      : isCoding(mostSevere)
        ? VARIANT_CLASS.coding
        : VARIANT_CLASS.other;

class Dictionary {
  readonly values: string[] = [];
  private readonly index = new Map<string, number>();
  add(value: string | null): number {
    if (value == null) return -1;
    let i = this.index.get(value);
    if (i === undefined) {
      i = this.values.length;
      this.values.push(value);
      this.index.set(value, i);
    }
    return i;
  }
}

interface Variant {
  pos: number;
  ref: string;
  alt: string;
  consequence: number;
  gene: number;
  variantClass: VariantClassCode;
  // position in the sorted output, set once every row has been read
  index: number;
}

interface Member {
  variant: Variant;
  pip: number;
  mlog10p: number | null;
  beta: number | null;
}

interface CredibleSet {
  trait: number;
  dataset: number;
  pseudo: 0 | 1;
  csId: string;
  size: number;
  minR2: number | null;
  members: Member[];
  seen: Set<Variant>;
}

/**
 * Groups one-row-per-member credible-set rows into the columnar summary. Pure, so the shape is
 * tested without an upstream.
 */
export const buildGeneAssociationSummary = (
  gene: string,
  window: number,
  rows: CredibleSetTsvRow[],
  lookups: SummaryLookups
): { summary: GeneAssociationSummary; setIds: GeneAssociationSetIds } => {
  const datasets = new Dictionary();
  const resources = new Dictionary();
  const consequences = new Dictionary();
  const genes = new Dictionary();
  const variants = new Map<string, Variant>();
  const traitIndex = new Map<string, number>();
  const traits: GeneAssociationSummary["traits"] = { resource: [], code: [], name: [], type: [] };
  const sets = new Map<string, CredibleSet>();
  let chr = "";

  for (const row of rows) {
    const pos = num(row.pos);
    const pip = num(row.pip);
    if (row.data_type !== "GWAS" || pos == null || pip == null) continue;
    const resource = row.resource ?? "";
    const dataset = row.dataset ?? "";
    const code = row.trait_original ?? row.trait ?? "";
    const csId = row.cs_id ?? "";
    chr ||= row.chr ?? "";

    const variantKey = `${pos}:${row.ref}:${row.alt}`;
    let variant = variants.get(variantKey);
    if (!variant) {
      variant = {
        pos,
        ref: row.ref ?? "",
        alt: row.alt ?? "",
        consequence: consequences.add(row.most_severe),
        gene: genes.add(row.gene_most_severe),
        variantClass: classOf(row.most_severe),
        index: -1,
      };
      variants.set(variantKey, variant);
    }

    const setKey = `${resource}|${dataset}|${code}|${csId}`;
    let cs = sets.get(setKey);
    if (!cs) {
      const traitKey = `${resource}|${code}`;
      let trait = traitIndex.get(traitKey);
      if (trait === undefined) {
        const meta = lookups.traitMeta.get(resource)?.get(code);
        // the credible-set endpoint leaves some phenocodes unresolved and serves the code as the name
        const unresolved = row.trait === code;
        trait = traits.code.length;
        traitIndex.set(traitKey, trait);
        traits.resource.push(resources.add(resource));
        traits.code.push(code);
        traits.name.push(unresolved && meta?.name ? meta.name : (row.trait ?? code));
        traits.type.push(
          traitTypeCode(meta?.traitType ?? lookups.datasetTraitType(resource, dataset))
        );
      }
      cs = {
        trait,
        dataset: datasets.add(dataset),
        pseudo: lookups.isPseudo(resource, dataset) ? 1 : 0,
        csId,
        size: num(row.cs_size) ?? 0,
        minR2: num(row.cs_min_r2),
        members: [],
        seen: new Set(),
      };
      sets.set(setKey, cs);
    }
    // the API can serve a variant of a set twice
    if (cs.seen.has(variant)) continue;
    cs.seen.add(variant);
    cs.members.push({ variant, pip, mlog10p: num(row.mlog10p), beta: num(row.beta) });
  }

  const sorted = [...variants.values()].sort(
    (a, b) => a.pos - b.pos || a.ref.localeCompare(b.ref) || a.alt.localeCompare(b.alt)
  );
  sorted.forEach((v, i) => (v.index = i));

  const out: GeneAssociationSummary = {
    gene,
    chr,
    window,
    setsKey: "",
    datasets: datasets.values,
    resources: resources.values,
    consequences: consequences.values,
    genes: genes.values,
    variants: {
      pos: sorted.map((v) => v.pos),
      ref: sorted.map((v) => v.ref),
      alt: sorted.map((v) => v.alt),
      consequence: sorted.map((v) => v.consequence),
      gene: sorted.map((v) => v.gene),
      variantClass: sorted.map((v) => v.variantClass),
    },
    traits,
    sets: {
      trait: [],
      dataset: [],
      pseudo: [],
      size: [],
      minR2: [],
      lead: [],
      leadMlog10p: [],
      leadBeta: [],
      memberCount: [],
    },
    members: { variant: [], pip: [] },
  };

  const csId: string[] = [];
  for (const cs of sets.values()) {
    cs.members.sort((a, b) => a.variant.index - b.variant.index);
    let lead = cs.members[0];
    for (const m of cs.members) {
      if (m.pip > lead.pip) lead = m;
      out.members.variant.push(m.variant.index);
      out.members.pip.push(Math.round(m.pip * PIP_SCALE));
    }
    out.sets.trait.push(cs.trait);
    out.sets.dataset.push(cs.dataset);
    out.sets.pseudo.push(cs.pseudo);
    csId.push(cs.csId);
    out.sets.size.push(cs.size);
    out.sets.minR2.push(cs.minR2);
    out.sets.lead.push(lead.variant.index);
    out.sets.leadMlog10p.push(lead.mlog10p);
    out.sets.leadBeta.push(lead.beta);
    out.sets.memberCount.push(cs.members.length);
  }
  // the map's keys are the sets' full identities, in output order
  out.setsKey = createHash("sha1")
    .update([...sets.keys()].join("\n"))
    .digest("hex")
    .slice(0, 16);
  return { summary: out, setIds: { setsKey: out.setsKey, csId } };
};
