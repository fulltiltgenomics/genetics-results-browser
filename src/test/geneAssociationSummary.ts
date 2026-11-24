import { datasetLookups } from "../../bff/geneAssociationRoute";
import { buildGeneAssociationSummary, TraitMeta } from "../../bff/geneAssociationSummary";
import type { RawDataset } from "../../bff/normalize";
import datasets from "./fixtures/datasets.json";

/**
 * A /v1/gene_association response for tests, built by the BFF's own code from one-row-per-member
 * credible-set rows, so a test's fixture cannot drift from the shape the route serves.
 */

export type MemberRow = Record<string, string | number | null>;

export const memberRow = (over: MemberRow = {}): MemberRow => ({
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

export const summaryOf = (
  rows: MemberRow[],
  {
    gene = "APOE",
    window = 0,
    traitMeta = {},
  }: { gene?: string; window?: number; traitMeta?: Record<string, Record<string, TraitMeta>> } = {}
) =>
  buildGeneAssociationSummary(
    gene,
    window,
    // the BFF reads the API's TSV, where every value is text
    rows.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? null : String(v)]))
    ),
    {
      traitMeta: new Map(
        Object.entries(traitMeta).map(([resource, traits]) => [
          resource,
          new Map(Object.entries(traits)),
        ])
      ),
      ...datasetLookups(datasets as unknown as RawDataset[]),
    }
  );
