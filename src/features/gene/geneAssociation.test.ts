import { describe, expect, it } from "vitest";
import type { GeneCSApiRow } from "@/store/geneCS";
import {
  annotateCredibleSets,
  filterCredibleSetRows,
  groupCodingCredibleSets,
  pseudoCredibleSetLookup,
  summarizeCodingVariants,
} from "./geneAssociation";
import { buildCodingCredibleSetRows } from "./geneEvidenceExport";

const row = (over: Partial<GeneCSApiRow>): GeneCSApiRow => ({
  resource: "finngen",
  version: "R14",
  dataset: "FinnGen_R14",
  data_type: "GWAS",
  trait: "Alzheimer_disease",
  trait_original: "G6_ALZHEIMER",
  cell_type: null,
  chr: 19,
  pos: 44908684,
  ref: "T",
  alt: "C",
  mlog10p: 300,
  beta: 1.2,
  se: 0.02,
  pip: 0.9,
  cs_id: "chr19_44908684_T_C",
  cs_size: 2,
  cs_min_r2: 0.8,
  aaf: 0.18,
  most_severe: "missense_variant",
  gene_most_severe: "APOE",
  ...over,
});

const rows: GeneCSApiRow[] = [
  row({}),
  // served twice by the API
  row({}),
  row({ pos: 44907000, ref: "G", alt: "A", pip: 0.1, most_severe: "intron_variant" }),
  // a second, weaker coding variant in the same set
  row({ pos: 44908822, ref: "C", alt: "T", pip: 0.05, most_severe: "stop_gained" }),
  // no coding variant of the gene: an intronic set, a neighbour's missense, a QTL
  row({ cs_id: "intronic", most_severe: "intron_variant" }),
  row({ cs_id: "neighbour", gene_most_severe: "TOMM40" }),
  row({ cs_id: "qtl", data_type: "eQTL" }),
  row({
    resource: "finngen_mvp_ukbb_aou",
    dataset: "FinnGen_R14_MVP_UKBB_AOU",
    trait: "LDL_Q",
    trait_original: "LDL_Q",
    cs_id: "meta",
    cs_size: 40,
    cs_min_r2: null,
  }),
];

describe("groupCodingCredibleSets", () => {
  const sets = groupCodingCredibleSets(rows, "APOE");

  it("keeps one row per GWAS credible set with a coding variant of the gene", () => {
    expect(sets.map((s) => s.csId)).toEqual(["chr19_44908684_T_C", "meta"]);
  });

  it("collects a set's members once each, in genomic order, classed for the viewed gene", () => {
    expect(sets[0].variants.map((v) => [v.pos, v.variantClass])).toEqual([
      [44907000, "other"],
      [44908684, "coding"],
      [44908822, "lof"],
    ]);
    expect(sets[0].csSize).toBe(2);
  });

  it("colours a neighbouring gene's coding variant but does not let it qualify a set", () => {
    const withNeighbour = groupCodingCredibleSets(
      [...rows, row({ pos: 44900000, ref: "A", alt: "G", gene_most_severe: "TOMM40" })],
      "APOE"
    );
    const neighbour = withNeighbour[0].variants[0];
    expect([neighbour.pos, neighbour.variantClass, neighbour.inGene]).toEqual([
      44900000,
      "coding",
      false,
    ]);
    expect(withNeighbour[0].codingVariants).toHaveLength(2);
  });

  it("orders the coding variants by PIP, so the first is the one the table reports", () => {
    expect(sets[0].codingVariants.map((v) => v.variant)).toEqual([
      "19:44908684:T:C",
      "19:44908822:C:T",
    ]);
  });
});

describe("pseudoCredibleSetLookup", () => {
  it("decides by dataset label, falling back to an unlabelled row of the resource", () => {
    const isPseudo = pseudoCredibleSetLookup([
      { resource: "pgc", dataset: "PGC", hasPseudoCredibleSets: true },
      { resource: "pgc", dataset: "PGC_SCZ_2022", hasPseudoCredibleSets: false },
      { resource: "finngen_mvp_ukbb_aou", hasPseudoCredibleSets: true },
    ]);
    expect(isPseudo("pgc", "PGC")).toBe(true);
    expect(isPseudo("pgc", "PGC_SCZ_2022")).toBe(false);
    expect(isPseudo("finngen_mvp_ukbb_aou", "FinnGen_R14_MVP_UKBB_AOU")).toBe(true);
    expect(isPseudo("finngen", "FinnGen_R14")).toBe(false);
    expect(pseudoCredibleSetLookup(undefined)("pgc", "PGC")).toBe(false);
  });
});

describe("annotated rows", () => {
  const metadata = {
    finngen: { G6_ALZHEIMER: { name: "Alzheimer's disease", traitType: "binary" } },
    finngen_mvp_ukbb_aou: { LDL_Q: { name: "LDL cholesterol", traitType: "quantitative" } },
  };
  const isPseudo = pseudoCredibleSetLookup([
    { resource: "finngen_mvp_ukbb_aou", hasPseudoCredibleSets: true },
  ]);
  const annotated = annotateCredibleSets(groupCodingCredibleSets(rows, "APOE"), metadata, isPseudo);
  const all = {
    traitType: "all",
    credibleSetKind: "all",
    minCodingPip: 0,
    traitMode: "all",
    search: "",
  } as const;
  const traits = (f: Parameters<typeof filterCredibleSetRows>[1]) =>
    filterCredibleSetRows(annotated, f).map((r) => r.traitName);

  it("names an unresolved phenocode from the metadata and spaces out a resolved name", () => {
    expect(annotated.map((r) => r.traitName)).toEqual(["Alzheimer disease", "LDL cholesterol"]);
  });

  it("filters by trait type, credible set kind and dataset or trait name", () => {
    expect(traits({ ...all, traitType: "binary" })).toEqual(["Alzheimer disease"]);
    expect(traits({ ...all, traitType: "quantitative" })).toEqual(["LDL cholesterol"]);
    expect(traits({ ...all, credibleSetKind: "susie" })).toEqual(["Alzheimer disease"]);
    expect(traits({ ...all, credibleSetKind: "pseudo" })).toEqual(["LDL cholesterol"]);
    expect(traits({ ...all, search: "finngen+mvp" })).toEqual(["LDL cholesterol"]);
    expect(traits({ ...all, search: " alzheimer " })).toEqual(["Alzheimer disease"]);
    // the variant columns are not searched
    expect(traits({ ...all, search: "44908684" })).toEqual([]);
  });

  it("shows a set of unknown trait type only when the trait type is not filtered", () => {
    const unknown = annotateCredibleSets(groupCodingCredibleSets(rows, "APOE"), {}, isPseudo);
    expect(filterCredibleSetRows(unknown, all)).toHaveLength(2);
    expect(filterCredibleSetRows(unknown, { ...all, traitType: "binary" })).toHaveLength(0);
  });

  it("counts only coding variants at or above the PIP threshold", () => {
    const kept = filterCredibleSetRows(annotated, { ...all, minCodingPip: 0.05 });
    expect(kept[0].codingVariants.map((v) => v.pip)).toEqual([0.9, 0.05]);
    const stricter = filterCredibleSetRows(annotated, { ...all, minCodingPip: 0.06 });
    expect(stricter[0].codingVariants.map((v) => v.pip)).toEqual([0.9]);
    expect(filterCredibleSetRows(annotated, { ...all, minCodingPip: 0.95 })).toEqual([]);
  });

  describe("several traits of one dataset sharing a variant", () => {
    const shared = annotateCredibleSets(
      groupCodingCredibleSets(
        [
          row({ trait: "Dementia", trait_original: "F5_DEMENTIA", cs_id: "a", pip: 0.4 }),
          row({ cs_id: "b", pip: 0.9, cs_size: 3 }),
          // same PIP as the strongest, weaker p-value
          row({ trait: "Memory_loss", trait_original: "MEM", cs_id: "c", pip: 0.9, mlog10p: 20 }),
          row({ resource: "open_targets", dataset: "Open_Targets", cs_id: "d", pip: 0.3 }),
        ],
        "APOE"
      ),
      {},
      () => false
    );

    it("keeps the set the variant is strongest in, per dataset, in top-trait mode", () => {
      const top = filterCredibleSetRows(shared, { ...all, traitMode: "top" });
      expect(top.map((r) => [r.dataset, r.csId])).toEqual([
        ["FinnGen_R14", "b"],
        ["Open_Targets", "d"],
      ]);
    });

    it("summarises a variant as its top trait and statistics per dataset", () => {
      expect(summarizeCodingVariants(shared)).toEqual([
        {
          variant: "19:44908684:T:C",
          pos: 44908684,
          consequence: "missense_variant",
          variantClass: "coding",
          datasets: [
            {
              dataset: "FinnGen_R14",
              traitName: "Alzheimer disease",
              pip: 0.9,
              mlog10p: 300,
              beta: 1.2,
              csSize: 3,
              nTraits: 3,
            },
            {
              dataset: "Open_Targets",
              traitName: "Alzheimer disease",
              pip: 0.3,
              mlog10p: 300,
              beta: 1.2,
              csSize: 2,
              nTraits: 1,
            },
          ],
        },
      ]);
    });
  });

  it("exports one row per credible set with every coding variant listed", () => {
    expect(buildCodingCredibleSetRows("APOE", annotated)[0]).toMatchObject({
      gene: "APOE",
      trait: "Alzheimer disease",
      trait_type: "binary",
      dataset: "FinnGen R14",
      credible_set_type: "SuSiE",
      cs_size: 2,
      cs_min_r2: 0.8,
      top_coding_variant: "19:44908684:T:C",
      consequence: "missense",
      pip: 0.9,
      coding_variants: "19:44908684:T:C(0.9),19:44908822:C:T(0.05)",
    });
  });
});
