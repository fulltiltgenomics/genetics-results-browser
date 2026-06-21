import { describe, it, expect } from "vitest";
import { generateCsv, mkConfig } from "export-to-csv";
import {
  buildCredibleSetRows,
  buildDataTypeRows,
  buildPhenoBetaGridRows,
  buildPhenotypeSearchRows,
  buildPhenotypeSummaryRows,
  buildTissueSummaryRows,
  buildTissueWithVariantsRows,
  buildVariantMainRows,
  ExportRow,
} from "./export";
import {
  CredibleSetMembership,
  DataTypeSummaryRow,
  GnomadFreq,
  PhenoSearchRow,
  PhenoSummaryRow,
  TissueSummaryRow,
  VariantResult,
} from "../../../types/types.normalized";

// the exports build straight from typed normalized data, so the builders are pure and testable
// without a browser download. these lock the TSV column set / values and the tab-separated rendering.

const makeCS = (over: Partial<CredibleSetMembership> = {}): CredibleSetMembership => ({
  resource: "finngen",
  version: "R12",
  dataset: "FinnGen_kanta",
  dataType: "GWAS",
  trait: "T2D",
  traitOriginal: "T2D_ORIG",
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
  pip: 0.9,
  aaf: 0.2,
  mostSevere: "missense_variant",
  geneMostSevere: "APOE",
  ...over,
});

const gnomad: GnomadFreq = {
  variant: "19:44908684:T:C",
  afOverall: 0.18,
  byPop: { fin: 0.3, nfe: 0.15 },
};

const makeVariant = (over: Partial<VariantResult> = {}): VariantResult => ({
  variant: "19:44908684:T:C",
  annotation: {
    rsid: "rs429358",
    consequence: "missense_variant",
    isCoding: true,
    isLoF: false,
    gene: "APOE",
    af: 0.18,
  },
  gnomad,
  credibleSets: [makeCS()],
  ...over,
});

const traitName = (_resource: string, trait: string) => (trait === "T2D" ? "Type 2 diabetes" : trait);

// render rows the exact way writeTsv does, so the test also covers the tab separator + header row.
const toTsv = (rows: ExportRow[]): string => {
  const cfg = mkConfig({
    fieldSeparator: "\t",
    quoteStrings: false,
    decimalSeparator: ".",
    useBom: false,
    useKeysAsHeaders: true,
    useTextFile: true,
  });
  return generateCsv(cfg)(rows) as unknown as string;
};

describe("buildVariantMainRows", () => {
  it("emits one row per variant with identity + top-association columns", () => {
    const rows = buildVariantMainRows([makeVariant()], undefined, traitName, true, false, false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      variant: "19:44908684:T:C",
      rsid: "rs429358",
      global_af: 0.18,
      most_severe: "missense",
      most_severe_gene: "APOE",
      traits: 1,
      traits_up: 1,
      traits_down: 0,
      top_association: "Type 2 diabetes",
      beta: 0.5,
    });
    // p-value is rendered, not raw mlog10p
    expect(String(rows[0]["p-value"])).toMatch(/e-/);
  });

  it("uses the selected population AF column header and value", () => {
    const rows = buildVariantMainRows([makeVariant()], "fin", traitName, false, false, false);
    expect(rows[0].fin_af).toBe(0.3);
    expect(rows[0].global_af).toBeUndefined();
  });

  it("adds my_beta / my_value only when present", () => {
    const v = makeVariant({ beta: -0.4, value: "cat" });
    const rows = buildVariantMainRows([v], undefined, traitName, false, true, true);
    expect(rows[0].my_beta).toBe(-0.4);
    expect(rows[0].my_value).toBe("cat");
  });

  it("renders as a tab-separated file with a header row", () => {
    const tsv = toTsv(buildVariantMainRows([makeVariant()], undefined, traitName, false, false, false));
    const lines = tsv.trim().replace(/\r/g, "").split("\n");
    expect(lines[0].split("\t")).toEqual([
      "variant",
      "rsid",
      "global_af",
      "most_severe",
      "most_severe_gene",
      "top_association",
      "p-value",
      "beta",
    ]);
    expect(lines[1].split("\t")[0]).toBe("19:44908684:T:C");
  });
});

describe("buildCredibleSetRows", () => {
  it("flattens to one row per membership with stats", () => {
    const v = makeVariant({
      credibleSets: [
        makeCS({ trait: "T2D", beta: 0.5 }),
        makeCS({ dataType: "eQTL", trait: "APOE", cellType: "blood", dataset: "QTD1", mlog10p: 8 }),
      ],
    });
    const rows = buildCredibleSetRows([v], undefined, traitName, 1.5);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      variant: "19:44908684:T:C",
      type: "GWAS",
      resource: "finngen",
      dataset: "FinnGen_kanta",
      trait: "Type 2 diabetes",
      trait_id: "T2D",
      cell_type: "NA",
      beta: 0.5,
      pip: 0.9,
      cs_size: 5,
      cs_min_r2: 0.8,
    });
    // GWAS is not cis/trans-classifiable
    expect(rows[0].cis_trans).toBe("NA");
    expect(rows[1]).toMatchObject({ type: "eQTL", trait: "APOE", cell_type: "blood" });
  });

  it("null mlog10p renders the p-value as NA", () => {
    const v = makeVariant({ credibleSets: [makeCS({ mlog10p: null })] });
    const rows = buildCredibleSetRows([v], undefined, traitName, 1.5);
    expect(rows[0]["p-value"]).toBe("NA");
  });
});

describe("buildDataTypeRows", () => {
  it("emits a count column per data type plus total", () => {
    const summary: DataTypeSummaryRow[] = [
      {
        variant: "19:44908684:T:C",
        rsid: "rs429358",
        consequence: "missense_variant",
        gene: "APOE",
        gnomad,
        counts: { GWAS: 2, eQTL: 1 },
        total: 3,
      },
    ];
    const rows = buildDataTypeRows(summary, undefined);
    expect(rows[0]).toMatchObject({
      variant: "19:44908684:T:C",
      most_severe: "missense",
      GWAS_CS: 2,
      eQTL_CS: 1,
      pQTL_CS: 0,
      sQTL_CS: 0,
      caQTL_CS: 0,
      total_CS: 3,
    });
  });
});

describe("buildPhenotypeSummaryRows", () => {
  const row: PhenoSummaryRow = {
    resource: "finngen",
    dataType: "GWAS",
    trait: "T2D",
    traitOriginal: "T2D_ORIG",
    dataset: "FinnGen_kanta",
    phenostring: "Type_2_diabetes",
    variantCount: 3,
    variants: ["a", "b", "c"],
    consistentCount: 2,
    oppositeCount: 1,
  };

  it("formats trait, omits direction counts without betas", () => {
    const rows = buildPhenotypeSummaryRows([row], false);
    expect(rows[0]).toMatchObject({
      type: "GWAS",
      resource: "finngen",
      trait: "Type 2 diabetes",
      variants: 3,
    });
    expect(rows[0].consistent).toBeUndefined();
  });

  it("includes direction counts with betas", () => {
    const rows = buildPhenotypeSummaryRows([row], true);
    expect(rows[0]).toMatchObject({ consistent: 2, opposite: 1 });
  });

  it("caQTL shows linked genes and the peak", () => {
    const caqtl: PhenoSummaryRow = {
      ...row,
      dataType: "caQTL",
      trait: "chr19-44906317-44906816",
      phenostring: "chr19-44906317-44906816",
      linkedGenes: ["APOE", "TOMM40"],
      peak: "chr19-44906317-44906816",
    };
    const rows = buildPhenotypeSummaryRows([caqtl], false);
    expect(rows[0].trait).toBe("APOE, TOMM40");
    expect(rows[0].peak).toBe("chr19-44906317-44906816");
  });
});

describe("buildPhenoBetaGridRows", () => {
  it("builds a trait x variant beta matrix, NA when absent, sorted by coverage", () => {
    const v1 = makeVariant({
      variant: "19:1:A:T",
      credibleSets: [makeCS({ resource: "finngen", trait: "T2D", beta: 0.5 })],
    });
    const v2 = makeVariant({
      variant: "19:2:A:T",
      credibleSets: [
        makeCS({ resource: "finngen", trait: "T2D", beta: -0.3 }),
        makeCS({ resource: "finngen", trait: "LDL", beta: 0.7 }),
      ],
    });
    const rows = buildPhenoBetaGridRows(
      [v1, v2],
      { "finngen|T2D": { phenostring: "Type 2 diabetes" } as never }
    );
    // T2D covers both variants -> sorts first; LDL covers one
    expect(rows[0].phenotype).toBe("finngen:T2D_ORIG:Type 2 diabetes");
    expect(rows[0]["19:1:A:T"]).toBe(0.5);
    expect(rows[0]["19:2:A:T"]).toBe(-0.3);
    expect(rows[1]["19:1:A:T"]).toBe("NA");
    expect(rows[1]["19:2:A:T"]).toBe(0.7);
  });
});

describe("tissue exports", () => {
  it("buildTissueSummaryRows formats the tissue label", () => {
    const summary: TissueSummaryRow[] = [
      { tissueOrCellType: "tibial_nerve|naive", dataType: "eQTL", variantCount: 4, variants: [] },
    ];
    expect(buildTissueSummaryRows(summary)[0]).toEqual({
      tissue: "tibial nerve, naive",
      type: "eQTL",
      variants: 4,
    });
  });

  it("buildTissueWithVariantsRows flattens only the chosen data type with a cell type", () => {
    const v = makeVariant({
      credibleSets: [
        makeCS({ dataType: "eQTL", trait: "APOE", cellType: "blood", dataset: "QTD1" }),
        makeCS({ dataType: "GWAS", cellType: null }), // skipped: wrong type / no cell
        makeCS({ dataType: "caQTL", cellType: "PBMC" }), // skipped: wrong type
      ],
    });
    const rows = buildTissueWithVariantsRows([v], "eQTL", undefined, traitName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tissue: "blood",
      variant: "19:44908684:T:C",
      type: "eQTL",
      dataset: "QTD1",
      trait: "APOE",
      beta: 0.5,
      pip: 0.9,
    });
  });
});

describe("buildPhenotypeSearchRows", () => {
  it("renders p-value, yes/no membership, NA for missing", () => {
    const searchRows: PhenoSearchRow[] = [
      {
        variant: "19:1:A:T",
        rsid: "rs1",
        gene: "APOE",
        consequence: "missense_variant",
        pval: 1e-8,
        mlog10p: 8,
        beta: 0.4,
        se: 0.1,
        af: 0.2,
        inCredibleSet: true,
        pip: 0.95,
      },
      {
        variant: "19:2:A:T",
        rsid: null,
        gene: null,
        consequence: "",
        pval: 0.5,
        mlog10p: NaN,
        beta: NaN,
        se: NaN,
        af: null,
        inCredibleSet: false,
      },
    ];
    const rows = buildPhenotypeSearchRows(searchRows);
    expect(rows[0]).toMatchObject({
      variant: "19:1:A:T",
      most_severe: "missense",
      in_credible_set: "yes",
      pip: 0.95,
      beta: 0.4,
    });
    expect(rows[1]).toMatchObject({
      rsid: "NA",
      most_severe: "NA",
      "p-value": "NA",
      beta: "NA",
      se: "NA",
      af: "NA",
      in_credible_set: "no",
      pip: "NA",
    });
  });
});
