import { describe, it, expect } from "vitest";
import {
  filterRows,
  isQTLInCis,
  isQTLInTrans,
  summarizePhenotypes,
  summarizeTissues,
} from "./munge";
import {
  AssocRecord,
  Dataset,
  DataType,
  FineMappedRecord,
  Phenotype,
  QTLType,
  TableData,
  VariantRecord,
} from "../types/types";

// CHARACTERIZATION TESTS (Working Effectively with Legacy Code).
// these pin down the CURRENT behavior of munge.ts before the data-layer refactor.
// where current behavior is surprising / arguably buggy it is captured as-is and
// flagged with a lowercase comment so the refactor notices intentional vs accidental changes.
//
// note: groupAssocPhenos / groupFineMappedTraits / countAssocPhenos / countFineMappedTraits
// are not exported, so they are exercised indirectly through filterRows (which calls them and
// writes groupedData/counts onto each VariantRecord). this matches how the store uses munge.

// ---------------------------------------------------------------------------
// small explicit factories so each test states only the fields it cares about
// ---------------------------------------------------------------------------

const makePheno = (over: Partial<Phenotype> = {}): Phenotype => ({
  resource: "FG",
  data_type: DataType.GWAS,
  phenocode: "T2D",
  phenostring: "Type 2 diabetes",
  num_cases: 1000,
  num_samples: 10000,
  trait_type: "case-control",
  ...over,
});

const makeAssoc = (over: Partial<AssocRecord> = {}): AssocRecord => ({
  resource: "FG",
  dataset: "FG",
  data_type: DataType.GWAS,
  variant: "1-100-A-G",
  phenocode: "T2D",
  mlog10p: 10,
  beta: 0.5,
  sebeta: 0.1,
  ld: false,
  ...over,
});

const makeFineMapped = (over: Partial<FineMappedRecord> = {}): FineMappedRecord => ({
  resource: "FG",
  dataset: "FG",
  data_type: DataType.GWAS,
  phenocode: "T2D",
  cs_size: 5,
  cs_min_r2: 0.5,
  mlog10p: 10,
  beta: 0.5,
  se: 0.1,
  pip: 0.5,
  ...over,
});

const makeVariant = (over: Partial<VariantRecord> = {}): VariantRecord => ({
  variant: "1-100-A-G",
  beta: undefined,
  value: undefined,
  anno: { most_severe: "missense_variant", AF: 0.01 },
  // gnomad is irrelevant to the munge functions under test
  gnomad: { preferred: "genomes" } as VariantRecord["gnomad"],
  assoc: {
    data: [],
    groupedData: [],
    counts: {} as VariantRecord["assoc"]["counts"],
    resources: [],
  },
  finemapped: {
    data: [],
    groupedData: [],
    counts: {} as VariantRecord["finemapped"]["counts"],
    resources: [],
  },
  ...over,
});

// builds a minimal TableData. phenos are keyed "resource:phenocode" as the code expects.
const makeTableData = (over: {
  data?: VariantRecord[];
  phenos?: Record<string, Phenotype>;
  datasets?: Record<string, Dataset>;
}): TableData => ({
  data: over.data ?? [],
  has_betas: true,
  has_custom_values: false,
  most_severe: [],
  phenos: over.phenos ?? {},
  datasets: over.datasets ?? {},
  input_variants: { found: [], not_found: [], unparsed: [], ac0: [], rsid_map: {} },
  meta: {
    gnomad: { populations: [], version: "x", url: "x" },
    assoc: {
      resources: [
        { resource: "FG", data_types: [DataType.GWAS], file: "f", p_thres: 1e-6 },
        { resource: "EQTL", data_types: [DataType.EQTL], file: "f", p_thres: 1e-6 },
      ],
    },
    finemapped: {
      resources: [
        { resource: "FG", data_types: [DataType.GWAS] },
        { resource: "EQTL", data_types: [DataType.EQTL] },
      ],
    },
  },
  freq_summary: [],
  query_type: "variant",
});

// default filter args mirroring the store's "everything on" state, so each test
// only overrides the dimension under test
const allDataTypes: Record<DataType, boolean> = {
  [DataType.GWAS]: true,
  [DataType.EQTL]: true,
  [DataType.PQTL]: true,
  [DataType.SQTL]: true,
  [DataType.EDQTL]: true,
  [DataType.METABOQTL]: true,
  [DataType.ASMQTL]: true,
  [DataType.NA]: true,
};
const allGwasTypes = { "case-control": true, continuous: true };
const allQtlTypes: Record<QTLType, boolean> = { CIS: true, TRANS: true };

// ---------------------------------------------------------------------------
// isQTLInCis / isQTLInTrans
// ---------------------------------------------------------------------------

describe("isQTLInCis", () => {
  const eqtlPheno = makePheno({
    data_type: DataType.EQTL,
    chromosome: "1",
    gene_start: 1_000_000,
    gene_end: 1_005_000,
    strand: 1,
  });

  it("returns true when variant is within cisWindow Mb of the gene start (strand +1 -> uses gene_start)", () => {
    // gene_start 1,000,000; variant at 1,200,000; cisWindow 1Mb -> within
    expect(isQTLInCis("1-1200000-A-G", eqtlPheno, 1)).toBe(true);
  });

  it("returns false when variant is outside the cisWindow", () => {
    // 3,000,000 is >1Mb from gene_start 1,000,000
    expect(isQTLInCis("1-3000000-A-G", eqtlPheno, 1)).toBe(false);
  });

  it("uses gene_end as the anchor when strand is -1", () => {
    const minusStrand = makePheno({
      data_type: DataType.EQTL,
      chromosome: "1",
      gene_start: 1_000_000,
      gene_end: 5_000_000,
      strand: -1,
    });
    // anchored on gene_end (5,000,000): a variant near gene_start is NOT cis
    expect(isQTLInCis("1-1000000-A-G", minusStrand, 1)).toBe(false);
    expect(isQTLInCis("1-5000000-A-G", minusStrand, 1)).toBe(true);
  });

  it("returns false on chromosome mismatch", () => {
    expect(isQTLInCis("2-1000000-A-G", eqtlPheno, 1)).toBe(false);
  });

  it("returns false for non-QTL (GWAS) phenotypes", () => {
    expect(isQTLInCis("1-1000000-A-G", makePheno({ data_type: DataType.GWAS }), 1)).toBe(false);
  });

  it("returns false for metaboQTL regardless of position (current behavior)", () => {
    // metaboQTL is hard-coded to never be cis
    const metabo = makePheno({
      data_type: DataType.METABOQTL,
      chromosome: "1",
      gene_start: 1_000_000,
      gene_end: 1_005_000,
      strand: 1,
    });
    expect(isQTLInCis("1-1000000-A-G", metabo, 1)).toBe(false);
  });

  it("returns false when gene coordinates are missing", () => {
    expect(
      isQTLInCis("1-1000000-A-G", makePheno({ data_type: DataType.EQTL, chromosome: "1" }), 1)
    ).toBe(false);
  });
});

describe("isQTLInTrans", () => {
  const eqtlPheno = makePheno({
    data_type: DataType.EQTL,
    chromosome: "1",
    gene_start: 1_000_000,
    gene_end: 1_005_000,
    strand: 1,
  });

  it("returns true when on a different chromosome than the gene", () => {
    expect(isQTLInTrans("2-1000000-A-G", eqtlPheno, 1)).toBe(true);
  });

  it("returns true when on same chromosome but outside the cis window", () => {
    expect(isQTLInTrans("1-3000000-A-G", eqtlPheno, 1)).toBe(true);
  });

  it("returns false when in cis", () => {
    expect(isQTLInTrans("1-1200000-A-G", eqtlPheno, 1)).toBe(false);
  });

  it("returns false for metaboQTL (current behavior: never cis nor trans)", () => {
    const metabo = makePheno({
      data_type: DataType.METABOQTL,
      chromosome: "1",
      gene_start: 1_000_000,
      gene_end: 1_005_000,
      strand: 1,
    });
    expect(isQTLInTrans("2-1000000-A-G", metabo, 1)).toBe(false);
  });

  it("returns false for non-QTL phenotypes", () => {
    expect(isQTLInTrans("2-1000000-A-G", makePheno({ data_type: DataType.GWAS }), 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterRows: p-value, data-type, GWAS-type, QTL cis/trans, PIP, phenotype filtering
// ---------------------------------------------------------------------------

describe("filterRows p-value filtering", () => {
  it("keeps assoc records with mlog10p strictly greater than -log10(p) and drops the rest", () => {
    // p = 0.01 -> -log10(p) = 2; the filter is mlog10p > 2 (strict)
    const phenos = {
      "FG:KEEP": makePheno({ phenocode: "KEEP" }),
      "FG:DROP": makePheno({ phenocode: "DROP" }),
      "FG:EDGE": makePheno({ phenocode: "EDGE" }),
    };
    const variant = makeVariant({
      assoc: {
        data: [
          makeAssoc({ phenocode: "KEEP", mlog10p: 3 }),
          makeAssoc({ phenocode: "DROP", mlog10p: 1 }),
          makeAssoc({ phenocode: "EDGE", mlog10p: 2 }), // exactly at threshold -> dropped (strict >)
        ],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos });
    const out = filterRows(
      data,
      allDataTypes,
      allGwasTypes,
      allQtlTypes,
      1,
      0.01,
      0,
      undefined,
      false
    );
    const kept = out.data[0].assoc.data.map((a) => a.phenocode);
    // EDGE at exactly the threshold is excluded because the comparison is strict (>)
    expect(kept).toEqual(["KEEP"]);
  });
});

describe("filterRows data-type and GWAS-type filtering", () => {
  it("drops assoc records whose data_type toggle is off", () => {
    const phenos = {
      "FG:G": makePheno({ phenocode: "G", data_type: DataType.GWAS }),
      "EQTL:E": makePheno({ phenocode: "E", resource: "EQTL", data_type: DataType.EQTL }),
    };
    const variant = makeVariant({
      assoc: {
        data: [
          makeAssoc({ phenocode: "G", mlog10p: 10 }),
          makeAssoc({
            phenocode: "E",
            resource: "EQTL",
            dataset: "EQTL",
            data_type: DataType.EQTL,
            mlog10p: 10,
          }),
        ],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos });
    const out = filterRows(
      data,
      { ...allDataTypes, [DataType.EQTL]: false },
      allGwasTypes,
      allQtlTypes,
      1,
      1,
      0,
      undefined,
      false
    );
    expect(out.data[0].assoc.data.map((a) => a.phenocode)).toEqual(["G"]);
  });

  it("drops GWAS records whose trait_type toggle is off (only applies to GWAS)", () => {
    const phenos = {
      "FG:CC": makePheno({ phenocode: "CC", trait_type: "case-control" }),
      "FG:CONT": makePheno({ phenocode: "CONT", trait_type: "continuous" }),
    };
    const variant = makeVariant({
      assoc: {
        data: [
          makeAssoc({ phenocode: "CC", mlog10p: 10 }),
          makeAssoc({ phenocode: "CONT", mlog10p: 10 }),
        ],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos });
    const out = filterRows(
      data,
      allDataTypes,
      { "case-control": true, continuous: false },
      allQtlTypes,
      1,
      1,
      0,
      undefined,
      false
    );
    expect(out.data[0].assoc.data.map((a) => a.phenocode)).toEqual(["CC"]);
  });
});

describe("filterRows QTL cis/trans filtering", () => {
  const cisEqtlPheno = makePheno({
    phenocode: "CIS",
    resource: "EQTL",
    data_type: DataType.EQTL,
    chromosome: "1",
    gene_start: 1_000_000,
    gene_end: 1_005_000,
    strand: 1,
  });
  const transEqtlPheno = makePheno({
    phenocode: "TRANS",
    resource: "EQTL",
    data_type: DataType.EQTL,
    chromosome: "2",
    gene_start: 1_000_000,
    gene_end: 1_005_000,
    strand: 1,
  });

  const build = () => {
    const phenos = { "EQTL:CIS": cisEqtlPheno, "EQTL:TRANS": transEqtlPheno };
    const variant = makeVariant({
      variant: "1-1100000-A-G", // chr1, near the cis gene's start -> cis for CIS pheno, trans for TRANS pheno
      assoc: {
        data: [
          makeAssoc({
            phenocode: "CIS",
            resource: "EQTL",
            dataset: "EQTL",
            data_type: DataType.EQTL,
            variant: "1-1100000-A-G",
            mlog10p: 10,
          }),
          makeAssoc({
            phenocode: "TRANS",
            resource: "EQTL",
            dataset: "EQTL",
            data_type: DataType.EQTL,
            variant: "1-1100000-A-G",
            mlog10p: 10,
          }),
        ],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    return makeTableData({ data: [variant], phenos });
  };

  it("drops cis QTLs when CIS toggle is off", () => {
    const out = filterRows(
      build(),
      allDataTypes,
      allGwasTypes,
      { CIS: false, TRANS: true },
      1,
      1,
      0,
      undefined,
      false
    );
    expect(out.data[0].assoc.data.map((a) => a.phenocode)).toEqual(["TRANS"]);
  });

  it("drops trans QTLs when TRANS toggle is off", () => {
    const out = filterRows(
      build(),
      allDataTypes,
      allGwasTypes,
      { CIS: true, TRANS: false },
      1,
      1,
      0,
      undefined,
      false
    );
    expect(out.data[0].assoc.data.map((a) => a.phenocode)).toEqual(["CIS"]);
  });
});

describe("filterRows phenotype selection", () => {
  it("keeps only the selected phenotype's records when a pheno is given", () => {
    const phenos = {
      "FG:A": makePheno({ phenocode: "A" }),
      "FG:B": makePheno({ phenocode: "B" }),
    };
    const variant = makeVariant({
      assoc: {
        data: [
          makeAssoc({ phenocode: "A", mlog10p: 10 }),
          makeAssoc({ phenocode: "B", mlog10p: 10 }),
        ],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos });
    const out = filterRows(
      data,
      allDataTypes,
      allGwasTypes,
      allQtlTypes,
      1,
      1,
      0,
      phenos["FG:A"],
      false
    );
    expect(out.data[0].assoc.data.map((a) => a.phenocode)).toEqual(["A"]);
  });
});

describe("filterRows placeholder handling", () => {
  it("drops variants with no surviving assoc records when keepPlaceholders=false", () => {
    const phenos = { "FG:T2D": makePheno() };
    const variant = makeVariant({
      assoc: {
        data: [makeAssoc({ mlog10p: 0.5 })], // below threshold for p=0.01
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos });
    const out = filterRows(
      data,
      allDataTypes,
      allGwasTypes,
      allQtlTypes,
      1,
      0.01,
      0,
      undefined,
      false
    );
    expect(out.data).toHaveLength(0);
  });

  it("keeps is_na placeholder records when keepPlaceholders=true even below threshold", () => {
    const phenos = { "FG:NA": makePheno({ phenocode: "NA", is_na: true }) };
    const variant = makeVariant({
      assoc: {
        data: [makeAssoc({ phenocode: "NA", mlog10p: 0 })],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos });
    const out = filterRows(
      data,
      allDataTypes,
      allGwasTypes,
      allQtlTypes,
      1,
      0.01,
      0,
      undefined,
      true
    );
    expect(out.data).toHaveLength(1);
    expect(out.data[0].assoc.data).toHaveLength(1);
  });
});

describe("filterRows PIP filtering of finemapped data", () => {
  it("keeps finemapped records with pip >= pip threshold (inclusive) and drops below", () => {
    const phenos = { "FG:T2D": makePheno() };
    const variant = makeVariant({
      assoc: {
        data: [makeAssoc({ mlog10p: 10 })],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
      finemapped: {
        data: [
          makeFineMapped({ pip: 0.5 }), // exactly threshold -> kept (>=)
          makeFineMapped({ pip: 0.49 }), // below -> dropped
          makeFineMapped({ pip: 0.9 }),
        ],
        groupedData: [],
        counts: {} as VariantRecord["finemapped"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos });
    const out = filterRows(
      data,
      allDataTypes,
      allGwasTypes,
      allQtlTypes,
      1,
      1,
      0.5,
      undefined,
      true
    );
    expect(out.data[0].finemapped.data.map((f) => f.pip).sort()).toEqual([0.5, 0.9]);
  });
});

// ---------------------------------------------------------------------------
// groupAssocPhenos (via filterRows -> groupedData) including direction + LD/lead pruning
// ---------------------------------------------------------------------------

describe("groupAssocPhenos (via filterRows.groupedData)", () => {
  const runGroup = (assocData: AssocRecord[], phenos: Record<string, Phenotype>) => {
    const variant = makeVariant({
      assoc: {
        data: assocData,
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos });
    const out = filterRows(
      data,
      allDataTypes,
      allGwasTypes,
      allQtlTypes,
      1,
      1,
      0,
      undefined,
      true
    );
    return out.data[0].assoc.groupedData;
  };

  it("groups records by resource:dataset:phenostring:direction and counts distinct phenocodes", () => {
    const phenos = { "FG:T2D": makePheno({ phenocode: "T2D", phenostring: "Type 2 diabetes" }) };
    const grouped = runGroup(
      [
        makeAssoc({ phenocode: "T2D", beta: 0.5 }),
        makeAssoc({ phenocode: "T2D", beta: 0.7 }), // same group (same direction up, same phenocode)
      ],
      phenos
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0].id).toBe("FG:FG:Type 2 diabetes:up");
    // count is the number of DISTINCT phenocodes in the group, not the number of records
    expect(grouped[0].count).toBe(1);
    expect(grouped[0].beta).toEqual([0.5, 0.7]);
  });

  it("splits opposite directions into separate groups", () => {
    const phenos = { "FG:T2D": makePheno({ phenocode: "T2D" }) };
    const grouped = runGroup(
      [makeAssoc({ phenocode: "T2D", beta: 0.5 }), makeAssoc({ phenocode: "T2D", beta: -0.5 })],
      phenos
    );
    expect(grouped.map((g) => g.id).sort()).toEqual([
      "FG:FG:Type 2 diabetes:down",
      "FG:FG:Type 2 diabetes:up",
    ]);
  });

  it("prunes LD records from a group when an exact (non-LD) record is also present", () => {
    // current behavior: within a group having both ld=true and ld=false members,
    // the ld=true members are removed
    const phenos = { "FG:T2D": makePheno({ phenocode: "T2D" }) };
    const grouped = runGroup(
      [
        makeAssoc({ phenocode: "T2D", beta: 0.5, ld: false, mlog10p: 10 }),
        makeAssoc({ phenocode: "T2D", beta: 0.6, ld: true, mlog10p: 8 }),
      ],
      phenos
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0].ld).toEqual([false]);
    expect(grouped[0].mlog10p).toEqual([10]);
  });

  it("prunes non-lead records when a lead record is present in the group", () => {
    const phenos = { "FG:T2D": makePheno({ phenocode: "T2D" }) };
    const grouped = runGroup(
      [
        makeAssoc({ phenocode: "T2D", beta: 0.5, lead: true, mlog10p: 10 }),
        makeAssoc({ phenocode: "T2D", beta: 0.6, lead: false, mlog10p: 8 }),
      ],
      phenos
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0].lead).toEqual([true]);
    expect(grouped[0].mlog10p).toEqual([10]);
  });
});

// ---------------------------------------------------------------------------
// groupFineMappedTraits (via filterRows.finemapped.groupedData): grouping, max_pip, ordering
// ---------------------------------------------------------------------------

describe("groupFineMappedTraits (via filterRows.finemapped.groupedData)", () => {
  const runGroup = (fmData: FineMappedRecord[]) => {
    const phenos = { "FG:T2D": makePheno() };
    const variant = makeVariant({
      assoc: {
        data: [makeAssoc({ mlog10p: 10 })],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
      finemapped: {
        data: fmData,
        groupedData: [],
        counts: {} as VariantRecord["finemapped"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos });
    const out = filterRows(
      data,
      allDataTypes,
      allGwasTypes,
      allQtlTypes,
      1,
      1,
      0,
      undefined,
      true
    );
    return out.data[0].finemapped.groupedData;
  };

  it("groups by dataset:phenocode:direction and tracks max_pip + count", () => {
    const grouped = runGroup([
      makeFineMapped({ dataset: "FG", phenocode: "T2D", beta: 0.5, pip: 0.6 }),
      makeFineMapped({ dataset: "FG", phenocode: "T2D", beta: 0.5, pip: 0.9 }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].id).toBe("FG:T2D:up");
    expect(grouped[0].count).toBe(2);
    expect(grouped[0].max_pip).toBe(0.9);
  });

  it("orders groups by max_pip descending", () => {
    const grouped = runGroup([
      makeFineMapped({ dataset: "A", phenocode: "P1", beta: 0.5, pip: 0.3 }),
      makeFineMapped({ dataset: "B", phenocode: "P2", beta: 0.5, pip: 0.95 }),
      makeFineMapped({ dataset: "C", phenocode: "P3", beta: 0.5, pip: 0.6 }),
    ]);
    expect(grouped.map((g) => g.max_pip)).toEqual([0.95, 0.6, 0.3]);
  });

  it("treats beta of exactly 0 as 'up' direction (current behavior: down only for beta<0)", () => {
    // groupFineMappedTraits id uses (beta > 0 ? 'up' : 'down'); beta===0 falls into 'down'
    const grouped = runGroup([makeFineMapped({ dataset: "FG", phenocode: "T2D", beta: 0, pip: 0.5 })]);
    expect(grouped[0].id).toBe("FG:T2D:down");
  });
});

// ---------------------------------------------------------------------------
// countAssocPhenos (via filterRows.assoc.counts) and countFineMappedTraits
// (via filterRows.finemapped.counts): per-data-type up/down/total breakdowns
// ---------------------------------------------------------------------------

describe("countAssocPhenos (via filterRows.assoc.counts)", () => {
  it("breaks counts down per resource and per data_type with up/down/total", () => {
    // one FG GWAS up, one EQTL eqtl up, one EQTL eqtl down -> distinct phenostrings keep
    // them in separate groups so the counts reflect three groups
    const phenos = {
      "FG:G": makePheno({ phenocode: "G", phenostring: "G pheno", data_type: DataType.GWAS }),
      "EQTL:E_UP": makePheno({
        phenocode: "E_UP",
        phenostring: "E up pheno",
        resource: "EQTL",
        data_type: DataType.EQTL,
      }),
      "EQTL:E_DN": makePheno({
        phenocode: "E_DN",
        phenostring: "E down pheno",
        resource: "EQTL",
        data_type: DataType.EQTL,
      }),
    };
    const variant = makeVariant({
      assoc: {
        data: [
          makeAssoc({ phenocode: "G", beta: 0.5, mlog10p: 10 }),
          makeAssoc({
            phenocode: "E_UP",
            resource: "EQTL",
            dataset: "EQTL",
            data_type: DataType.EQTL,
            beta: 0.3,
            mlog10p: 10,
          }),
          makeAssoc({
            phenocode: "E_DN",
            resource: "EQTL",
            dataset: "EQTL",
            data_type: DataType.EQTL,
            beta: -0.4,
            mlog10p: 10,
          }),
        ],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos });
    const counts = filterRows(
      data,
      allDataTypes,
      allGwasTypes,
      allQtlTypes,
      1,
      1,
      0,
      undefined,
      false
    ).data[0].assoc.counts;
    // three groups total: 2 up (G, E_UP), 1 down (E_DN)
    expect(counts.total).toEqual({ up: 2, down: 1, total: 3 });
    // resource keys come from data.meta.assoc.resources (FG, EQTL)
    expect(counts.resource.FG).toEqual({ up: 1, down: 0, total: 1 });
    expect(counts.resource.EQTL).toEqual({ up: 1, down: 1, total: 2 });
    // per-data-type breakdown
    expect(counts.gwas).toEqual({ up: 1, down: 0, total: 1 });
    expect(counts.eqtl).toEqual({ up: 1, down: 1, total: 2 });
    // qtl aggregates all *QTL data types (here just eqtl)
    expect(counts.qtl).toEqual({ up: 1, down: 1, total: 2 });
    // unused data types are all zero
    expect(counts.pqtl).toEqual({ up: 0, down: 0, total: 0 });
  });
});

describe("countAssocPhenos vs countFineMappedTraits total semantics for beta===0 placeholders", () => {
  it("countAssocPhenos.total.total EXCLUDES beta===0 placeholders, countFineMappedTraits.total.total is a plain length", () => {
    // pin the quirk both reviewers flagged: munge.ts:101 counts assoc total as
    // beta[0] != 0 (so an is_na placeholder with beta 0 is omitted from total),
    // whereas munge.ts:255 counts finemapped total as d.length (placeholder included)
    const phenos = {
      "FG:T2D": makePheno({ phenocode: "T2D", phenostring: "Type 2 diabetes" }),
      "FG:NA": makePheno({ phenocode: "NA", phenostring: "placeholder", is_na: true }),
    };
    const variant = makeVariant({
      assoc: {
        data: [
          makeAssoc({ phenocode: "T2D", beta: 0.5, mlog10p: 10 }),
          // is_na placeholder kept via keepPlaceholders, beta 0 -> direction "NA" group
          makeAssoc({ phenocode: "NA", beta: 0, mlog10p: 0 }),
        ],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
      finemapped: {
        // a beta===0 finemapped record (grouped as "down"); included in plain-length total
        data: [
          makeFineMapped({ phenocode: "T2D", beta: 0.5, pip: 0.8 }),
          makeFineMapped({ phenocode: "NA", beta: 0, pip: 0.7 }),
        ],
        groupedData: [],
        counts: {} as VariantRecord["finemapped"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos });
    const out = filterRows(
      data,
      allDataTypes,
      allGwasTypes,
      allQtlTypes,
      1,
      1,
      0,
      undefined,
      true // keep placeholders so the beta===0 assoc survives
    );
    const v = out.data[0];
    // two assoc groups exist (T2D up + NA placeholder), but total excludes the beta===0 one
    expect(v.assoc.groupedData).toHaveLength(2);
    expect(v.assoc.counts.total.total).toBe(1);
    // finemapped: two groups, and total is the plain group count (beta===0 included)
    expect(v.finemapped.groupedData).toHaveLength(2);
    expect(v.finemapped.counts.total.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// changePlaceholderPhenostring (via filterRows): rewrites an is_na placeholder's
// phenostring based on the p threshold and whether a phenotype is selected
// ---------------------------------------------------------------------------

describe("changePlaceholderPhenostring (via filterRows)", () => {
  it("rewrites an is_na placeholder's phenostring to the 'No p < {p} associations' text (p < 1, no selected pheno)", () => {
    // filterRows calls changePlaceholderPhenostring when the first surviving assoc
    // record's pheno is_na. with p < 1 and no selected pheno the code (munge.ts:336-339)
    // writes "No p < {p} associations" onto the pheno object.
    const naPheno = makePheno({ phenocode: "NA", phenostring: "original", is_na: true });
    const phenos = { "FG:NA": naPheno };
    const variant = makeVariant({
      assoc: {
        data: [makeAssoc({ phenocode: "NA", beta: 0, mlog10p: 0 })],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos });
    const out = filterRows(
      data,
      allDataTypes,
      allGwasTypes,
      allQtlTypes,
      1,
      0.01, // p < 1 branch
      0,
      undefined,
      true
    );
    const rewritten =
      out.data[0].assoc.data[0].resource + ":" + out.data[0].assoc.data[0].phenocode;
    expect(out.phenos[rewritten].phenostring).toBe("No p < 0.01 associations");
  });
});

// ---------------------------------------------------------------------------
// summarizePhenotypes: consistent / opposite direction counts vs the variant's input beta
// ---------------------------------------------------------------------------

describe("summarizePhenotypes", () => {
  it("counts consistent vs opposite direction relative to the variant input beta and excludes LD records", () => {
    const phenos = { "FG:T2D": makePheno({ phenocode: "T2D" }) };
    const variant = makeVariant({
      beta: 1, // input beta (positive)
      assoc: {
        data: [
          makeAssoc({ phenocode: "T2D", beta: 0.5 }), // consistent (same sign)
          makeAssoc({ phenocode: "T2D", beta: -0.5 }), // opposite
          makeAssoc({ phenocode: "T2D", beta: 0.3, ld: true }), // ld -> excluded entirely
        ],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos });
    const summary = summarizePhenotypes(data);
    expect(summary).toHaveLength(1);
    expect(summary[0].total).toBe(2); // ld record excluded
    expect(summary[0].consistent).toBe(1);
    expect(summary[0].opposite).toBe(1);
  });

  it("counts neither consistent nor opposite when the variant has no input beta", () => {
    // beta_input undefined -> both consistent and opposite stay 0 (current behavior)
    const phenos = { "FG:T2D": makePheno({ phenocode: "T2D" }) };
    const variant = makeVariant({
      beta: undefined,
      assoc: {
        data: [makeAssoc({ phenocode: "T2D", beta: 0.5 })],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const summary = summarizePhenotypes(makeTableData({ data: [variant], phenos }));
    expect(summary[0].consistent).toBe(0);
    expect(summary[0].opposite).toBe(0);
    expect(summary[0].total).toBe(1);
  });

  it("excludes is_na placeholder phenotypes from the summary", () => {
    const phenos = {
      "FG:T2D": makePheno({ phenocode: "T2D" }),
      "FG:NA": makePheno({ phenocode: "NA", is_na: true }),
    };
    const variant = makeVariant({
      beta: 1,
      assoc: {
        data: [
          makeAssoc({ phenocode: "T2D", beta: 0.5 }),
          makeAssoc({ phenocode: "NA", beta: 0.5 }),
        ],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const summary = summarizePhenotypes(makeTableData({ data: [variant], phenos }));
    expect(summary.map((s) => s.pheno.phenocode)).toEqual(["T2D"]);
  });

  it("sorts summary rows by total descending", () => {
    const phenos = {
      "FG:A": makePheno({ phenocode: "A" }),
      "FG:B": makePheno({ phenocode: "B" }),
    };
    const variant = makeVariant({
      beta: 1,
      assoc: {
        data: [
          makeAssoc({ phenocode: "A", beta: 0.5 }),
          makeAssoc({ phenocode: "B", beta: 0.5 }),
          makeAssoc({ phenocode: "B", beta: 0.6 }),
        ],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const summary = summarizePhenotypes(makeTableData({ data: [variant], phenos }));
    expect(summary.map((s) => s.pheno.phenocode)).toEqual(["B", "A"]);
  });
});

// ---------------------------------------------------------------------------
// summarizeTissues: tissue grouping limited to ge/leafcutter/aptamer quant methods
// ---------------------------------------------------------------------------

describe("summarizeTissues", () => {
  const makeDataset = (over: Partial<Dataset> = {}): Dataset => ({
    resource: "EQTL",
    data_type: DataType.EQTL,
    dataset_id: "ds",
    study_id: "s",
    study_label: "S",
    sample_group: "sg",
    tissue_id: "t",
    tissue_label: "Blood",
    condition_label: "c",
    sample_size: 100,
    quant_method: "ge",
    ...over,
  });

  it("aggregates qtl associations into tissue counts keyed by tissue_label (ge quant_method)", () => {
    const phenos = {
      "EQTL:E1": makePheno({ phenocode: "E1", resource: "EQTL", data_type: DataType.EQTL }),
    };
    const datasets = { blood_ge: makeDataset({ tissue_label: "Blood", quant_method: "ge" }) };
    const variant = makeVariant({
      variant: "1-100-A-G",
      assoc: {
        data: [
          makeAssoc({
            phenocode: "E1",
            resource: "EQTL",
            dataset: "blood_ge",
            data_type: DataType.EQTL,
            mlog10p: 10,
          }),
        ],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos, datasets });
    const tissues = summarizeTissues(data);
    expect(tissues).toHaveLength(1);
    expect(tissues[0].tissue).toBe("Blood");
    expect(tissues[0].total).toBe(1);
  });

  it("skips datasets whose quant_method is not ge/leafcutter/aptamer (current behavior)", () => {
    // a dataset present in data.datasets but with an unsupported quant_method is dropped
    const phenos = {
      "EQTL:E1": makePheno({ phenocode: "E1", resource: "EQTL", data_type: DataType.EQTL }),
    };
    const datasets = { other: makeDataset({ tissue_label: "Other", quant_method: "tx" }) };
    const variant = makeVariant({
      assoc: {
        data: [
          makeAssoc({
            phenocode: "E1",
            resource: "EQTL",
            dataset: "other",
            data_type: DataType.EQTL,
            mlog10p: 10,
          }),
        ],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos, datasets });
    expect(summarizeTissues(data)).toHaveLength(0);
  });

  it("falls back to the dataset id as the tissue label when the dataset is not in data.datasets (current behavior)", () => {
    // datasets map empty -> the guard "data.datasets[a.dataset] && ..." short-circuits false,
    // so the record is NOT skipped, and tissue_label defaults to a.dataset
    const phenos = {
      "EQTL:E1": makePheno({ phenocode: "E1", resource: "EQTL", data_type: DataType.EQTL }),
    };
    const variant = makeVariant({
      assoc: {
        data: [
          makeAssoc({
            phenocode: "E1",
            resource: "EQTL",
            dataset: "FG_unmapped",
            data_type: DataType.EQTL,
            mlog10p: 10,
          }),
        ],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos, datasets: {} });
    const tissues = summarizeTissues(data);
    expect(tissues).toHaveLength(1);
    expect(tissues[0].tissue).toBe("FG_unmapped");
  });

  it("dedupes the same variant within a tissue (counts variants, not records)", () => {
    const phenos = {
      "EQTL:E1": makePheno({ phenocode: "E1", resource: "EQTL", data_type: DataType.EQTL }),
      "EQTL:E2": makePheno({ phenocode: "E2", resource: "EQTL", data_type: DataType.EQTL }),
    };
    const datasets = { blood_ge: makeDataset({ tissue_label: "Blood", quant_method: "ge" }) };
    const variant = makeVariant({
      variant: "1-100-A-G",
      assoc: {
        data: [
          makeAssoc({
            phenocode: "E1",
            resource: "EQTL",
            dataset: "blood_ge",
            data_type: DataType.EQTL,
            mlog10p: 10,
          }),
          makeAssoc({
            phenocode: "E2",
            resource: "EQTL",
            dataset: "blood_ge",
            data_type: DataType.EQTL,
            mlog10p: 10,
          }),
        ],
        groupedData: [],
        counts: {} as VariantRecord["assoc"]["counts"],
        resources: [],
      },
    });
    const data = makeTableData({ data: [variant], phenos, datasets });
    const tissues = summarizeTissues(data);
    expect(tissues).toHaveLength(1);
    // two qtl records for the SAME variant in the SAME tissue -> counted once
    expect(tissues[0].total).toBe(1);
  });
});
