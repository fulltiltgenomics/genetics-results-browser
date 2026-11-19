import type { AssocTraitMode, BurdenTraitType, CredibleSetKind } from "@/store/store.geneEvidence";
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
  // set i's members are entries memberStart[i] .. memberStart[i + 1] of the member arrays
  memberStart: Int32Array;
  memberVariant: Int32Array;
  memberPip: Float64Array;
  variantPos: Int32Array;
  // a coding variant annotated to the viewed gene: the only kind that makes a set "coding"
  variantCodingInGene: Uint8Array;
  leadPip: Float64Array;
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
  const geneIndex = summary.genes.indexOf(summary.gene);
  const variantCodingInGene = Uint8Array.from(summary.variants.variantClass, (c, i) =>
    c !== VARIANT_CLASS.other && summary.variants.gene[i] === geneIndex ? 1 : 0
  );
  const leadPip = new Float64Array(nSets);
  for (let i = 0; i < nSets; i++) {
    for (let m = memberStart[i]; m < memberStart[i + 1]; m++) {
      if (memberVariant[m] === summary.sets.lead[i]) {
        leadPip[i] = memberPip[m];
        break;
      }
    }
  }
  const traitName = summary.traits.name.map(formatTraitName);
  return {
    summary,
    nSets,
    nVariants,
    memberStart,
    memberVariant,
    memberPip,
    variantPos: Int32Array.from(summary.variants.pos),
    variantCodingInGene,
    leadPip,
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

export interface AssocFilters {
  traitType: BurdenTraitType;
  credibleSetKind: CredibleSetKind;
  // a set is listed for a member at or above this PIP: any member, a coding variant of the gene
  // with `codingOnly`, and in either case one inside `selection` when there is one
  minPip: number;
  traitMode: AssocTraitMode;
  search: string;
  codingOnly: boolean;
  selection: Region | null;
}

export interface AssocView {
  // the sets the table lists, in summary order
  rows: Int32Array;
  // per set: the gene's coding variants at or above the PIP threshold, and the highest PIP among
  // them (0 for none)
  nCoding: Uint16Array;
  codingPip: Float64Array;
  // per variant, over the sets that pass the trait type, credible-set kind and search filters:
  // the highest PIP it has in any of them and how many hold it. a variant in none has nSets 0
  variantMaxPip: Float64Array;
  variantNSets: Uint32Array;
  // 1 for a member of a listed set
  variantInTable: Uint8Array;
  // what the table would list with the coding filter off, and with the selection cleared
  rowsWithoutCodingOnly: number;
  rowsWithoutSelection: number;
}

// first index whose position is >= pos
const lowerBound = (positions: Int32Array, pos: number): number => {
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

const matchesKind = (kind: CredibleSetKind, pseudo: 0 | 1): boolean =>
  kind === "all" || (kind === "pseudo") === (pseudo === 1);

const matchesType = (traitType: BurdenTraitType, code: number): boolean =>
  traitType === "all" ||
  code === (traitType === "binary" ? TRAIT_TYPE.binary : TRAIT_TYPE.quantitative);

/**
 * Everything the tab shows for one setting of the filters.
 *
 * The trait type, credible-set kind and search filters say which sets exist at all: the track
 * draws their variants. The PIP threshold, the coding filter and the selection then say which of
 * those the table lists, by asking each set for a qualifying member. The top-trait pick runs last,
 * among what the others keep: per dataset and key variant it keeps the set the variant is strongest
 * in, where a set's key variants are its qualifying coding variants with `codingOnly` and its lead
 * variant otherwise. A set whose trait type is unknown passes only the unfiltered setting.
 */
export const computeAssocView = (index: AssocIndex, filters: AssocFilters): AssocView => {
  const { summary, nSets, nVariants, memberStart, memberVariant, memberPip } = index;
  const { sets, traits } = summary;
  const needle = filters.search.trim().toLowerCase();
  const traitMatches =
    needle === "" ? null : index.traitSearchText.map((text) => text.includes(needle));
  const datasetMatches =
    needle === "" ? null : index.datasetSearchText.map((text) => text.includes(needle));
  // the variants inside the selection are a contiguous run of the position-sorted variants
  const selFrom = filters.selection ? lowerBound(index.variantPos, filters.selection.start) : 0;
  const selTo = filters.selection
    ? lowerBound(index.variantPos, filters.selection.end + 1)
    : nVariants;

  const nCoding = new Uint16Array(nSets);
  const codingPip = new Float64Array(nSets);
  const variantMaxPip = new Float64Array(nVariants);
  const variantNSets = new Uint32Array(nVariants);
  const variantInTable = new Uint8Array(nVariants);
  const kept: number[] = [];
  let rowsWithoutCodingOnly = 0;
  let rowsWithoutSelection = 0;

  for (let s = 0; s < nSets; s++) {
    let anyQualifies = false;
    let codingQualifies = false;
    let anyQualifiesAnywhere = false;
    let codingQualifiesAnywhere = false;
    for (let m = memberStart[s]; m < memberStart[s + 1]; m++) {
      const v = memberVariant[m];
      const pip = memberPip[m];
      if (pip < filters.minPip) {
        continue;
      }
      const coding = index.variantCodingInGene[v] === 1;
      const selected = v >= selFrom && v < selTo;
      if (coding) {
        nCoding[s]++;
        if (pip > codingPip[s]) {
          codingPip[s] = pip;
        }
        codingQualifiesAnywhere = true;
        codingQualifies ||= selected;
      }
      anyQualifiesAnywhere = true;
      anyQualifies ||= selected;
    }

    const trait = sets.trait[s];
    const exists =
      matchesType(filters.traitType, traits.type[trait]) &&
      matchesKind(filters.credibleSetKind, sets.pseudo[s]) &&
      (traitMatches === null || traitMatches[trait] || datasetMatches![sets.dataset[s]]);
    if (!exists) {
      continue;
    }
    for (let m = memberStart[s]; m < memberStart[s + 1]; m++) {
      const v = memberVariant[m];
      variantNSets[v]++;
      if (memberPip[m] > variantMaxPip[v]) {
        variantMaxPip[v] = memberPip[m];
      }
    }
    if (anyQualifies) {
      rowsWithoutCodingOnly++;
    }
    if (filters.codingOnly ? codingQualifiesAnywhere : anyQualifiesAnywhere) {
      rowsWithoutSelection++;
    }
    if (filters.codingOnly ? codingQualifies : anyQualifies) {
      kept.push(s);
    }
  }

  const listed = filters.traitMode === "top" ? topTraitSets(index, filters, kept) : kept;
  const rows = Int32Array.from(listed);
  for (const s of rows) {
    for (let m = memberStart[s]; m < memberStart[s + 1]; m++) {
      variantInTable[memberVariant[m]] = 1;
    }
  }
  return {
    rows,
    nCoding,
    codingPip,
    variantMaxPip,
    variantNSets,
    variantInTable,
    rowsWithoutCodingOnly,
    rowsWithoutSelection,
  };
};

// of `kept`, the sets that are the strongest of their dataset for one of their key variants: by
// the variant's PIP in the set, then by the lead's p-value, which many Open Targets sets lack
const topTraitSets = (index: AssocIndex, filters: AssocFilters, kept: number[]): number[] => {
  const { summary, memberStart, memberVariant, memberPip, nVariants } = index;
  const best = new Map<number, { set: number; pip: number }>();
  const offer = (s: number, v: number, pip: number) => {
    const key = summary.sets.dataset[s] * nVariants + v;
    const top = best.get(key);
    if (
      !top ||
      pip > top.pip ||
      (pip === top.pip &&
        (summary.sets.leadMlog10p[s] ?? -Infinity) >
          (summary.sets.leadMlog10p[top.set] ?? -Infinity))
    ) {
      best.set(key, { set: s, pip });
    }
  };
  for (const s of kept) {
    if (!filters.codingOnly) {
      offer(s, summary.sets.lead[s], index.leadPip[s]);
      continue;
    }
    for (let m = memberStart[s]; m < memberStart[s + 1]; m++) {
      if (index.variantCodingInGene[memberVariant[m]] === 1 && memberPip[m] >= filters.minPip) {
        offer(s, memberVariant[m], memberPip[m]);
      }
    }
  }
  const winners = new Set<number>();
  for (const top of best.values()) {
    winners.add(top.set);
  }
  return kept.filter((s) => winners.has(s));
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
  // lead is then the strongest of those
  nMembersLoaded: number;
  csMinR2: number | null;
  nCoding: number;
  codingPip: number | null;
}

export const buildAssocRows = (index: AssocIndex, view: AssocView): AssocRow[] => {
  const { summary } = index;
  const { sets, traits, variants } = summary;
  const seen = new Map<string, number>();
  return Array.from(view.rows, (s) => {
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
      nCoding: view.nCoding[s],
      codingPip: view.nCoding[s] > 0 ? view.codingPip[s] : null,
    };
  });
};

/** The gene's coding variants in a set at or above the PIP threshold, strongest first. */
export const codingVariantsOfSet = (
  index: AssocIndex,
  set: number,
  minPip: number
): { variant: string; pip: number }[] => {
  const out: { variant: string; pip: number }[] = [];
  for (let m = index.memberStart[set]; m < index.memberStart[set + 1]; m++) {
    const v = index.memberVariant[m];
    if (index.variantCodingInGene[v] === 1 && index.memberPip[m] >= minPip) {
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
