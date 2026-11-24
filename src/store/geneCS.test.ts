import { describe, expect, it } from "vitest";
import { GeneInRegionApiRow, geneModelsFromRegion } from "./geneCS";

// fixture captured from the live genetics-results-api (see fixtures/README.md)
import genesInRegion from "../test/fixtures/genes_in_region.json";

const geneRows = genesInRegion as unknown as GeneInRegionApiRow[];

describe("geneModelsFromRegion (genes_in_region -> GeneModel[])", () => {
  const models = geneModelsFromRegion(geneRows);
  const apoe = models.find((m) => m.geneName === "APOE")!;

  it("keeps every exon the API sent, with its coding bounds at the same index", () => {
    expect(models.length).toBe(geneRows.length);
    expect(apoe.exonStarts.length).toBe(4);
    expect(apoe.exonEnds.length).toBe(apoe.exonStarts.length);
    expect(apoe.cdsStarts.length).toBe(apoe.exonStarts.length);
    expect(apoe.cdsEnds.length).toBe(apoe.exonStarts.length);
    // the first exon is entirely 5' UTR, and dropping its empty coding bounds rather than
    // keeping the hole would shift every later exon's CDS onto the wrong exon
    expect(apoe.cdsStarts[0]).toBeNull();
    expect(apoe.cdsStarts[1]).toBe(44906625);
  });

  it("carries the exons alone, so the drawn span is the transcript's", () => {
    // the tracks derive the body from min(exonStarts)..max(exonEnds). there is deliberately no
    // geneStart/geneEnd on the model: a GENCODE gene record spans every transcript it has,
    // and drawing that leaves the exons in a corner of a long bare line
    expect("geneStart" in apoe).toBe(false);
    expect("geneEnd" in apoe).toBe(false);
    expect(Math.min(...apoe.exonStarts)).toBe(44905796);
    expect(Math.max(...apoe.exonEnds)).toBe(44909393);
  });

  it("falls back to one full-length exon for a gene the API sent no exons for", () => {
    // APOC1 carries no exon columns in the fixture: a GENCODE release with no exon file, and
    // a results-api predating them, both look like this. the same min/max then hands the
    // gene record back, which is all there is to draw
    const apoc1 = models.find((m) => m.geneName === "APOC1")!;
    const row = geneRows.find((r) => r.gene_name === "APOC1")!;
    expect(apoc1.exonStarts).toEqual([row.gene_start]);
    expect(apoc1.exonEnds).toEqual([row.gene_end]);
    expect(apoc1.cdsStarts).toEqual([null]);
  });

  it("prefers the hgnc symbol and decodes the strand", () => {
    expect(apoe).toBeDefined();
    expect([1, -1]).toContain(apoe.strand);
  });
});
