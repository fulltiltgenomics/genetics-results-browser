import { describe, expect, it } from "vitest";
import {
  buildGeneBurdenRows,
  buildGtexExpressionRows,
  buildHpaExpressionRows,
} from "./geneEvidenceExport";
import { GeneBurdenRow, GeneExpressionRow } from "@/types/types.normalized";

const burdenRow = (over: Partial<GeneBurdenRow> = {}): GeneBurdenRow => ({
  dataset: "IBD_exome",
  trait: "crohns_disease",
  gene: "APOE",
  geneId: "ENSG00000130203",
  annotation: "pLoF",
  mlog10pBurden: 6.28,
  beta: -0.0028,
  se: 0.0005,
  totalVariants: 223,
  totalVariantsPheno: 211,
  nCases: 512657,
  nControls: 478363,
  traitOriginal: "crohns_disease",
  flags: "NA",
  ...over,
});

const expressionRow = (over: Partial<GeneExpressionRow> = {}): GeneExpressionRow => ({
  resource: "gtex",
  version: "v10",
  dataset: "GTEx_v10",
  geneName: "APOE",
  geneId: "ENSG00000130203.10",
  tissueCell: "heart_atrial_appendage",
  level: 94.7488,
  levelRaw: "94.7488",
  ...over,
});

describe("buildGeneBurdenRows", () => {
  it("emits the displayed labels plus mlog10p behind the formatted p-value", () => {
    expect(buildGeneBurdenRows([burdenRow()])[0]).toEqual({
      gene: "APOE",
      gene_id: "ENSG00000130203",
      trait: "crohns disease",
      trait_original: "crohns_disease",
      dataset: "IBD exome",
      annotation: "pLoF",
      "p-value": "5.25e-7",
      mlog10p: 6.28,
      beta: -0.0028,
      se: 0.0005,
      total_variants: 223,
      n_cases: 512657,
      n_controls: 478363,
    });
  });

  it("writes NA for absent numbers", () => {
    const row = buildGeneBurdenRows([burdenRow({ mlog10pBurden: null, nControls: null })])[0];
    expect(row["p-value"]).toBe("NA");
    expect(row.mlog10p).toBe("NA");
    expect(row.n_controls).toBe("NA");
  });
});

describe("buildGtexExpressionRows", () => {
  it("carries the GTEx tissue label and the raw id", () => {
    expect(buildGtexExpressionRows([expressionRow()])[0]).toEqual({
      gene: "APOE",
      gene_id: "ENSG00000130203.10",
      tissue: "Heart - Atrial Appendage",
      tissue_id: "heart_atrial_appendage",
      median_tpm: 94.7488,
      dataset: "GTEx v10",
    });
  });
});

describe("buildHpaExpressionRows", () => {
  it("collapses the organ/tissue/cell id and spaces out the staining level", () => {
    const row = buildHpaExpressionRows([
      expressionRow({
        resource: "hpa",
        dataset: "HPA_24.1",
        tissueCell: "lung|lung|macrophages",
        level: null,
        levelRaw: "Not_detected",
      }),
    ])[0];
    expect(row).toEqual({
      gene: "APOE",
      gene_id: "ENSG00000130203.10",
      tissue_cell: "lung, macrophages",
      tissue_cell_id: "lung|lung|macrophages",
      level: "Not detected",
      dataset: "HPA 24.1",
    });
  });
});
