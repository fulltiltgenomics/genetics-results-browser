import { describe, expect, it } from "vitest";
import {
  buildAffectedGeneList,
  buildAffectingGeneList,
  GeneCSApiRow,
  GeneInRegionApiRow,
  geneModelsFromRegion,
  geneViewTraitCode,
  geneViewTraitName,
  groupCredibleSets,
  mapToDataName,
  needsTraitNameMapping,
  pseudoDataNames,
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

  // the core dataset carries the release inline; pinning one release emptied FG Core when the API
  // moved from R13 to R14, while the meta-analysis datasets must keep their own buckets
  it("maps any FinnGen core release to FG Core without swallowing the meta-analyses", () => {
    expect(mapToDataName("finngen", "FinnGen_R14", "GWAS")).toBe("FinnGen");
    expect(mapToDataName("finngen", "FinnGen_R99", "GWAS")).toBe("FinnGen");
    expect(mapToDataName("finngen_ukbb", "FinnGen_R13_UKBB", "GWAS")).toBe("FinnGen_UKBB");
    expect(mapToDataName("finngen_mvp_ukbb", "FinnGen_R13_MVP_UKBB_labs", "GWAS")).toBe(
      "FinnGen_MVP_UKBB"
    );
  });

  it("maps open targets to its own GWAS bucket", () => {
    expect(mapToDataName("open_targets", "Open_Targets_26.06", "GWAS")).toBe("Open_Targets");
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

  it("drops resources not modelled in the gene-view config", () => {
    expect(mapToDataName("some_new_biobank", "Whatever", "GWAS")).toBeUndefined();
  });
});

describe("groupCredibleSets (new JSON rows -> CSDatum[])", () => {
  const data = groupCredibleSets(cisRows);

  it("groups rows into one CSDatum per resource|dataset|trait=cs_id", () => {
    // every row in the fixture is from a distinct credible set, minus the ones dropped for an
    // unmodelled resource or a non-ge eQTL Catalogue quantification
    const dropped = cisRows.filter(
      (r) =>
        mapToDataName(r.resource, r.dataset, r.data_type) === undefined ||
        (r.resource === "eqtl_catalogue" && !r.trait_original.endsWith("|ge"))
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
    // the phenocode is kept alongside the name so unresolved names can be filled in downstream
    expect(ad.traitOriginal).toBe("G6_ALZHEIMER");
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

  // FinnGen_ATACseq / FinnGen_snRNAseq fine-map every cell type under one dataset id and reuse the
  // cs_id across them, so the cell type has to be part of the grouping key
  it("keeps a peak's cell types apart instead of unioning them into one credible set", () => {
    const row = (cellType: string, pos: number, csSize: number): GeneCSApiRow => ({
      resource: "finngen",
      version: "R14",
      dataset: "FinnGen_ATACseq",
      data_type: "caQTL",
      trait: "chr15-90351711-90352473",
      trait_original: "chr15-90351711-90352473",
      cell_type: cellType,
      chr: 15,
      pos,
      ref: "A",
      alt: "G",
      mlog10p: 12,
      beta: 0.2,
      se: 0.05,
      pip: 0.5,
      cs_id: "chr15-90351711-90352473_2",
      cs_size: csSize,
      cs_min_r2: 0.9,
      aaf: 0.2,
      most_severe: "intron_variant",
      gene_most_severe: "FURIN",
    });
    const grouped = groupCredibleSets([
      row("l1.B", 100, 1),
      row("l1.Mono", 200, 3),
      row("l1.Mono", 300, 3),
    ]);
    expect(grouped.length).toBe(2);
    const single = grouped.find((d) => d.cellType === "l1.B")!;
    // the size-1 set stays size 1: it must not absorb the other cell type's variants
    expect(single.csSize).toBe(1);
    expect(single.variant).toEqual(["15:100:A:G"]);
    const multi = grouped.find((d) => d.cellType === "l1.Mono")!;
    expect(multi.csSize).toBe(3);
    expect(multi.variant.length).toBe(2);
  });

  it("keeps only the ge quantification of eQTL Catalogue", () => {
    const cat = data.filter((d) => d.resource === "eQTL_Catalogue_R7");
    // the fixture has six eqtl_catalogue rows: ge, exon, tx, txrev, microarray and a leafcutter sQTL
    expect(cat.length).toBe(1);
    expect(cat[0].traitOriginal).toBe("ENSG00000104859|ge");
    // the same gene from FinnGen's own eQTL data is unaffected (no quantification suffix there)
    expect(data.some((d) => d.resource === "FinnGen_eQTL" && d.trait === "CLASRP")).toBe(true);
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

describe("geneViewTraitName (credible-set row label)", () => {
  // the API stores phenostrings underscore-separated
  it("turns the underscores in an API-resolved GWAS name back into spaces", () => {
    const cs = makeCS({
      dataType: "GWAS",
      resource: "FinnGen_UKBB",
      trait: "Dementia_in_Alzheimer_disease",
      traitOriginal: "F5_ALZHDEMENT",
    });
    expect(geneViewTraitName(cs)).toBe("Dementia in Alzheimer disease");
  });

  it("names a FinnGen drug trait from the mapping when the API left the ATC code unresolved", () => {
    const cs = makeCS({
      dataType: "GWAS",
      resource: "FinnGen_drugs",
      dataset: "FinnGen_drugs",
      trait: "ATC_C10AA_IRN",
      traitOriginal: "ATC_C10AA_IRN",
    });
    expect(geneViewTraitName(cs)).toBe("ATC C10AA IRN");
    expect(geneViewTraitName(cs, { ATC_C10AA_IRN: "C10AA Hmg coa reductase inhibitors" })).toBe(
      "C10AA Hmg coa reductase inhibitors"
    );
  });

  it("keeps the API name when it resolved one, even if the mapping has a different string", () => {
    const cs = makeCS({
      dataType: "GWAS",
      resource: "FinnGen",
      trait: "Erysipelas",
      traitOriginal: "AB1_ERYSIPELAS_WIDE",
    });
    expect(geneViewTraitName(cs, { AB1_ERYSIPELAS_WIDE: "Erysipelas, including avohilmo" })).toBe(
      "Erysipelas"
    );
  });

  it("labels eQTL Catalogue rows with their tissue, dropping the default naive condition", () => {
    const cs = (cellType: string) =>
      makeCS({
        dataType: "eQTL",
        resource: "eQTL_Catalogue_R7",
        dataset: "QTD000381",
        trait: "NECTIN2",
        traitOriginal: "ENSG00000130202|ge",
        cellType,
      });
    expect(geneViewTraitName(cs("macrophage|Listeria_5h"))).toBe("NECTIN2 macrophage, Listeria 5h");
    expect(geneViewTraitName(cs("brain_(nucleus_accumbens)|naive"))).toBe(
      "NECTIN2 brain (nucleus accumbens)"
    );
    // no cell type available -> the bare gene symbol, never a duplicated one
    expect(geneViewTraitName(cs(""))).toBe("NECTIN2");
  });

  // eQTL Catalogue also serves a few pQTL datasets, which must not pick up the UKB-PPP Olink label
  it("labels eQTL Catalogue pQTL rows by tissue, not by proteomics panel", () => {
    const cs = makeCS({
      dataType: "pQTL",
      resource: "eQTL_Catalogue_R7",
      dataset: "QTD000584",
      trait: "APOE",
      cellType: "plasma|naive",
    });
    expect(geneViewTraitName(cs)).toBe("APOE plasma");
  });

  // a QTL trait is a gene symbol / ATAC peak id, not a GWAS phenocode: never dictionary-resolved
  it("does not look up QTL traits in the phenocode dictionary", () => {
    const cs = makeCS({
      dataType: "pQTL",
      resource: "UKBB_pQTL",
      dataset: "UKB_PPP",
      trait: "APOE",
      traitOriginal: "APOE",
    });
    expect(geneViewTraitName(cs, { APOE: "something else entirely" })).toBe("APOE Olink 3K");
  });

  it("appends the FinnGen platform from the dataset id for pQTL rows", () => {
    expect(
      geneViewTraitName(
        makeCS({ dataType: "pQTL", resource: "FinnGen_pQTL", dataset: "FinnGen_Olink_5K", trait: "PALM" })
      )
    ).toBe("PALM Olink 5K");
  });

  // FinnGen_snRNAseq fine-maps every cell type under the one dataset id, so the assay is the same on
  // every row and only the cell type separates them
  it("labels FinnGen eQTL rows with their cell type, falling back to the assay", () => {
    const cs = (cellType: string | null) =>
      makeCS({
        dataType: "eQTL",
        resource: "FinnGen_eQTL",
        dataset: "FinnGen_snRNAseq",
        trait: "GEMIN7",
        cellType,
      });
    expect(geneViewTraitName(cs("l1.Mono"))).toBe("GEMIN7 l1.Mono");
    expect(geneViewTraitName(cs("l2.CD14_Mono"))).toBe("GEMIN7 l2.CD14 Mono");
    expect(geneViewTraitName(cs(null))).toBe("GEMIN7 snRNAseq");
  });
});

describe("geneViewTraitCode (upstream id shown in the row tooltip)", () => {
  it("gives the QTD sub-dataset for eQTL Catalogue and the GCST accession for Open Targets", () => {
    expect(
      geneViewTraitCode(
        makeCS({ resource: "eQTL_Catalogue_R7", dataset: "QTD000381", trait: "NECTIN2" })
      )
    ).toBe("QTD000381");
    expect(
      geneViewTraitCode(
        makeCS({
          resource: "Open_Targets",
          dataset: "Open_Targets_26.06",
          dataType: "GWAS",
          trait: "Coronary artery disease",
          traitOriginal: "GCST90092977",
        })
      )
    ).toBe("GCST90092977");
  });

  it("has nothing to add for resources whose name already identifies the trait", () => {
    expect(geneViewTraitCode(makeCS({ resource: "FinnGen", dataType: "GWAS" }))).toBeUndefined();
    expect(geneViewTraitCode(makeCS({ resource: "UKBB_pQTL" }))).toBeUndefined();
  });
});

describe("pseudoDataNames (/v1/datasets flags -> gene view dataNames)", () => {
  it("maps flagged resources to their config buckets and ignores the rest", () => {
    const rows = [
      { resource: "finngen_mvp_ukbb", dataType: "gwas", hasPseudoCredibleSets: true },
      { resource: "finngen_ukbb", dataType: "gwas", hasPseudoCredibleSets: true },
      // flagged but not modelled in the gene view config — must not leak in as undefined
      { resource: "covid_hgi", dataType: "gwas", hasPseudoCredibleSets: true },
      { resource: "finngen", dataType: "gwas", hasPseudoCredibleSets: false },
    ];
    expect(pseudoDataNames(rows)).toEqual(new Set(["FinnGen_MVP_UKBB", "FinnGen_UKBB"]));
    expect(pseudoDataNames(undefined)).toEqual(new Set());
  });
});

describe("needsTraitNameMapping (gate on the 2 MB dictionary fetch)", () => {
  it("is true only when a GWAS row arrived with its name unresolved", () => {
    const resolved = makeCS({
      dataType: "GWAS",
      trait: "Dementia",
      traitOriginal: "F5_DEMENTIA",
    });
    const unresolved = makeCS({
      dataType: "GWAS",
      trait: "ATC_J01_IRN",
      traitOriginal: "ATC_J01_IRN",
    });
    // QTL rows legitimately have trait === traitOriginal and must not trigger the fetch
    const qtl = makeCS({ dataType: "pQTL", trait: "APOE", traitOriginal: "APOE" });
    expect(needsTraitNameMapping(undefined)).toBe(false);
    expect(needsTraitNameMapping([resolved, qtl])).toBe(false);
    expect(needsTraitNameMapping([resolved, unresolved])).toBe(true);
  });
});
