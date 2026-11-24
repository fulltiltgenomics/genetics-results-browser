import type {
  AssocVariantMode,
  BurdenTraitType,
  CredibleSetKind,
} from "@/store/store.geneEvidence";
import {
  PIP_SCALE,
  TRAIT_TYPE,
  VARIANT_CLASS,
  type GeneAssociationSummary,
} from "../../../bff/geneAssociationTypes";
import { datasetDisplayName, formatTraitName } from "../table/utils/tableutil";

/**
 * The variant association tab's data, derived from the BFF's columnar summary of the GWAS credible
 * sets around a gene. Kept pure, and in typed arrays indexed by set and by variant, so the track,
 * the table and the download agree and a filter change is one pass over the memberships.
 */

export interface AssocIndex {
  summary: GeneAssociationSummary;
  nSets: number;
  nVariants: number;
  // every set, in summary order
  allSets: Int32Array;
  // set i's members are entries memberStart[i] .. memberStart[i + 1] of the member arrays
  memberStart: Int32Array;
  memberVariant: Int32Array;
  memberPip: Float64Array;
  variantPos: Int32Array;
  // 1 for a coding variant annotated to the viewed gene
  variantCodingInGene: Uint8Array;
  // per variant over every set: the highest PIP it has and how many hold it
  variantMaxPip: Float64Array;
  variantNSets: Uint32Array;
  leadPip: Float64Array;
  // per set, among its members inside the loaded region: the coding variants of any gene, the
  // strongest of them (-1 for none) and its PIP
  nCoding: Uint16Array;
  codingVariant: Int32Array;
  codingPip: Float64Array;
  traitName: string[];
  // lower-cased text the search matches, per trait and per dataset
  traitSearchText: string[];
  datasetSearchText: string[];
}

export const buildAssocIndex = (summary: GeneAssociationSummary): AssocIndex => {
  const nSets = summary.sets.lead.length;
  const nVariants = summary.variants.pos.length;
  const memberStart = new Int32Array(nSets + 1);
  for (let i = 0; i < nSets; i++) {
    memberStart[i + 1] = memberStart[i] + summary.sets.memberCount[i];
  }
  const memberVariant = Int32Array.from(summary.members.variant);
  const memberPip = Float64Array.from(summary.members.pip, (p) => p / PIP_SCALE);
  const classes = summary.variants.variantClass;
  const geneIndex = summary.genes.indexOf(summary.gene);
  const leadPip = new Float64Array(nSets);
  const nCoding = new Uint16Array(nSets);
  const codingVariant = new Int32Array(nSets).fill(-1);
  const codingPip = new Float64Array(nSets);
  const variantMaxPip = new Float64Array(nVariants);
  const variantNSets = new Uint32Array(nVariants);
  for (let i = 0; i < nSets; i++) {
    for (let m = memberStart[i]; m < memberStart[i + 1]; m++) {
      const v = memberVariant[m];
      variantNSets[v]++;
      variantMaxPip[v] = Math.max(variantMaxPip[v], memberPip[m]);
      if (v === summary.sets.lead[i]) {
        leadPip[i] = memberPip[m];
      }
      if (classes[v] !== VARIANT_CLASS.other) {
        nCoding[i]++;
        if (codingVariant[i] < 0 || memberPip[m] > codingPip[i]) {
          codingVariant[i] = v;
          codingPip[i] = memberPip[m];
        }
      }
    }
  }
  const traitName = summary.traits.name.map(formatTraitName);
  return {
    summary,
    nSets,
    nVariants,
    allSets: Int32Array.from({ length: nSets }, (_, i) => i),
    memberStart,
    memberVariant,
    memberPip,
    variantPos: Int32Array.from(summary.variants.pos),
    variantCodingInGene: Uint8Array.from(classes, (c, v) =>
      c !== VARIANT_CLASS.other && summary.variants.gene[v] === geneIndex ? 1 : 0
    ),
    variantMaxPip,
    variantNSets,
    leadPip,
    nCoding,
    codingVariant,
    codingPip,
    traitName,
    traitSearchText: traitName.map((name, i) =>
      [name, summary.traits.name[i], summary.traits.code[i]].join("\n").toLowerCase()
    ),
    datasetSearchText: summary.datasets.map((d) =>
      [d, datasetDisplayName(d)].join("\n").toLowerCase()
    ),
  };
};

export const variantId = (index: AssocIndex, v: number): string => {
  const { chr, variants } = index.summary;
  return `${chr}:${variants.pos[v]}:${variants.ref[v]}:${variants.alt[v]}`;
};

// a stretch of the chromosome, both ends included
export interface Region {
  start: number;
  end: number;
}

/**
 * What the user picked in the track: a dragged region, or one variant. The variant is held by id,
 * not by index, because the gene-body and the padded summary number their variants differently.
 */
export type Selection =
  ({ kind: "region" } & Region) | { kind: "variant"; id: string; pos: number };

// first index whose position is >= pos
const lowerBound = (positions: ArrayLike<number>, pos: number): number => {
  let lo = 0;
  let hi = positions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (positions[mid] < pos) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
};

// [from, to) of the position-sorted variants inside the region
export const variantsInRegion = (
  positions: ArrayLike<number>,
  region: Region
): [number, number] => [lowerBound(positions, region.start), lowerBound(positions, region.end + 1)];

// the selected variants as a run [from, to) of the index's variants; empty for a variant the
// index does not hold
export const selectionRange = (index: AssocIndex, selection: Selection): [number, number] => {
  if (selection.kind === "region") {
    return variantsInRegion(index.variantPos, selection);
  }
  const [from, to] = variantsInRegion(index.variantPos, {
    start: selection.pos,
    end: selection.pos,
  });
  for (let v = from; v < to; v++) {
    if (variantId(index, v) === selection.id) {
      return [v, v + 1];
    }
  }
  return [0, 0];
};

// a coding or LoF variant counts towards the variant-kind filter above this PIP in the set
export const KIND_MIN_PIP = 0.05;

export interface AssocFilters {
  traitType: BurdenTraitType;
  credibleSetKind: CredibleSetKind;
  // a set passes for a member of the asked-for kind with a PIP above KIND_MIN_PIP
  mode: AssocVariantMode;
  // words, each of which has to be in the set's trait or dataset
  search: string;
  // [from, to) of the variants picked in the track; the track then fades what shares no passing
  // set with them
  selected?: [number, number] | null;
}

export interface AssocView {
  // the sets that pass the filters, in summary order, whatever is selected
  sets: Int32Array;
  // 1 for a member of a set that passes and, where variants are selected, holds one of them; the
  // others are drawn faint
  variantPasses: Uint8Array;
  // per variant, among the sets that pass the filters whatever is selected: how many hold it and
  // the highest PIP it has in them. a dot is drawn at that PIP; one that no passing set holds is
  // drawn at its highest PIP over every set, so it moves when a filter takes its last set away
  variantPassingSets: Uint32Array;
  variantPassingPip: Float64Array;
}

const matchesKind = (kind: CredibleSetKind, pseudo: 0 | 1): boolean =>
  kind === "all" || (kind === "pseudo") === (pseudo === 1);

const matchesType = (traitType: BurdenTraitType, code: number): boolean =>
  traitType === "all" ||
  code === (traitType === "binary" ? TRAIT_TYPE.binary : TRAIT_TYPE.quantitative);

/**
 * What the filters make of the sets and of the track. A set passes when it is of the trait type
 * and credible-set kind asked for, has every word of the search in its trait or its dataset, and
 * has a variant of the asked-for kind with a PIP above KIND_MIN_PIP.
 * Nothing is taken off the track: a variant is faint when no passing set holds it, or with a
 * selection when none of the passing sets it is in holds a selected variant. A set whose trait type
 * is unknown passes only the unfiltered setting.
 */
export const computeAssocView = (index: AssocIndex, filters: AssocFilters): AssocView => {
  const { summary, nSets, nVariants, memberStart, memberVariant, memberPip } = index;
  const { sets, traits } = summary;
  const classes = summary.variants.variantClass;
  const asked = (cls: number): boolean =>
    filters.mode === "any" ||
    cls === VARIANT_CLASS.lof ||
    (filters.mode === "coding" && cls === VARIANT_CLASS.coding);
  const words = filters.search.toLowerCase().split(/\s+/).filter(Boolean);
  // per word, the traits and the datasets that have it
  const inTrait = words.map((w) => index.traitSearchText.map((text) => text.includes(w)));
  const inDataset = words.map((w) => index.datasetSearchText.map((text) => text.includes(w)));

  const variantPasses = new Uint8Array(nVariants);
  const variantPassingPip = new Float64Array(nVariants);
  const variantPassingSets = new Uint32Array(nVariants);
  const passing: number[] = [];
  for (let s = 0; s < nSets; s++) {
    const trait = sets.trait[s];
    if (
      !matchesType(filters.traitType, traits.type[trait]) ||
      !matchesKind(filters.credibleSetKind, sets.pseudo[s]) ||
      !words.every((_, w) => inTrait[w][trait] || inDataset[w][sets.dataset[s]])
    ) {
      continue;
    }
    let has = false;
    for (let m = memberStart[s]; m < memberStart[s + 1] && !has; m++) {
      has =
        asked(classes[memberVariant[m]]) && (filters.mode === "any" || memberPip[m] > KIND_MIN_PIP);
    }
    if (!has) {
      continue;
    }
    passing.push(s);
    let holds = !filters.selected;
    for (let m = memberStart[s]; m < memberStart[s + 1] && !holds; m++) {
      holds = memberVariant[m] >= filters.selected![0] && memberVariant[m] < filters.selected![1];
    }
    for (let m = memberStart[s]; m < memberStart[s + 1]; m++) {
      const v = memberVariant[m];
      if (holds) {
        variantPasses[v] = 1;
      }
      variantPassingSets[v]++;
      variantPassingPip[v] = Math.max(variantPassingPip[v], memberPip[m]);
    }
  }
  return {
    sets: Int32Array.from(passing),
    variantPasses,
    variantPassingSets,
    variantPassingPip,
  };
};

// the PIP a variant has in a set, or -1 where the set does not hold it
const memberPipOf = (index: AssocIndex, s: number, v: number): number => {
  let lo = index.memberStart[s];
  let hi = index.memberStart[s + 1];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (index.memberVariant[mid] < v) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo < index.memberStart[s + 1] && index.memberVariant[lo] === v ? index.memberPip[lo] : -1;
};

/** Of `sets`, those with one of the variants [from, to) among their members, at any PIP. */
export const setsWithVariants = (
  index: AssocIndex,
  sets: Int32Array,
  [from, to]: [number, number]
): Int32Array =>
  // a set's members are in genomic order: it reaches into the run when its first member at or
  // past the run's start is still before its end
  sets.filter((s) => {
    let lo = index.memberStart[s];
    let hi = index.memberStart[s + 1];
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (index.memberVariant[mid] < from) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo < index.memberStart[s + 1] && index.memberVariant[lo] < to;
  });

/**
 * One set per dataset and key variant: the one the variant is strongest in, by its PIP there and
 * then by the lead's p-value, which many Open Targets sets lack. A set's key variant is `keyVariant`
 * where one is given, as when the table is about one variant, and its lead otherwise. `more` says
 * how many sets each kept one stands for besides itself.
 */
export const collapseToTopTrait = (
  index: AssocIndex,
  sets: Int32Array,
  keyVariant: number | null
): { sets: Int32Array; more: Map<number, number> } => {
  const { summary, nVariants } = index;
  const best = new Map<number, { set: number; pip: number; n: number }>();
  for (const s of sets) {
    const v = keyVariant ?? summary.sets.lead[s];
    const pip = keyVariant == null ? index.leadPip[s] : memberPipOf(index, s, v);
    const key = summary.sets.dataset[s] * nVariants + v;
    const top = best.get(key);
    if (!top) {
      best.set(key, { set: s, pip, n: 1 });
      continue;
    }
    top.n++;
    if (
      pip > top.pip ||
      (pip === top.pip &&
        (summary.sets.leadMlog10p[s] ?? -Infinity) >
          (summary.sets.leadMlog10p[top.set] ?? -Infinity))
    ) {
      top.set = s;
      top.pip = pip;
    }
  }
  const more = new Map<number, number>();
  for (const top of best.values()) {
    more.set(top.set, top.n - 1);
  }
  return { sets: sets.filter((s) => more.has(s)), more };
};

/** One table row: a credible set, with everything a cell, a sort or the download reads. */
export interface AssocRow {
  set: number;
  // stable across the gene-body and the padded summary, which number their sets differently
  key: string;
  resource: string;
  dataset: string;
  traitCode: string;
  traitName: string;
  traitType: "binary" | "quantitative" | "";
  pseudo: boolean;
  leadVariant: string;
  leadPos: number;
  leadConsequence: string | null;
  leadPip: number;
  leadMlog10p: number | null;
  leadBeta: number | null;
  csSize: number;
  // members inside the fetched region; fewer than csSize when the set reaches beyond it, and the
  // lead and the coding count are then of those
  nMembersLoaded: number;
  csMinR2: number | null;
  nCoding: number;
  codingPip: number | null;
  // the gene of the strongest coding variant, where it is not the viewed gene
  codingOtherGene: string | null;
  // sets of other traits this row stands for, when the table keeps the top trait only
  moreTraits: number;
  // the PIP the selected variant has in the set, when the table is about one variant
  selectedPip: number | null;
  // -1 or 1 where the lead lies left or right of the track's view
  leadSide: -1 | 0 | 1;
}

export interface RowContext {
  more?: Map<number, number>;
  selectedVariant?: number | null;
  // the track's view
  region?: Region | null;
}

export const buildAssocRows = (
  index: AssocIndex,
  listed: Int32Array,
  { more, selectedVariant = null, region = null }: RowContext = {}
): AssocRow[] => {
  const { summary } = index;
  const { sets, traits, variants } = summary;
  const seen = new Map<string, number>();
  return Array.from(listed, (s) => {
    const coding = index.codingVariant[s];
    const codingGene =
      coding < 0 || variants.gene[coding] < 0 ? null : summary.genes[variants.gene[coding]];
    const trait = sets.trait[s];
    const lead = sets.lead[s];
    const type = traits.type[trait];
    const resource = summary.resources[traits.resource[trait]];
    const dataset = summary.datasets[sets.dataset[s]];
    const leadVariant = variantId(index, lead);
    // a trait normally has one credible set per lead variant in a dataset; the count keeps the
    // key unique where it has more
    const base = `${resource}|${dataset}|${traits.code[trait]}|${leadVariant}|${sets.size[s]}`;
    const repeat = seen.get(base) ?? 0;
    seen.set(base, repeat + 1);
    return {
      set: s,
      key: repeat === 0 ? base : `${base}|${repeat}`,
      resource,
      dataset,
      traitCode: traits.code[trait],
      traitName: index.traitName[trait],
      traitType:
        type === TRAIT_TYPE.binary
          ? "binary"
          : type === TRAIT_TYPE.quantitative
            ? "quantitative"
            : "",
      pseudo: sets.pseudo[s] === 1,
      leadVariant,
      leadPos: variants.pos[lead],
      leadConsequence:
        variants.consequence[lead] < 0 ? null : summary.consequences[variants.consequence[lead]],
      leadPip: index.leadPip[s],
      leadMlog10p: sets.leadMlog10p[s],
      leadBeta: sets.leadBeta[s],
      csSize: sets.size[s],
      nMembersLoaded: sets.memberCount[s],
      csMinR2: sets.minR2[s],
      nCoding: index.nCoding[s],
      codingPip: index.nCoding[s] > 0 ? index.codingPip[s] : null,
      codingOtherGene: codingGene === summary.gene ? null : codingGene,
      moreTraits: more?.get(s) ?? 0,
      selectedPip: selectedVariant == null ? null : memberPipOf(index, s, selectedVariant),
      leadSide: !region
        ? 0
        : variants.pos[lead] < region.start
          ? -1
          : variants.pos[lead] > region.end
            ? 1
            : 0,
    };
  });
};

/** The coding variants among a set's loaded members, strongest first. */
export const codingVariantsOfSet = (
  index: AssocIndex,
  set: number
): { variant: string; pip: number }[] => {
  const out: { variant: string; pip: number }[] = [];
  for (let m = index.memberStart[set]; m < index.memberStart[set + 1]; m++) {
    const v = index.memberVariant[m];
    if (index.summary.variants.variantClass[v] !== VARIANT_CLASS.other) {
      out.push({ variant: variantId(index, v), pip: index.memberPip[m] });
    }
  }
  return out.sort((a, b) => b.pip - a.pip);
};

export type SortValue = string | number | undefined;

export interface SortKey<T> {
  value: (row: T) => SortValue;
  desc: boolean;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Rows ordered by the keys in turn. A row without a value for a key comes after those with one
 * whichever way the key runs, and rows that tie on every key keep their order. Each key is read
 * once per row rather than once per comparison.
 */
export const sortRows = <T>(rows: T[], keys: SortKey<T>[]): T[] => {
  const decorated = rows.map((row, i) => ({ row, i, values: keys.map((k) => k.value(row)) }));
  decorated.sort((a, b) => {
    for (let k = 0; k < keys.length; k++) {
      const x = a.values[k];
      const y = b.values[k];
      if (x === y) {
        continue;
      }
      if (x === undefined || y === undefined) {
        return x === undefined ? 1 : -1;
      }
      const order =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : collator.compare(String(x), String(y));
      if (order !== 0) {
        return keys[k].desc ? -order : order;
      }
    }
    return a.i - b.i;
  });
  return decorated.map((d) => d.row);
};
