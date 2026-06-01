import { describe, expect, it } from "vitest";
import {
  buildAffectedGeneList,
  buildAffectingGeneList,
  GeneCSApiRow,
  GeneInRegionApiRow,
  geneModelsFromRegion,
  groupCredibleSets,
  mapToDataName,
} from "./geneCS";
import { CSDatum } from "@/types/types.gene";

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
    // finngen caQTL gets its own bucket so the gene-view plot surfaces it instead of dropping it
    expect(mapToDataName("finngen", "FinnGen_ATACseq", "caQTL")).toBe("FinnGen_caQTL");
  });

  it("maps the combined FinnGen meta-analyses to their own buckets", () => {
    expect(mapToDataName("finngen_mvp_ukbb", "FinnGen_R13_MVP_UKBB", "GWAS")).toBe(
      "FinnGen_MVP_UKBB"
    );
    expect(mapToDataName("finngen_ukbb", "FinnGen_R13_UKBB", "GWAS")).toBe("FinnGen_UKBB");
  });

  it("drops resources not modelled in the gene-view config (e.g. open_targets)", () => {
    expect(mapToDataName("open_targets", "Open_Targets_25.12", "GWAS")).toBeUndefined();
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

  it("emits finngen caQTL rows under the FinnGen_caQTL bucket (peak-id trait kept verbatim)", () => {
    const ca = data.find((d) => d.dataType === "caQTL");
    expect(ca).toBeDefined();
    expect(ca!.resource).toBe("FinnGen_caQTL");
    // trait is an ATAC peak id, not a gene symbol
    expect(ca!.trait).toMatch(/^chr/);
  });
});

// minimal CSDatum builder: only the fields the two list builders read matter
const makeCS = (over: Partial<CSDatum>): CSDatum => ({
  resource: "FinnGen_pQTL",
  dataset: "FinnGen_Olink",
  dataType: "pQTL",
  trait: "TRAIT",
  traitId: "FinnGen_pQTL|FinnGen_Olink|TRAIT",
  chr: "1",
  variant: ["1:100:A:T"],
  pos: [100],
  pip: [0.9],
  mlog10p: [20],
  beta: [0.5],
  se: [0.1],
  csId: "L1",
  traitCSId: "FinnGen_pQTL|FinnGen_Olink|TRAIT=L1",
  csNumber: 1,
  numberOfCSs: 1,
  csSize: 1,
  csMinR2: 0.9,
  consequence: ["missense"],
  isCoding: [false],
  isLoF: [false],
  af: ["0.1"],
  gene: ["GENEA"],
  rsid: ["NA"],
  ...over,
});

const NO_FILTER = { maxCsSize: 50, minLeadMlog10p: 10, codingOnly: false };

describe("buildAffectedGeneList (cis: variants in input gene affect other genes)", () => {
  it("groups pQTL CSs whose variants sit in the input gene, keyed by the affected trait gene", () => {
    const cis = [
      // pQTL on protein FOO with a variant annotated to the input gene APOE -> APOE affects FOO
      makeCS({ trait: "FOO", traitCSId: "k1", gene: ["APOE"] }),
      // a second affected gene BAR
      makeCS({ trait: "BAR", traitCSId: "k2", gene: ["APOE"] }),
      // pQTL whose variants are NOT in APOE -> excluded
      makeCS({ trait: "BAZ", traitCSId: "k3", gene: ["OTHER"] }),
      // non-pQTL (GWAS) in APOE -> excluded (list is pQTL-only)
      makeCS({ trait: "QUX", traitCSId: "k4", gene: ["APOE"], dataType: "GWAS" }),
    ];
    const res = buildAffectedGeneList(cis, "APOE", NO_FILTER);
    expect(Object.keys(res).sort()).toEqual(["BAR", "FOO"]);
    expect(res.FOO).toHaveLength(1);
  });

  it("matches the input gene case-insensitively and dedupes a CS counted via multiple variants", () => {
    const cis = [
      makeCS({ trait: "FOO", traitCSId: "k1", gene: ["apoe", "APOE"] }),
    ];
    const res = buildAffectedGeneList(cis, "APOE", NO_FILTER);
    expect(res.FOO).toHaveLength(1);
  });

  it("applies the quality gate (lead mlog10p, csSize, has variants)", () => {
    const cis = [
      makeCS({ trait: "FOO", traitCSId: "k1", gene: ["APOE"], mlog10p: [3] }), // below threshold
      makeCS({ trait: "BAR", traitCSId: "k2", gene: ["APOE"], csSize: 999 }), // too large
      makeCS({ trait: "BAZ", traitCSId: "k3", gene: ["APOE"], mlog10p: [50] }), // passes
    ];
    const res = buildAffectedGeneList(cis, "APOE", NO_FILTER);
    expect(Object.keys(res)).toEqual(["BAZ"]);
  });

  it("codingOnly keeps only CSs with at least one coding variant", () => {
    const cis = [
      makeCS({ trait: "FOO", traitCSId: "k1", gene: ["APOE"], isCoding: [false] }),
      makeCS({ trait: "BAR", traitCSId: "k2", gene: ["APOE"], isCoding: [true] }),
    ];
    const res = buildAffectedGeneList(cis, "APOE", { ...NO_FILTER, codingOnly: true });
    expect(Object.keys(res)).toEqual(["BAR"]);
  });
});

describe("buildAffectingGeneList (trans: variants in other genes affect input gene)", () => {
  it("groups each pQTL CS under every (non-NA) gene its variants are annotated to", () => {
    const trans = [
      makeCS({ traitCSId: "k1", gene: ["GENEA", "GENEB"], isCoding: [false, false] }),
      makeCS({ traitCSId: "k2", gene: ["GENEA", "NA"], isCoding: [false, false] }),
    ];
    const res = buildAffectingGeneList(trans, NO_FILTER);
    expect(Object.keys(res).sort()).toEqual(["GENEA", "GENEB"]);
    // GENEA appears in two distinct CSs -> grouped under both
    expect(res.GENEA).toHaveLength(2);
    expect(res.GENEB).toHaveLength(1);
  });

  it("dedupes the same (gene, CS) pair and excludes the NA placeholder gene", () => {
    const trans = [makeCS({ traitCSId: "k1", gene: ["GENEA", "GENEA", "NA"], isCoding: [false, false, false] })];
    const res = buildAffectingGeneList(trans, NO_FILTER);
    expect(res.GENEA).toHaveLength(1);
    expect(res.NA).toBeUndefined();
  });

  it("excludes non-pQTL CSs and applies the quality gate", () => {
    const trans = [
      makeCS({ traitCSId: "k1", gene: ["GENEA"], dataType: "eQTL" }),
      makeCS({ traitCSId: "k2", gene: ["GENEB"], mlog10p: [1] }),
      makeCS({ traitCSId: "k3", gene: ["GENEC"] }),
    ];
    const res = buildAffectingGeneList(trans, NO_FILTER);
    expect(Object.keys(res)).toEqual(["GENEC"]);
  });

  it("codingOnly filters per-variant: a gene qualifies only via a coding variant", () => {
    const trans = [
      makeCS({ traitCSId: "k1", gene: ["GENEA", "GENEB"], isCoding: [true, false] }),
    ];
    const res = buildAffectingGeneList(trans, { ...NO_FILTER, codingOnly: true });
    expect(Object.keys(res)).toEqual(["GENEA"]);
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
