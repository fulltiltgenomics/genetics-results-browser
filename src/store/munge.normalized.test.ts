import { describe, it, expect } from "vitest";
import {
  FilterState,
  filterCredibleSets,
  groupCredibleSets,
  summarizeDataTypes,
  summarizePhenotypes,
  summarizeTissues,
} from "./munge.normalized";
import {
  CredibleSetMembership,
  NormalizedResponse,
  PhenotypeMeta,
  VariantResult,
} from "../types/types.normalized";

// unit tests for the stage-2 credible-set munging (new data model). pure functions over small
// explicit inputs — no API/MSW needed. these run alongside the legacy munge.test.ts (additive).

// ---------------------------------------------------------------------------
// factories — each test states only the fields it cares about
// ---------------------------------------------------------------------------

const makeCS = (over: Partial<CredibleSetMembership> = {}): CredibleSetMembership => ({
  resource: "finngen",
  version: "R12",
  dataset: "FinnGen_kanta",
  dataType: "GWAS",
  trait: "T2D",
  traitOriginal: "T2D",
  quantLevel: null,
  cellType: null,
  chr: 19,
  pos: 44908684,
  ref: "T",
  alt: "C",
  csId: "cs1",
  csSize: 5,
  csMinR2: 0.8,
  mlog10p: 10,
  beta: 0.5,
  se: 0.1,
  pip: 0.5,
  aaf: 0.1,
  mostSevere: "missense_variant",
  geneMostSevere: "APOE",
  ...over,
});

const makeVariant = (over: Partial<VariantResult> = {}): VariantResult => ({
  variant: "19:44908684:T:C",
  annotation: {
    rsid: "rs429358",
    consequence: "missense variant",
    isCoding: true,
    isLoF: false,
    gene: "APOE",
    af: 0.18,
  },
  credibleSets: [],
  ...over,
});

const makePhenoMeta = (over: Partial<PhenotypeMeta> = {}): PhenotypeMeta => ({
  resource: "finngen",
  dataType: "GWAS",
  trait: "T2D",
  phenostring: "Type 2 diabetes",
  ...over,
});

// "everything on" baseline so each test only overrides the dimension under test.
const allOn: FilterState = {
  pipThreshold: 0,
  csMinR2Threshold: 0,
  dataTypes: {},
  includeAllQuantLevels: true,
};

// pull the (single) variant's surviving traits for terse assertions
const traits = (vs: VariantResult[]) => vs[0].credibleSets.map((c) => c.trait);

// ---------------------------------------------------------------------------
// filterCredibleSets — PIP
// ---------------------------------------------------------------------------

describe("filterCredibleSets PIP threshold", () => {
  it("keeps memberships with pip >= threshold (inclusive) and drops below", () => {
    const v = makeVariant({
      credibleSets: [
        makeCS({ trait: "EDGE", pip: 0.5 }), // exactly threshold -> kept (>=)
        makeCS({ trait: "BELOW", pip: 0.49 }), // below -> dropped
        makeCS({ trait: "ABOVE", pip: 0.9 }),
      ],
    });
    const out = filterCredibleSets([v], { ...allOn, pipThreshold: 0.5 });
    expect(traits(out).sort()).toEqual(["ABOVE", "EDGE"]);
  });
});

// ---------------------------------------------------------------------------
// filterCredibleSets — cs_min_r2
// ---------------------------------------------------------------------------

describe("filterCredibleSets cs_min_r2 threshold", () => {
  it("keeps memberships with csMinR2 >= threshold (inclusive)", () => {
    const v = makeVariant({
      credibleSets: [
        makeCS({ trait: "HI", csMinR2: 0.6 }),
        makeCS({ trait: "EDGE", csMinR2: 0.5 }), // exactly threshold -> kept
        makeCS({ trait: "LO", csMinR2: 0.3 }), // below -> dropped
      ],
    });
    const out = filterCredibleSets([v], { ...allOn, csMinR2Threshold: 0.5 });
    expect(traits(out).sort()).toEqual(["EDGE", "HI"]);
  });
});

// ---------------------------------------------------------------------------
// filterCredibleSets — resource
// ---------------------------------------------------------------------------

describe("filterCredibleSets resource filter", () => {
  it("keeps only enabled resources", () => {
    const v = makeVariant({
      credibleSets: [
        makeCS({ trait: "FG", resource: "finngen" }),
        makeCS({ trait: "UK", resource: "ukbb" }),
        makeCS({ trait: "OT", resource: "open_targets" }),
      ],
    });
    const out = filterCredibleSets([v], { ...allOn, resources: new Set(["finngen", "ukbb"]) });
    expect(traits(out).sort()).toEqual(["FG", "UK"]);
  });

  it("an empty resource set drops everything", () => {
    const v = makeVariant({ credibleSets: [makeCS()] });
    const out = filterCredibleSets([v], { ...allOn, resources: new Set() });
    expect(traits(out)).toEqual([]);
  });

  it("undefined resources keeps all (no filter)", () => {
    const v = makeVariant({
      credibleSets: [makeCS({ resource: "finngen" }), makeCS({ resource: "ukbb" })],
    });
    const out = filterCredibleSets([v], allOn);
    expect(out[0].credibleSets).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// filterCredibleSets — data-type toggle
// ---------------------------------------------------------------------------

describe("filterCredibleSets data-type toggle", () => {
  it("drops a data type explicitly toggled off; absent types stay enabled", () => {
    const v = makeVariant({
      credibleSets: [
        makeCS({ trait: "G", dataType: "GWAS" }),
        makeCS({ trait: "E", dataType: "eQTL", quantLevel: "ge" }),
        makeCS({ trait: "P", dataType: "pQTL" }),
      ],
    });
    // only eQTL toggled off; GWAS/pQTL absent from map -> kept
    const out = filterCredibleSets([v], { ...allOn, dataTypes: { eQTL: false } });
    expect(traits(out).sort()).toEqual(["G", "P"]);
  });
});

// ---------------------------------------------------------------------------
// filterCredibleSets — quant level
// ---------------------------------------------------------------------------

describe("filterCredibleSets quant-level option", () => {
  it("by default shows ge and non-leveled (null) but drops exon/tx/txrev/leafcutter", () => {
    const v = makeVariant({
      credibleSets: [
        makeCS({ trait: "GE", dataType: "eQTL", quantLevel: "ge" }),
        makeCS({ trait: "EXON", dataType: "eQTL", quantLevel: "exon" }),
        makeCS({ trait: "TX", dataType: "eQTL", quantLevel: "tx" }),
        makeCS({ trait: "GWAS", dataType: "GWAS", quantLevel: null }),
        makeCS({ trait: "CAQTL", dataType: "caQTL", quantLevel: null }),
      ],
    });
    const out = filterCredibleSets([v], { ...allOn, includeAllQuantLevels: false });
    // exon/tx dropped; ge + all null-level rows pass the quant gate
    expect(traits(out).sort()).toEqual(["CAQTL", "GE", "GWAS"]);
  });

  it("includeAllQuantLevels keeps every level", () => {
    const v = makeVariant({
      credibleSets: [
        makeCS({ trait: "GE", dataType: "eQTL", quantLevel: "ge" }),
        makeCS({ trait: "EXON", dataType: "eQTL", quantLevel: "exon" }),
        makeCS({ trait: "LC", dataType: "sQTL", quantLevel: "leafcutter" }),
      ],
    });
    const out = filterCredibleSets([v], { ...allOn, includeAllQuantLevels: true });
    expect(traits(out).sort()).toEqual(["EXON", "GE", "LC"]);
  });
});

// ---------------------------------------------------------------------------
// filterCredibleSets — selected phenotype
// ---------------------------------------------------------------------------

describe("filterCredibleSets selected phenotype", () => {
  it("keeps only the selected resource+trait", () => {
    const v = makeVariant({
      credibleSets: [
        makeCS({ trait: "A", resource: "finngen" }),
        makeCS({ trait: "B", resource: "finngen" }),
        makeCS({ trait: "A", resource: "ukbb" }), // same trait, different resource -> dropped
      ],
    });
    const out = filterCredibleSets([v], {
      ...allOn,
      selectedPhenotype: { resource: "finngen", trait: "A" },
    });
    expect(out[0].credibleSets).toHaveLength(1);
    expect(out[0].credibleSets[0].resource).toBe("finngen");
    expect(out[0].credibleSets[0].trait).toBe("A");
  });
});

// ---------------------------------------------------------------------------
// filterCredibleSets — purity / row retention
// ---------------------------------------------------------------------------

describe("filterCredibleSets purity", () => {
  it("does not mutate the input and keeps variants with zero surviving memberships", () => {
    const v = makeVariant({ credibleSets: [makeCS({ pip: 0.1 })] });
    const out = filterCredibleSets([v], { ...allOn, pipThreshold: 0.9 });
    expect(v.credibleSets).toHaveLength(1); // input untouched
    expect(out).toHaveLength(1); // variant retained (row-dropping is the store's call)
    expect(out[0].credibleSets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// groupCredibleSets
// ---------------------------------------------------------------------------

describe("groupCredibleSets", () => {
  it("groups by resource|dataset|trait|quantLevel|direction; tracks maxPip and count", () => {
    const grouped = groupCredibleSets([
      makeCS({ trait: "T2D", beta: 0.5, pip: 0.6 }),
      makeCS({ trait: "T2D", beta: 0.7, pip: 0.9 }), // same group (same up direction)
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].id).toBe("finngen|FinnGen_kanta|T2D||up");
    expect(grouped[0].count).toBe(2);
    expect(grouped[0].maxPip).toBe(0.9);
    expect(grouped[0].pip).toEqual([0.6, 0.9]);
    expect(grouped[0].beta).toEqual([0.5, 0.7]);
  });

  it("tracks the cs_id of each membership for per-CS colocalization lookups", () => {
    const grouped = groupCredibleSets([
      makeCS({ trait: "T2D", csId: "cs_a" }),
      makeCS({ trait: "T2D", csId: "cs_b" }), // same group, distinct CS
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].csIds).toEqual(["cs_a", "cs_b"]);
  });

  it("splits opposite beta directions into separate groups", () => {
    const grouped = groupCredibleSets([
      makeCS({ trait: "T2D", beta: 0.5 }),
      makeCS({ trait: "T2D", beta: -0.5 }),
    ]);
    expect(grouped.map((g) => g.id).sort()).toEqual([
      "finngen|FinnGen_kanta|T2D||down",
      "finngen|FinnGen_kanta|T2D||up",
    ]);
  });

  it("treats beta of exactly 0 as 'up' direction", () => {
    const grouped = groupCredibleSets([makeCS({ trait: "T2D", beta: 0 })]);
    expect(grouped[0].id).toBe("finngen|FinnGen_kanta|T2D||up");
  });

  it("keeps different quant levels of the same gene in separate groups", () => {
    const grouped = groupCredibleSets([
      makeCS({ resource: "eqtl_catalogue", dataset: "QTD1", trait: "CLASRP", quantLevel: "ge" }),
      makeCS({ resource: "eqtl_catalogue", dataset: "QTD1", trait: "CLASRP", quantLevel: "exon" }),
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped.map((g) => g.quantLevel).sort()).toEqual(["exon", "ge"]);
  });

  it("orders groups by maxPip descending", () => {
    const grouped = groupCredibleSets([
      makeCS({ trait: "LOW", dataset: "A", pip: 0.3 }),
      makeCS({ trait: "HIGH", dataset: "B", pip: 0.95 }),
      makeCS({ trait: "MID", dataset: "C", pip: 0.6 }),
    ]);
    expect(grouped.map((g) => g.maxPip)).toEqual([0.95, 0.6, 0.3]);
  });

  it("carries null mlog10p through as NaN without throwing", () => {
    const grouped = groupCredibleSets([makeCS({ mlog10p: null })]);
    expect(grouped[0].mlog10p).toHaveLength(1);
    expect(Number.isNaN(grouped[0].mlog10p[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// summarizeDataTypes
// ---------------------------------------------------------------------------

describe("summarizeDataTypes", () => {
  it("counts distinct CS memberships per data type for each variant", () => {
    const v = makeVariant({
      credibleSets: [
        makeCS({ dataType: "GWAS", trait: "T2D" }),
        makeCS({ dataType: "GWAS", trait: "ASTHMA" }),
        makeCS({ dataType: "eQTL", quantLevel: "ge", trait: "APOE" }),
        makeCS({ dataType: "pQTL", trait: "APOE" }),
      ],
    });
    const [row] = summarizeDataTypes([v]);
    expect(row.counts).toEqual({ GWAS: 2, eQTL: 1, pQTL: 1 });
    expect(row.total).toBe(4);
  });

  it("dedupes duplicate memberships of the same signal within a data type", () => {
    const v = makeVariant({
      credibleSets: [
        // same resource|dataset|trait|quantLevel -> one distinct signal
        makeCS({ dataType: "GWAS", trait: "T2D", csId: "a", beta: 0.5 }),
        makeCS({ dataType: "GWAS", trait: "T2D", csId: "b", beta: -0.5 }),
      ],
    });
    const [row] = summarizeDataTypes([v]);
    expect(row.counts.GWAS).toBe(1);
    expect(row.total).toBe(1);
  });

  it("counts different eQTL quant levels of the same gene separately", () => {
    const v = makeVariant({
      credibleSets: [
        makeCS({ dataType: "eQTL", trait: "CLASRP", quantLevel: "ge" }),
        makeCS({ dataType: "eQTL", trait: "CLASRP", quantLevel: "exon" }),
      ],
    });
    expect(summarizeDataTypes([v])[0].counts.eQTL).toBe(2);
  });

  it("emits a zero-total row for a variant with no surviving memberships", () => {
    const v = makeVariant({ variant: "19:9:A:G", credibleSets: [] });
    const [row] = summarizeDataTypes([v]);
    expect(row.variant).toBe("19:9:A:G");
    expect(row.total).toBe(0);
    expect(row.counts).toEqual({});
  });

  it("carries the variant's rsid and gene through for display", () => {
    const v = makeVariant({ credibleSets: [makeCS()] });
    const [row] = summarizeDataTypes([v]);
    expect(row.rsid).toBe("rs429358");
    expect(row.gene).toBe("APOE");
  });
});

// ---------------------------------------------------------------------------
// summarizePhenotypes
// ---------------------------------------------------------------------------

describe("summarizePhenotypes", () => {
  const phenos: NormalizedResponse["phenotypes"] = {
    "finngen|T2D": makePhenoMeta({ trait: "T2D", phenostring: "Type 2 diabetes" }),
    "finngen|ASTHMA": makePhenoMeta({ trait: "ASTHMA", phenostring: "Asthma" }),
  };

  it("counts distinct input variants in a CS per resource+trait", () => {
    const v1 = makeVariant({
      variant: "19:1:A:G",
      credibleSets: [makeCS({ trait: "T2D" }), makeCS({ trait: "ASTHMA" })],
    });
    const v2 = makeVariant({
      variant: "19:2:A:G",
      // two memberships for the SAME trait -> counted once (distinct variants)
      credibleSets: [makeCS({ trait: "T2D" }), makeCS({ trait: "T2D", csId: "cs2" })],
    });
    const summary = summarizePhenotypes([v1, v2], phenos);
    const t2d = summary.find((r) => r.trait === "T2D")!;
    expect(t2d.variantCount).toBe(2);
    expect(t2d.variants.sort()).toEqual(["19:1:A:G", "19:2:A:G"]);
    expect(t2d.phenostring).toBe("Type 2 diabetes");
  });

  it("counts consistent vs opposite direction relative to the variant input beta", () => {
    const v = makeVariant({
      beta: 1, // positive input beta
      credibleSets: [
        makeCS({ trait: "T2D", beta: 0.5 }), // consistent
        makeCS({ trait: "T2D", beta: -0.5, csId: "cs2" }), // opposite
      ],
    });
    const summary = summarizePhenotypes([v], phenos);
    const t2d = summary[0];
    expect(t2d.consistentCount).toBe(1);
    expect(t2d.oppositeCount).toBe(1);
    expect(t2d.variantCount).toBe(1); // still one distinct variant
  });

  it("omits direction counts entirely when no variant has an input beta", () => {
    const v = makeVariant({ beta: undefined, credibleSets: [makeCS({ trait: "T2D" })] });
    const summary = summarizePhenotypes([v], phenos);
    expect(summary[0].consistentCount).toBeUndefined();
    expect(summary[0].oppositeCount).toBeUndefined();
    expect(summary[0].variantCount).toBe(1);
  });

  it("sorts rows by variantCount descending", () => {
    const v1 = makeVariant({ variant: "19:1:A:G", credibleSets: [makeCS({ trait: "ASTHMA" })] });
    const v2 = makeVariant({ variant: "19:2:A:G", credibleSets: [makeCS({ trait: "ASTHMA" })] });
    const v3 = makeVariant({ variant: "19:3:A:G", credibleSets: [makeCS({ trait: "T2D" })] });
    const summary = summarizePhenotypes([v1, v2, v3], phenos);
    expect(summary.map((r) => r.trait)).toEqual(["ASTHMA", "T2D"]);
  });

  it("falls back to trait as phenostring when metadata is missing", () => {
    const v = makeVariant({ credibleSets: [makeCS({ trait: "UNKNOWN" })] });
    const summary = summarizePhenotypes([v], {});
    expect(summary[0].phenostring).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// summarizeTissues
// ---------------------------------------------------------------------------

describe("summarizeTissues", () => {
  it("aggregates eQTL memberships into tissue counts keyed by cellType", () => {
    const v = makeVariant({
      credibleSets: [
        makeCS({ dataType: "eQTL", quantLevel: "ge", cellType: "brain", trait: "CLASRP" }),
        makeCS({ dataType: "eQTL", quantLevel: "ge", cellType: "plasma", trait: "ACY1" }),
      ],
    });
    const tissues = summarizeTissues([v], "eQTL");
    expect(tissues.map((t) => t.tissueOrCellType).sort()).toEqual(["brain", "plasma"]);
    expect(tissues.every((t) => t.variantCount === 1)).toBe(true);
    expect(tissues.every((t) => t.dataType === "eQTL")).toBe(true);
  });

  it("only summarizes the selected data type (eQTL vs caQTL toggle)", () => {
    const v = makeVariant({
      credibleSets: [
        makeCS({ dataType: "eQTL", quantLevel: "ge", cellType: "brain", trait: "CLASRP" }),
        makeCS({ dataType: "caQTL", cellType: "l1.PBMC", trait: "chr19-44906317-44906816" }),
      ],
    });
    const eqtl = summarizeTissues([v], "eQTL");
    expect(eqtl.map((t) => t.tissueOrCellType)).toEqual(["brain"]);
    const caqtl = summarizeTissues([v], "caQTL");
    expect(caqtl.map((t) => t.tissueOrCellType)).toEqual(["l1.PBMC"]);
    expect(caqtl[0].dataType).toBe("caQTL");
  });

  it("dedupes the same variant within a tissue (counts variants, not records)", () => {
    const v = makeVariant({
      credibleSets: [
        makeCS({ dataType: "eQTL", quantLevel: "ge", cellType: "brain", trait: "GENE1" }),
        makeCS({ dataType: "eQTL", quantLevel: "ge", cellType: "brain", trait: "GENE2" }),
      ],
    });
    const tissues = summarizeTissues([v], "eQTL");
    expect(tissues).toHaveLength(1);
    expect(tissues[0].variantCount).toBe(1);
  });

  it("counts distinct variants across the input list", () => {
    const v1 = makeVariant({
      variant: "19:1:A:G",
      credibleSets: [makeCS({ dataType: "eQTL", quantLevel: "ge", cellType: "brain" })],
    });
    const v2 = makeVariant({
      variant: "19:2:A:G",
      credibleSets: [makeCS({ dataType: "eQTL", quantLevel: "ge", cellType: "brain" })],
    });
    const tissues = summarizeTissues([v1, v2], "eQTL");
    expect(tissues[0].variantCount).toBe(2);
    expect(tissues[0].variants.sort()).toEqual(["19:1:A:G", "19:2:A:G"]);
  });

  it("skips memberships without a cellType (can't attribute a tissue)", () => {
    const v = makeVariant({
      credibleSets: [makeCS({ dataType: "eQTL", quantLevel: "ge", cellType: null })],
    });
    expect(summarizeTissues([v], "eQTL")).toHaveLength(0);
  });

  it("does not compute linkedGenes (peak->gene enrichment deferred)", () => {
    const v = makeVariant({
      credibleSets: [
        makeCS({ dataType: "caQTL", cellType: "l1.PBMC", trait: "chr19-44906317-44906816" }),
      ],
    });
    expect(summarizeTissues([v], "caQTL")[0].linkedGenes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// integration over the real fixture (filter -> group -> summarize)
// ---------------------------------------------------------------------------

describe("pipeline over the normalized_response fixture", () => {
  // import lazily so the test file stays runnable even if the fixture path changes
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fixture = require("../test/fixtures/normalized_response.json") as NormalizedResponse;

  it("filters the exon-level eQTL row out by default and keeps the rest", () => {
    const out = filterCredibleSets(fixture.variants, { ...allOn, includeAllQuantLevels: false });
    const all = out.flatMap((v) => v.credibleSets);
    // fixture has 6 CS rows, exactly one is exon-level (CLASRP) -> 5 survive the default quant gate
    expect(all).toHaveLength(5);
    expect(all.some((c) => c.quantLevel === "exon")).toBe(false);
  });

  it("groups and summarizes without throwing on real data", () => {
    const filtered = filterCredibleSets(fixture.variants, allOn);
    const grouped = groupCredibleSets(filtered.flatMap((v) => v.credibleSets));
    expect(grouped.length).toBeGreaterThan(0);
    // maxPip ordering holds
    for (let i = 1; i < grouped.length; i++) {
      expect(grouped[i - 1].maxPip).toBeGreaterThanOrEqual(grouped[i].maxPip);
    }
    const phenoSummary = summarizePhenotypes(filtered, fixture.phenotypes);
    expect(phenoSummary.length).toBeGreaterThan(0);
    const tissues = summarizeTissues(filtered, "eQTL");
    // fixture eQTL row has cellType "brain_(DLPFC)|naive"
    expect(tissues.map((t) => t.tissueOrCellType)).toContain("brain_(DLPFC)|naive");
  });
});
