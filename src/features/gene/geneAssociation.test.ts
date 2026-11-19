import { describe, expect, it } from "vitest";
import { memberRow as row, summaryOf } from "@/test/geneAssociationSummary";
import {
  AssocFilters,
  buildAssocIndex,
  buildAssocRows,
  codingVariantsOfSet,
  computeAssocView,
  sortRows,
} from "./geneAssociation";
import { buildCredibleSetRows } from "./geneEvidenceExport";

const rows = [
  row({}),
  // served twice by the API
  row({}),
  row({ pos: 44907000, ref: "G", alt: "A", pip: 0.1, most_severe: "intron_variant" }),
  // a second, weaker coding variant in the same set
  row({ pos: 44908822, ref: "C", alt: "T", pip: 0.05, most_severe: "stop_gained" }),
  // no coding variant of the gene: an intronic set and a neighbour's missense
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
  minPip: 0,
  traitMode: "all",
  search: "",
  codingOnly: false,
  selection: null,
};

const listed = (filters: Partial<AssocFilters>, of = index) => {
  const view = computeAssocView(of, { ...all, ...filters });
  return buildAssocRows(of, view);
};
const ids = (filters: Partial<AssocFilters>) =>
  listed(filters).map((r) => built.setIds.csId[r.set]);

describe("buildAssocIndex", () => {
  it("lays the sets' members end to end and marks the gene's coding variants", () => {
    expect(index.nSets).toBe(4);
    expect(Array.from(index.variantPos)).toEqual([44900000, 44907000, 44908684, 44908822]);
    expect(Array.from(index.memberStart)).toEqual([0, 3, 4, 5, 6]);
    // the neighbour's missense at 44900000 is coding, but not of this gene
    expect(Array.from(index.variantCodingInGene)).toEqual([0, 0, 1, 1]);
    expect(Array.from(index.leadPip)).toEqual([0.9, 0.6, 0.7, 0.3]);
  });

  it("keeps PIPs exact, so a threshold equal to one keeps it", () => {
    const sevenTenths = buildAssocIndex(summaryOf([row({ pip: 0.7 })]).summary);
    expect(listed({ minPip: 0.7 }, sevenTenths)).toHaveLength(1);
  });
});

describe("computeAssocView", () => {
  it("lists every set by default, and with the coding filter only those with a coding variant of the gene", () => {
    expect(ids({})).toEqual(["chr19_44908684_T_C", "intronic", "neighbour", "meta"]);
    expect(ids({ codingOnly: true })).toEqual(["chr19_44908684_T_C", "meta"]);
  });

  it("describes a row by its lead variant and counts its coding variants", () => {
    const [first, , , meta] = listed({});
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
    });
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
  });

  it("passes a set of unknown trait type only when the type is not filtered", () => {
    const unknown = buildAssocIndex(
      summaryOf([row({ resource: "finngen_mvp_ukbb_aou", trait_original: "X" })]).summary
    );
    expect(listed({}, unknown)).toHaveLength(1);
    expect(listed({ traitType: "binary" }, unknown)).toHaveLength(0);
    expect(listed({ traitType: "quantitative" }, unknown)).toHaveLength(0);
  });

  it("applies the PIP threshold to any member, or with the coding filter to the coding ones", () => {
    expect(ids({ minPip: 0.65 })).toEqual(["chr19_44908684_T_C", "neighbour"]);
    expect(ids({ minPip: 0.31, codingOnly: true })).toEqual(["chr19_44908684_T_C"]);
    expect(listed({ minPip: 0.05 })[0]).toMatchObject({ nCoding: 2, codingPip: 0.9 });
    expect(listed({ minPip: 0.06 })[0]).toMatchObject({ nCoding: 1 });
    expect(ids({ minPip: 0.95 })).toEqual([]);
  });

  it("narrows to the sets with a qualifying member inside the selection", () => {
    expect(ids({ selection: { start: 44906990, end: 44907010 } })).toEqual([
      "chr19_44908684_T_C",
      "intronic",
    ]);
    // both ends are part of the selection
    expect(ids({ selection: { start: 44908822, end: 44908822 } })).toEqual(["chr19_44908684_T_C"]);
    expect(ids({ selection: { start: 44908685, end: 44908821 } })).toEqual([]);
    // the member inside the selection has to be the one that clears the threshold
    expect(ids({ selection: { start: 44906990, end: 44907010 }, minPip: 0.5 })).toEqual([
      "intronic",
    ]);
    // and with the coding filter, a coding variant of the gene
    expect(ids({ selection: { start: 44906990, end: 44907010 }, codingOnly: true })).toEqual([]);
  });

  it("says what the coding filter and the selection are each holding back", () => {
    const view = computeAssocView(index, {
      ...all,
      codingOnly: true,
      selection: { start: 44906990, end: 44907010 },
    });
    expect(view.rows).toHaveLength(0);
    expect(view.rowsWithoutCodingOnly).toBe(2);
    expect(view.rowsWithoutSelection).toBe(2);
  });

  it("gives the track every variant of the sets that exist, and marks those the table lists", () => {
    const everything = computeAssocView(index, all);
    expect(Array.from(everything.variantNSets)).toEqual([1, 2, 2, 1]);
    expect(Array.from(everything.variantMaxPip)).toEqual([0.7, 0.6, 0.9, 0.05]);
    expect(Array.from(everything.variantInTable)).toEqual([1, 1, 1, 1]);

    // the coding filter and the selection choose rows; they take nothing off the track
    const coding = computeAssocView(index, { ...all, codingOnly: true });
    expect(Array.from(coding.variantNSets)).toEqual([1, 2, 2, 1]);
    expect(Array.from(coding.variantInTable)).toEqual([0, 1, 1, 1]);

    // the search says which sets exist at all
    const searched = computeAssocView(index, { ...all, search: "ldl" });
    expect(Array.from(searched.variantNSets)).toEqual([0, 0, 1, 0]);
    expect(Array.from(searched.variantMaxPip)).toEqual([0, 0, 0.3, 0]);
  });

  describe("several traits of one dataset sharing a variant", () => {
    const shared = summaryOf([
      row({ trait: "Dementia", trait_original: "F5_DEMENTIA", cs_id: "a", pip: 0.4 }),
      row({ cs_id: "b", pip: 0.9, cs_size: 3 }),
      // same PIP as the strongest, weaker p-value
      row({ trait: "Memory_loss", trait_original: "MEM", cs_id: "c", pip: 0.9, mlog10p: 20 }),
      row({ resource: "open_targets", dataset: "Open_Targets", cs_id: "d", pip: 0.3 }),
      // strongest for its own lead, which no other set of the dataset leads with
      row({
        cs_id: "e",
        pos: 44907000,
        ref: "G",
        alt: "A",
        pip: 0.2,
        most_severe: "intron_variant",
      }),
    ]);
    const sharedIndex = buildAssocIndex(shared.summary);
    const top = (filters: Partial<AssocFilters>) =>
      listed({ traitMode: "top", ...filters }, sharedIndex).map((r) => shared.setIds.csId[r.set]);

    it("keeps the set each coding variant is strongest in, per dataset, with the coding filter", () => {
      expect(top({ codingOnly: true })).toEqual(["b", "d"]);
    });

    it("keeps the set each lead variant is strongest in, per dataset, without it", () => {
      expect(top({})).toEqual(["b", "d", "e"]);
    });

    it("picks among what the other filters keep", () => {
      expect(top({ search: "dementia" })).toEqual(["a"]);
    });
  });
});

describe("codingVariantsOfSet", () => {
  it("lists the gene's coding variants at or above the threshold, strongest first", () => {
    expect(codingVariantsOfSet(index, 0, 0)).toEqual([
      { variant: "19:44908684:T:C", pip: 0.9 },
      { variant: "19:44908822:C:T", pip: 0.05 },
    ]);
    expect(codingVariantsOfSet(index, 0, 0.06)).toHaveLength(1);
    expect(codingVariantsOfSet(index, 2, 0)).toEqual([]);
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
    const exported = buildCredibleSetRows("APOE", listed({}), index, built.setIds.csId, 0);
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
