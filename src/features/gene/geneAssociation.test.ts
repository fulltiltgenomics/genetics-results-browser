import { describe, expect, it } from "vitest";
import { memberRow as row, summaryOf } from "@/test/geneAssociationSummary";
import {
  AssocFilters,
  buildAssocIndex,
  buildAssocRows,
  codingVariantsOfSet,
  collapseToTopTrait,
  computeAssocView,
  selectionRange,
  setsWithVariants,
  sortRows,
  variantsInRegion,
} from "./geneAssociation";
import { buildCredibleSetRows } from "./geneEvidenceExport";

const rows = [
  row({}),
  // served twice by the API
  row({}),
  row({ pos: 44907000, ref: "G", alt: "A", pip: 0.1, most_severe: "intron_variant" }),
  // a second, weaker coding variant in the same set
  row({ pos: 44908822, ref: "C", alt: "T", pip: 0.05, most_severe: "stop_gained" }),
  // an intronic set, and one whose coding variant is a neighbouring gene's
  row({
    cs_id: "intronic",
    pos: 44907000,
    ref: "G",
    alt: "A",
    pip: 0.6,
    most_severe: "intron_variant",
  }),
  row({ cs_id: "neighbour", pos: 44900000, pip: 0.7, gene_most_severe: "TOMM40" }),
  row({ cs_id: "qtl", data_type: "eQTL" }),
  // pseudo per the datasets fixture, quantitative per its metadata, and reaching beyond the region
  row({
    resource: "finngen_mvp_ukbb_aou",
    dataset: "FinnGen_R14_MVP_UKBB_AOU",
    trait: "LDL_Q",
    trait_original: "LDL_Q",
    cs_id: "meta",
    cs_size: 40,
    cs_min_r2: null,
    pip: 0.3,
    mlog10p: null,
  }),
];

const built = summaryOf(rows, {
  traitMeta: {
    finngen_mvp_ukbb_aou: { LDL_Q: { name: "LDL cholesterol", traitType: "quantitative" } },
  },
});
const index = buildAssocIndex(built.summary);

const all: AssocFilters = {
  traitType: "all",
  credibleSetKind: "all",
  mode: "any",
  search: "",
};

const viewOf = (filters: Partial<AssocFilters>, of = index) =>
  computeAssocView(of, { ...all, ...filters });
const listed = (filters: Partial<AssocFilters>, of = index) =>
  buildAssocRows(of, viewOf(filters, of).sets);
const ids = (filters: Partial<AssocFilters>) =>
  listed(filters).map((r) => built.setIds.csId[r.set]);
const idsOf = (sets: Int32Array, of = built) => Array.from(sets, (s) => of.setIds.csId[s]);

describe("buildAssocIndex", () => {
  it("lays the sets' members end to end and counts each set's coding variants, of any gene", () => {
    expect(index.nSets).toBe(4);
    expect(Array.from(index.variantPos)).toEqual([44900000, 44907000, 44908684, 44908822]);
    expect(Array.from(index.memberStart)).toEqual([0, 3, 4, 5, 6]);
    expect(Array.from(index.leadPip)).toEqual([0.9, 0.6, 0.7, 0.3]);
    // the neighbour's missense counts for the set it is in, but is not the viewed gene's
    expect(Array.from(index.nCoding)).toEqual([2, 0, 1, 1]);
    expect(Array.from(index.codingPip)).toEqual([0.9, 0, 0.7, 0.3]);
    expect(Array.from(index.variantCodingInGene)).toEqual([0, 0, 1, 1]);
    expect(Array.from(index.variantNSets)).toEqual([1, 2, 2, 1]);
    expect(Array.from(index.variantMaxPip)).toEqual([0.7, 0.6, 0.9, 0.05]);
  });
});

describe("computeAssocView", () => {
  it("passes every set by default, and otherwise those with a strong enough variant of the kind asked for", () => {
    expect(ids({})).toEqual(["chr19_44908684_T_C", "intronic", "neighbour", "meta"]);
    expect(ids({ mode: "coding" })).toEqual(["chr19_44908684_T_C", "neighbour", "meta"]);
    // the only LoF variant has a PIP of exactly the threshold, which does not count
    expect(ids({ mode: "lof" })).toEqual([]);
  });

  it("describes a row by its lead variant and counts its coding variants", () => {
    const [first, , neighbour, meta] = listed({});
    expect(first).toMatchObject({
      resource: "finngen",
      dataset: "FinnGen_R14",
      traitCode: "G6_ALZHEIMER",
      traitName: "Alzheimer disease",
      traitType: "binary",
      pseudo: false,
      leadVariant: "19:44908684:T:C",
      leadConsequence: "missense_variant",
      leadPip: 0.9,
      leadMlog10p: 300,
      leadBeta: 1.2,
      csSize: 2,
      // three distinct members were served for a set that says it has two
      nMembersLoaded: 3,
      nCoding: 2,
      codingPip: 0.9,
      codingOtherGene: null,
      moreTraits: 0,
      selectedPip: null,
      leadSide: 0,
    });
    expect(neighbour).toMatchObject({ codingPip: 0.7, codingOtherGene: "TOMM40" });
    expect(meta).toMatchObject({
      traitName: "LDL cholesterol",
      traitType: "quantitative",
      pseudo: true,
      leadMlog10p: null,
      csSize: 40,
      nMembersLoaded: 1,
      csMinR2: null,
    });
    expect(listed({})[1]).toMatchObject({ nCoding: 0, codingPip: null });
  });

  it("gives rows keys that do not depend on the order the sets came in", () => {
    const reversed = buildAssocIndex(summaryOf([...rows].reverse()).summary);
    expect(
      listed({}, reversed)
        .map((r) => r.key)
        .sort()
    ).toEqual(
      listed({})
        .map((r) => r.key)
        .sort()
    );
    expect(new Set(listed({}).map((r) => r.key)).size).toBe(4);
  });

  it("filters by trait type, credible set kind and search", () => {
    expect(ids({ traitType: "binary" })).toEqual(["chr19_44908684_T_C", "intronic", "neighbour"]);
    expect(ids({ traitType: "quantitative" })).toEqual(["meta"]);
    expect(ids({ credibleSetKind: "pseudo" })).toEqual(["meta"]);
    expect(ids({ credibleSetKind: "susie" })).toHaveLength(3);
    expect(ids({ search: " ldl CHOL " })).toEqual(["meta"]);
    // the dataset's display name and the trait code both match
    expect(ids({ search: "finngen+mvp" })).toEqual(["meta"]);
    expect(ids({ search: "g6_alz" })).toHaveLength(3);
    // every word has to match, in the trait or in the dataset, in any order
    expect(ids({ search: "cholesterol mvp" })).toEqual(["meta"]);
    expect(ids({ search: "ldl g6_alz" })).toEqual([]);
  });

  it("passes a set of unknown trait type only when the type is not filtered", () => {
    const unknown = buildAssocIndex(
      summaryOf([row({ resource: "finngen_mvp_ukbb_aou", trait_original: "X" })]).summary
    );
    expect(listed({}, unknown)).toHaveLength(1);
    expect(listed({ traitType: "binary" }, unknown)).toHaveLength(0);
    expect(listed({ traitType: "quantitative" }, unknown)).toHaveLength(0);
  });

  it("takes nothing off the track: it says which variants to fade and what the filters leave of each", () => {
    const everything = viewOf({});
    expect(Array.from(everything.variantPasses)).toEqual([1, 1, 1, 1]);
    expect(Array.from(everything.variantPassingSets)).toEqual(Array.from(index.variantNSets));
    expect(Array.from(everything.variantPassingPip)).toEqual(Array.from(index.variantMaxPip));

    // the intronic variant stays for the passing set it is in, where its PIP is 0.1: its own
    // set no longer passes
    const coding = viewOf({ mode: "coding" });
    expect(Array.from(coding.variantPasses)).toEqual([1, 1, 1, 1]);
    expect(Array.from(coding.variantPassingSets)).toEqual([1, 1, 2, 1]);
    expect(Array.from(coding.variantPassingPip)).toEqual([0.7, 0.1, 0.9, 0.05]);

    // a selection fades what shares no set with it: the neighbour's variant here, while the
    // intronic one stays for the set it shares with the selected stop-gained variant
    const selected = viewOf({ selected: [3, 4] });
    expect(Array.from(selected.variantPasses)).toEqual([0, 1, 1, 1]);
    expect(Array.from(selected.variantPassingSets)).toEqual([1, 2, 2, 1]);
    expect(selected.sets).toHaveLength(4);

    const searched = viewOf({ search: "ldl" });
    expect(Array.from(searched.variantPasses)).toEqual([0, 0, 1, 0]);
    expect(Array.from(searched.variantPassingSets)).toEqual([0, 0, 1, 0]);
    expect(Array.from(searched.variantPassingPip)).toEqual([0, 0, 0.3, 0]);
  });
});

describe("the table's scope", () => {
  const every = viewOf({}).sets;
  const there = (start: number, end: number) =>
    idsOf(setsWithVariants(index, every, variantsInRegion(index.variantPos, { start, end })));

  it("keeps the sets with a variant inside a region, ends included", () => {
    expect(there(44900000, 44900000)).toEqual(["neighbour"]);
    expect(there(44907000, 44908684)).toEqual(["chr19_44908684_T_C", "intronic", "meta"]);
    expect(there(44908685, 44908821)).toEqual([]);
    expect(there(1, 50000000)).toHaveLength(4);
  });

  it("keeps the sets of one selected variant, and of none for a variant it does not hold", () => {
    const variant = selectionRange(index, {
      kind: "variant",
      id: "19:44908684:T:C",
      pos: 44908684,
    });
    expect(variant).toEqual([2, 3]);
    expect(idsOf(setsWithVariants(index, every, variant))).toEqual(["chr19_44908684_T_C", "meta"]);
    const absent = selectionRange(index, { kind: "variant", id: "19:44908684:T:G", pos: 44908684 });
    expect(idsOf(setsWithVariants(index, every, absent))).toEqual([]);
  });

  it("finds the variants inside a region, ends included", () => {
    const positions = [10, 20, 20, 30, 40];
    expect(variantsInRegion(positions, { start: 20, end: 30 })).toEqual([1, 4]);
    expect(variantsInRegion(positions, { start: 21, end: 29 })).toEqual([3, 3]);
    expect(variantsInRegion(positions, { start: 0, end: 100 })).toEqual([0, 5]);
  });

  it("tells a row whose lead lies outside the track's view", () => {
    const side = (start: number, end: number) =>
      buildAssocRows(index, every, { region: { start, end } }).map((r) => r.leadSide);
    expect(side(44905000, 44908000)).toEqual([1, 0, -1, 1]);
    // a table about one variant tells that variant's PIP in each set as well
    const about = buildAssocRows(index, every, {
      selectedVariant: 1,
      region: { start: 44905000, end: 44908000 },
    });
    expect(about.map((r) => r.selectedPip)).toEqual([0.1, 0.6, -1, -1]);
    expect(about.map((r) => r.leadSide)).toEqual([1, 0, -1, 1]);
  });
});

describe("collapseToTopTrait", () => {
  const shared = summaryOf([
    row({ trait: "Dementia", trait_original: "F5_DEMENTIA", cs_id: "a", pip: 0.4 }),
    row({ cs_id: "b", pip: 0.9, cs_size: 3 }),
    // same PIP as the strongest, weaker p-value
    row({ trait: "Memory_loss", trait_original: "MEM", cs_id: "c", pip: 0.9, mlog10p: 20 }),
    row({ resource: "open_targets", dataset: "Open_Targets", cs_id: "d", pip: 0.3 }),
    // led by its own variant, and holding the others' lead at a PIP above theirs
    row({
      cs_id: "e",
      pos: 44907000,
      ref: "G",
      alt: "A",
      pip: 0.95,
      most_severe: "intron_variant",
    }),
    row({ cs_id: "e", pip: 0.92 }),
  ]);
  const sharedIndex = buildAssocIndex(shared.summary);
  const every = computeAssocView(sharedIndex, all).sets;

  it("keeps the set each lead variant is strongest in, per dataset, and counts the rest", () => {
    const { sets, more } = collapseToTopTrait(sharedIndex, every, null);
    expect(idsOf(sets, shared)).toEqual(["b", "d", "e"]);
    expect(Array.from(sets, (s) => more.get(s))).toEqual([2, 0, 0]);
    const rows = buildAssocRows(sharedIndex, sets, { more });
    expect(rows.map((r) => r.moreTraits)).toEqual([2, 0, 0]);
  });

  it("picks by the selected variant's own PIP when the table is about one variant", () => {
    // the missense variant: e holds it at 0.92, above b's 0.9, though it does not lead e
    const { sets, more } = collapseToTopTrait(sharedIndex, every, 1);
    expect(idsOf(sets, shared)).toEqual(["d", "e"]);
    expect(Array.from(sets, (s) => more.get(s))).toEqual([0, 3]);
  });

  it("picks among the sets it is given", () => {
    const some = every.filter((s) => shared.setIds.csId[s] !== "b");
    expect(idsOf(collapseToTopTrait(sharedIndex, some, null).sets, shared)).toEqual([
      "c",
      "d",
      "e",
    ]);
  });
});

describe("codingVariantsOfSet", () => {
  it("lists a set's coding variants, strongest first", () => {
    expect(codingVariantsOfSet(index, 0)).toEqual([
      { variant: "19:44908684:T:C", pip: 0.9 },
      { variant: "19:44908822:C:T", pip: 0.05 },
    ]);
    expect(codingVariantsOfSet(index, 1)).toEqual([]);
    expect(codingVariantsOfSet(index, 2)).toEqual([{ variant: "19:44900000:T:C", pip: 0.7 }]);
  });
});

describe("sortRows", () => {
  const data = [
    { name: "b", pip: 0.5, coding: undefined },
    { name: "a", pip: 0.9, coding: 0.2 },
    { name: "c", pip: 0.7, coding: undefined },
    { name: "d", pip: 0.1, coding: 0.8 },
  ];
  const by = (key: "name" | "pip" | "coding", desc: boolean) => ({
    value: (r: (typeof data)[number]) => r[key],
    desc,
  });
  const names = (sorted: typeof data) => sorted.map((r) => r.name).join("");

  it("sorts by the keys in turn", () => {
    expect(names(sortRows(data, [by("pip", true)]))).toBe("acbd");
    expect(names(sortRows(data, [by("name", false)]))).toBe("abcd");
  });

  it("puts rows without a value last in either direction, ordered by the next key", () => {
    expect(names(sortRows(data, [by("coding", true), by("pip", true)]))).toBe("dacb");
    expect(names(sortRows(data, [by("coding", false), by("pip", true)]))).toBe("adcb");
  });

  it("keeps the given order between ties and leaves its input alone", () => {
    const tied = [
      { name: "x", pip: 1, coding: undefined },
      { name: "y", pip: 1, coding: undefined },
    ];
    expect(names(sortRows(tied, [by("pip", true)]))).toBe("xy");
    expect(names(data)).toBe("bacd");
  });

  it("orders text the way a reader would, digits by value", () => {
    const text = ["chr10", "chr9", "Chr1"].map((name) => ({ name, pip: 0, coding: undefined }));
    expect(sortRows(text, [by("name", false)]).map((r) => r.name)).toEqual([
      "Chr1",
      "chr9",
      "chr10",
    ]);
  });
});

describe("buildCredibleSetRows", () => {
  it("exports one row per credible set with its lead and every coding variant", () => {
    const exported = buildCredibleSetRows("APOE", listed({}), index, built.setIds.csId);
    expect(exported[0]).toMatchObject({
      gene: "APOE",
      trait: "Alzheimer disease",
      trait_original: "G6_ALZHEIMER",
      trait_type: "binary",
      dataset: "FinnGen R14",
      credible_set_type: "SuSiE",
      cs_id: "chr19_44908684_T_C",
      cs_size: 2,
      cs_min_r2: 0.8,
      lead_variant: "19:44908684:T:C",
      consequence: "missense",
      pip: 0.9,
      mlog10p: 300,
      beta: 1.2,
      n_coding_variants: 2,
      coding_variants: "19:44908684:T:C(0.9),19:44908822:C:T(0.05)",
    });
    expect(exported[1]).toMatchObject({
      cs_id: "intronic",
      n_coding_variants: 0,
      coding_variants: "NA",
    });
    expect(exported[3]).toMatchObject({ cs_min_r2: "NA", mlog10p: "NA", "p-value": "NA" });
  });
});
