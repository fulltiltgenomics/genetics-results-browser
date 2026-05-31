import { describe, expect, it } from "vitest";
import {
  GeneCSApiRow,
  GeneInRegionApiRow,
  geneModelsFromRegion,
  groupCredibleSets,
  mapToDataName,
} from "./geneCS";

// fixtures captured from the live genetics-results-api (see fixtures/README.md)
import credibleSetsByGene from "../test/fixtures/credible_sets_by_gene.json";
import genesInRegion from "../test/fixtures/genes_in_region.json";

const cisRows = credibleSetsByGene as unknown as GeneCSApiRow[];
const geneRows = genesInRegion as unknown as GeneInRegionApiRow[];

describe("mapToDataName (new resource ids -> legacy config dataName)", () => {
  it("splits the finngen upstream resource by dataset into the legacy GWAS buckets", () => {
    expect(mapToDataName("finngen", "FinnGen_R13", "GWAS")).toBe("FinnGen");
    expect(mapToDataName("finngen", "FinnGen_kanta", "GWAS")).toBe("FinnGen_kanta");
    expect(mapToDataName("finngen", "FinnGen_drugs", "GWAS")).toBe("FinnGen_drugs");
  });

  it("maps QTL datasets/resources to their config buckets", () => {
    expect(mapToDataName("finngen", "FinnGen_Olink", "pQTL")).toBe("FinnGen_pQTL");
    expect(mapToDataName("ukbb", "UKB_PPP", "pQTL")).toBe("UKBB_pQTL");
    expect(mapToDataName("finngen", "FinnGen_snRNAseq", "eQTL")).toBe("FinnGen_eQTL");
    expect(mapToDataName("eqtl_catalogue", "QTD000499", "eQTL")).toBe("eQTL_Catalogue_R7");
  });

  it("maps the combined FinnGen meta-analyses to their own buckets", () => {
    expect(mapToDataName("finngen_mvp_ukbb", "FinnGen_R13_MVP_UKBB", "GWAS")).toBe(
      "FinnGen_MVP_UKBB"
    );
    expect(mapToDataName("finngen_ukbb", "FinnGen_R13_UKBB", "GWAS")).toBe("FinnGen_UKBB");
  });

  it("drops resources not modelled in the gene-view config (e.g. open_targets, finngen caQTL)", () => {
    expect(mapToDataName("open_targets", "Open_Targets_25.12", "GWAS")).toBeUndefined();
    expect(mapToDataName("finngen", "FinnGen_ATACseq", "caQTL")).toBeUndefined();
  });
});

describe("groupCredibleSets (new JSON rows -> CSDatum[])", () => {
  const data = groupCredibleSets(cisRows);

  it("groups rows into one CSDatum per resource|dataset|trait=cs_id", () => {
    // every row in the fixture is from a distinct credible set, minus the dropped caQTL row
    const dropped = cisRows.filter(
      (r) => mapToDataName(r.resource, r.dataset, r.data_type) === undefined
    );
    expect(data.length).toBe(cisRows.length - dropped.length);
    for (const d of data) {
      expect(d.traitCSId).toBe(`${d.traitId}=${d.csId}`);
      expect(d.variant.length).toBeGreaterThan(0);
      // all member arrays stay parallel
      expect(d.pos.length).toBe(d.variant.length);
      expect(d.pip.length).toBe(d.variant.length);
      expect(d.isCoding.length).toBe(d.variant.length);
    }
  });

  it("rewrites resource to the legacy dataName and maps the renamed fields", () => {
    const ad = data.find((d) => d.trait === "Alzheimer_disease")!;
    expect(ad.resource).toBe("FinnGen_UKBB"); // finngen_ukbb -> config dataName
    expect(ad.dataType).toBe("GWAS");
    expect(ad.variant[0]).toBe("19:45039089:T:A");
    // aaf -> af (string), most_severe kept verbatim, rsid not provided
    expect(ad.af[0]).toBe("0.00131189");
    expect(ad.consequence[0]).toBe("5_prime_UTR_variant");
    expect(ad.rsid[0]).toBe("NA");
    // gene_most_severe -> gene
    expect(ad.gene[0]).toBe("CLASRP");
  });

  it("strips the _variant suffix before classifying coding/LoF", () => {
    // intron_variant is neither coding nor LoF; a real coding example would flip these
    const intron = data.find((d) => d.consequence[0] === "intron_variant")!;
    expect(intron.isCoding[0]).toBe(false);
    expect(intron.isLoF[0]).toBe(false);
  });

  it("derives csNumber from the cs_id trailing index, defaulting to 1", () => {
    // ENSG00000104859_L1 -> 1 ; chr19_45039089_T_A (no trailing _N) -> default 1
    const eqtl = data.find((d) => d.csId === "ENSG00000104859_L1")!;
    expect(eqtl.csNumber).toBe(1);
    const ad = data.find((d) => d.csId === "chr19_45039089_T_A")!;
    expect(ad.csNumber).toBe(1);
  });

  it("does not emit the unmapped finngen caQTL row", () => {
    expect(data.some((d) => d.dataType === "caQTL")).toBe(false);
  });
});

describe("geneModelsFromRegion (genes_in_region -> GeneModel[])", () => {
  const models = geneModelsFromRegion(geneRows);

  it("models each gene body as a single full-length exon (no exon detail)", () => {
    expect(models.length).toBe(geneRows.length);
    for (const m of models) {
      expect(m.exonStarts.length).toBe(1);
      expect(m.exonEnds.length).toBe(1);
      expect(m.exonEnds[0]).toBeGreaterThanOrEqual(m.exonStarts[0]);
    }
  });

  it("prefers the hgnc symbol and decodes the strand", () => {
    const apoe = models.find((m) => m.geneName === "APOE");
    expect(apoe).toBeDefined();
    expect([1, -1]).toContain(apoe!.strand);
  });
});
