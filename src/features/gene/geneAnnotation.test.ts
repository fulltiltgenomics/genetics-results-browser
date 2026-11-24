import { describe, expect, it } from "vitest";
import type { GeneAnnotation } from "../../../bff/geneAnnotationTypes";
import fixture from "@/test/fixtures/gene_annotation.json";
import { chrName, formatSpan, geneLinks, layoutGeneModel } from "./geneAnnotation";

const annotation = fixture as GeneAnnotation;
const ids = { hgncId: "HGNC:613", ensemblId: "ENSG00000130203" };

describe("geneLinks", () => {
  it("builds the gnomAD, ClinGen and UniProt links from their own id types", () => {
    const byLabel = Object.fromEntries(geneLinks(ids, annotation).map((l) => [l.label, l.href]));
    expect(byLabel.gnomAD).toBe(
      "https://gnomad.broadinstitute.org/gene/ENSG00000130203?dataset=gnomad_r4"
    );
    expect(byLabel.CASCADE).toBe("https://cascade.finngen.fi/gene/ENSG00000130203");
    expect(byLabel.ClinGen).toBe("https://search.clinicalgenome.org/kb/genes/HGNC:613");
    expect(byLabel.UniProt).toBe("https://www.uniprot.org/uniprotkb/P02649/entry");
    expect(byLabel.ClinPGx).toBe("https://www.clinpgx.org/gene/PA55");
  });

  it("keeps the id-based links when there is no mygene.info record", () => {
    expect(geneLinks(ids, null).map((l) => l.label)).toEqual([
      "gnomAD",
      "CASCADE",
      "ClinGen",
      "HGNC",
      "Ensembl",
    ]);
  });

  it("gives no link for an id that is missing", () => {
    expect(geneLinks({ hgncId: null, ensemblId: null }, null)).toEqual([]);
  });
});

describe("layoutGeneModel", () => {
  const model = {
    geneName: "G",
    ensg: "",
    chr: "1",
    strand: -1,
    // out of genomic order, as a minus-strand transcript may be listed
    exonStarts: [900, 500, 100],
    exonEnds: [1000, 520, 200],
    cdsStarts: [900, 500, null],
    cdsEnds: [950, 520, null],
  };

  it("orders exons by position and numbers them in transcription order", () => {
    const layout = layoutGeneModel(model);
    expect(layout.start).toBe(100);
    expect(layout.end).toBe(1000);
    expect(layout.exons.map((e) => [e.start, e.number])).toEqual([
      [100, 3],
      [500, 2],
      [900, 1],
    ]);
    expect(layout.exons[0].cds).toBeNull();
    expect(layout.exons[2].cds).toEqual({ start: 900, end: 950 });
  });

  it("numbers a forward-strand gene left to right", () => {
    const layout = layoutGeneModel({ ...model, strand: 1 });
    expect(layout.exons.map((e) => e.number)).toEqual([1, 2, 3]);
  });

  it("puts strand arrows only in introns with room for one", () => {
    const layout = layoutGeneModel({
      ...model,
      exonStarts: [100, 500, 530],
      exonEnds: [200, 520, 1000],
    });
    expect(layout.arrows).toEqual([350]);
  });
});

describe("formatting", () => {
  it("names the sex and mitochondrial chromosomes", () => {
    expect(["1", "23", "24", "26"].map(chrName)).toEqual(["1", "X", "Y", "MT"]);
  });

  it("scales a span to bp, kb or Mb", () => {
    expect([950, 25_408, 2_300_000].map(formatSpan)).toEqual(["950 bp", "25.4 kb", "2.30 Mb"]);
  });
});
