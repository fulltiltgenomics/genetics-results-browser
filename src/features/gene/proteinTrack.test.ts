import { describe, expect, it } from "vitest";
import type { CSDatum } from "@/types/types.gene";
import {
  accessionsOf,
  featureTrackRows,
  filePositionsIn,
  indexModel,
  markersOf,
  missenseCandidates,
  ownerRows,
  parseExome,
  parseFeatures,
  parseResidues,
  placeVariants,
  plddtBand,
  plddtRuns,
  trackCredibleSets,
  windowOwning,
  windowsOf,
  type ProteinModel,
  type ResidueRow,
  type VariantMapRow,
} from "./proteinTrack";

const model = (over: Partial<ProteinModel>): ProteinModel => ({
  modelFileId: "AF3-Q8WZ42-F1-model_v6",
  accession: "Q8WZ42",
  geneNames: ["TTN"],
  sourceLabel: "AF3",
  windowIndex: 1,
  nWindows: 3,
  proteinStart: 1,
  proteinEnd: 5000,
  ownedStart: 1,
  ownedEnd: 4400,
  ...over,
});

// the first three of TTN's nine windows, as the release lists them
const TTN = [
  model({ modelFileId: "F2", windowIndex: 2, proteinStart: 3801, proteinEnd: 8800, ownedStart: 4401, ownedEnd: 8200 }),
  model({ modelFileId: "F1" }),
  model({ modelFileId: "F3", windowIndex: 3, proteinStart: 7601, proteinEnd: 12600, ownedStart: 8201, ownedEnd: 12000 }),
];

const residue = (modelFileId: string, filePosition: number, proteinPosition: number, isOwner: boolean, plddt = 80): ResidueRow => ({
  accession: "Q8WZ42",
  modelFileId,
  filePosition,
  proteinPosition,
  residue: "A",
  isOwner,
  plddt,
});

// two windows over ten residues: F1 holds 1-7 and owns 1-5, F2 holds 4-10 and owns 6-10
const TWO_WINDOWS: ResidueRow[] = [
  ...[1, 2, 3, 4, 5, 6, 7].map((p) => residue("F1", p, p, p <= 5)),
  ...[4, 5, 6, 7, 8, 9, 10].map((p) => residue("F2", p - 3, p, p >= 6)),
];

describe("parsing", () => {
  it("reads residue rows by header name and keeps both numberings", () => {
    const text =
      "gene_name\taccession\tmodel_file_id\tfile_position\tprotein_position\tresidue\tis_owner\tplddt\n" +
      "TTN\tQ8WZ42\tF2\t601\t4401\tK\ttrue\t91.5\n" +
      "TTN\tQ8WZ42\tF1\t4401\t4401\tK\tfalse\t40\n";
    expect(parseResidues(text)).toEqual([
      { accession: "Q8WZ42", modelFileId: "F2", filePosition: 601, proteinPosition: 4401, residue: "K", isOwner: true, plddt: 91.5 },
      { accession: "Q8WZ42", modelFileId: "F1", filePosition: 4401, proteinPosition: 4401, residue: "K", isOwner: false, plddt: 40 },
    ]);
    expect(parseResidues("")).toEqual([]);
  });

  it("reads NA in a feature's optional columns as absent", () => {
    const text =
      "accession\tsource\tfeature_type\tstart\tend\tdescription\tevidence\tevidence_tier\n" +
      "P1\tuniprot\tHelix\t4\t20\tNA\tECO:1\tpredicted\n";
    expect(parseFeatures(text)).toEqual([
      { accession: "P1", source: "uniprot", featureType: "Helix", start: 4, end: 20, description: null, evidenceTier: "predicted" },
    ]);
  });

  it("spells an exome row's variant the way the credible sets and the map do", () => {
    const text = "dataset\tchr\tpos\tref\talt\tgene\tannotation\tmlog10p\ttrait\ngenebass\t11\t116830844\tG\tA\tAPOC3\tmissense\t5.2e+00\tTG\n";
    expect(parseExome(text)[0]).toMatchObject({ variant: "11:116830844:G:A", gene: "APOC3", mlog10p: 5.2 });
  });
});

describe("windows and owner rows", () => {
  it("orders an accession's windows and keeps another accession's out", () => {
    const models = [...TTN, model({ modelFileId: "X1", accession: "O95467" })];
    expect(accessionsOf(models)).toEqual(["Q8WZ42", "O95467"]);
    expect(windowsOf(models, "Q8WZ42").map((w) => w.modelFileId)).toEqual(["F1", "F2", "F3"]);
  });

  it("shows a residue in the window that owns it, not merely one that holds it", () => {
    const windows = windowsOf(TTN, "Q8WZ42");
    // 4000 is inside F2's file (from 3801) and owned by F1; 4401 is the first F2 owns
    expect(windowOwning(windows, 4000)?.modelFileId).toBe("F1");
    expect(windowOwning(windows, 4401)?.modelFileId).toBe("F2");
    expect(windowOwning(windows, 8200)?.modelFileId).toBe("F2");
    expect(windowOwning(windows, 12001)?.modelFileId).toBe("F3");
    expect(windowOwning(windows, 99999)).toBeUndefined();
  });

  it("spans the protein with each position once", () => {
    const owners = ownerRows(TWO_WINDOWS, "Q8WZ42");
    expect(owners.map((r) => r.proteinPosition)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(owners.map((r) => r.modelFileId)).toEqual(["F1", "F1", "F1", "F1", "F1", "F2", "F2", "F2", "F2", "F2"]);
    expect(ownerRows(TWO_WINDOWS, "OTHER")).toEqual([]);
  });

  it("maps a protein range to one model's file positions and counts what that model lacks", () => {
    const f2 = indexModel(TWO_WINDOWS, "F2");
    // F2 numbers its own residues from 1: protein 4 is file 1
    expect(filePositionsIn(f2, 6, 8)).toEqual({ positions: [3, 4, 5], outside: 0 });
    expect(filePositionsIn(f2, 2, 5)).toEqual({ positions: [1, 2], outside: 2 });
    expect(f2.byFile.get(3)?.proteinPosition).toBe(6);
    expect(indexModel(TWO_WINDOWS, "F1").byFile.get(3)?.proteinPosition).toBe(3);
  });
});

const cs = (over: Partial<CSDatum>): CSDatum =>
  ({
    traitCSId: "t=cs1",
    resource: "FinnGen",
    dataType: "GWAS",
    trait: "T2D",
    csSize: 3,
    mlog10p: [12],
    variant: [],
    consequence: [],
    gene: [],
    pip: [],
    ...over,
  }) as CSDatum;

describe("variant placement", () => {
  const credibleSets = [
    cs({
      traitCSId: "a",
      variant: ["11:1:G:A", "11:2:C:T", "11:3:A:G", "11:9:C:G"],
      consequence: ["missense_variant", "intron_variant", "missense_variant", "missense_variant"],
      gene: ["APOC3", "APOC3", "APOA1", "APOC3"],
      pip: [0.4, 0.9, 0.9, 0.1],
    }),
    cs({ traitCSId: "b", variant: ["11:1:G:A"], consequence: ["missense_variant"], gene: ["APOC3"], pip: [0.7] }),
  ];
  const exome = [
    { variant: "11:1:G:A", gene: "APOC3", annotation: "missense", dataset: "genebass", trait: "TG", mlog10p: 30 },
    { variant: "11:1:G:A", gene: "APOC3", annotation: "missense", dataset: "genebass", trait: "HDL", mlog10p: 12 },
    { variant: "11:5:G:GCTT", gene: "APOC3", annotation: "missense", dataset: "genebass", trait: "TG", mlog10p: 6 },
    { variant: "11:6:G:T", gene: "APOC3", annotation: "pLoF", dataset: "genebass", trait: "TG", mlog10p: 50 },
    { variant: "11:7:G:T", gene: "APOA1", annotation: "missense", dataset: "genebass", trait: "TG", mlog10p: 9 },
  ];
  const candidates = missenseCandidates("APOC3", credibleSets, exome);

  it("takes the page's missense variants of this gene from both sets, each once", () => {
    expect(candidates.map((c) => [c.variant, c.sources])).toEqual([
      ["11:1:G:A", ["cs", "exome"]],
      ["11:9:C:G", ["cs"]],
      ["11:5:G:GCTT", ["exome"]],
    ]);
    expect(candidates[0].notes).toEqual([
      "in 2 credible sets, highest PIP 0.70",
      "2 exome associations, strongest TG (-log10 p 30.0)",
    ]);
  });

  const mapRow = (variant: string, accession: string, aaPos: number, geneName = "APOC3"): VariantMapRow => ({
    variant,
    accession,
    geneName,
    aaPos,
    aaRef: "A",
    aaAlt: "T",
    modelFileId: `AF-${accession}-F1`,
    filePosition: aaPos,
  });

  it("compares gene names without regard to case, as the credible-set tab does", () => {
    expect(missenseCandidates("apoc3", credibleSets, exome).map((c) => c.variant)).toEqual(
      candidates.map((c) => c.variant),
    );
  });

  it("counts pseudo credible sets apart and never writes their PIP without the mark", () => {
    const sets = [
      cs({ traitCSId: "p", resource: "Open_Targets", variant: ["11:1:G:A", "11:9:C:G"], consequence: ["missense_variant", "missense_variant"], gene: ["APOC3", "APOC3"], pip: [0.3, 0.2] }),
      cs({ traitCSId: "f", variant: ["11:1:G:A"], consequence: ["missense_variant"], gene: ["APOC3"], pip: [0.8] }),
    ];
    const [both, pseudoOnly] = missenseCandidates("APOC3", sets, [], new Set(["Open_Targets"]));
    expect(both.notes).toEqual([
      "in 1 credible set, highest PIP 0.80",
      "in 1 pseudo credible set*, highest PIP* 0.30",
    ]);
    expect(both).toMatchObject({ pseudo: true, pseudoOnly: false });
    expect(pseudoOnly.notes).toEqual(["in 1 pseudo credible set*, highest PIP* 0.20"]);
    expect(pseudoOnly).toMatchObject({ pseudo: true, pseudoOnly: true });
    expect(candidates[0]).toMatchObject({ pseudo: false, pseudoOnly: false });
  });

  it("keeps only the sets the credible-set tab shows before its controls are touched", () => {
    const member = { variant: ["11:1:G:A"], consequence: ["missense_variant"], gene: ["APOC3"], pip: [0.5] };
    const sets = [
      cs({ ...member, traitCSId: "gwas" }),
      cs({ ...member, traitCSId: "weak lead", mlog10p: [9.9, null] }),
      cs({ ...member, traitCSId: "too large", csSize: 51 }),
      cs({ ...member, traitCSId: "own eqtl", dataType: "eQTL", trait: "apoc3" }),
      cs({ ...member, traitCSId: "other gene's eqtl", dataType: "eQTL", trait: "APOA1" }),
      cs({ ...member, traitCSId: "other gene's pqtl", dataType: "pQTL", trait: "APOA1" }),
      cs({ ...member, traitCSId: "sqtl", dataType: "sQTL", trait: "APOA1" }),
    ];
    expect(trackCredibleSets("APOC3", sets).map((d) => d.traitCSId)).toEqual(["gwas", "own eqtl", "sqtl"]);
  });

  it("places by the map's residue and counts the candidates the map serves no row for", () => {
    const placement = placeVariants(
      candidates,
      [mapRow("11:9:C:G", "P02656", 88), mapRow("11:1:G:A", "P02656", 43)],
      "P02656",
      ["P02656"],
    );
    expect(placement.placed.map((v) => [v.variant, v.aaPos, v.label, v.filePosition])).toEqual([
      ["11:1:G:A", 43, "p.A43T", 43],
      ["11:9:C:G", 88, "p.A88T", 88],
    ]);
    expect(placement).toMatchObject({ noRow: 1, onOtherAccession: 0, onOtherGene: 0, total: 3 });
  });

  it("tells a row on another accession of the gene from a row on another gene's protein", () => {
    const rows = [
      mapRow("11:1:G:A", "P1", 43),
      mapRow("11:1:G:A", "P2", 12),
      mapRow("11:9:C:G", "P2", 30),
      // an accession the release does not list under this gene
      mapRow("11:5:G:GCTT", "Q9", 7, "APOA1"),
    ];
    expect(placeVariants(candidates, rows, "P1", ["P1", "P2"])).toMatchObject({
      noRow: 0,
      onOtherAccession: 1,
      onOtherGene: 1,
      otherGenes: ["APOA1"],
      total: 3,
    });
    expect(placeVariants(candidates, rows, "P2", ["P1", "P2"]).placed.map((v) => v.aaPos)).toEqual([12, 30]);
    // a shared protein: the row is filed under the other gene's name and still places here
    const shared = placeVariants(candidates, [mapRow("11:1:G:A", "P1", 43, "HBA2")], "P1", ["P1"]);
    expect(shared).toMatchObject({ noRow: 2, onOtherGene: 0 });
    expect(shared.placed).toHaveLength(1);
  });

  it("merges variants at one residue of one row into a single marker", () => {
    const rows = [mapRow("11:1:G:A", "P1", 43), mapRow("11:9:C:G", "P1", 43), mapRow("11:5:G:GCTT", "P1", 60)];
    const { placed } = placeVariants(candidates, rows, "P1", ["P1"]);
    expect(markersOf(placed, "cs").map((m) => [m.aaPos, m.variants.map((v) => v.variant)])).toEqual([
      [43, ["11:1:G:A", "11:9:C:G"]],
    ]);
    expect(markersOf(placed, "exome").map((m) => [m.aaPos, m.variants.length])).toEqual([
      [43, 1],
      [60, 1],
    ]);
  });
});

describe("pLDDT strip", () => {
  it("uses AlphaFold's bands", () => {
    expect([95, 90, 70.1, 70, 50, 12].map(plddtBand)).toEqual([0, 1, 1, 2, 3, 3]);
  });

  it("merges neighbours of one band, so a long protein is a handful of rectangles", () => {
    const owners = Array.from({ length: 34350 }, (_, i) => residue("F", i + 1, i + 1, true, i < 20000 ? 95 : 40));
    const runs = plddtRuns(owners, 1, 34350, 700);
    // the bin that straddles the change takes the lower band, so there is no third colour
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ start: 1, band: 0 });
    expect(runs[1]).toMatchObject({ end: 34350, band: 3 });
    expect(runs[1].start).toBe(runs[0].end + 1);
    expect(Math.abs(runs[0].end - 20000)).toBeLessThanOrEqual(Math.ceil(34350 / 700));
  });

  it("colours a bin by its least confident residue, not by a mean none of them has", () => {
    // 49 residues at 95 and one at 30 average 93.7, which a mean would draw as very high
    const owners = Array.from({ length: 100 }, (_, i) => residue("F", i + 1, i + 1, true, i === 20 ? 30 : 95));
    expect(plddtRuns(owners, 1, 100, 2)).toEqual([
      { start: 1, end: 50, band: 3 },
      { start: 51, end: 100, band: 0 },
    ]);
    // 95 and 40 average 67.5, "low": a band neither residue is in
    expect(plddtRuns([residue("F", 1, 1, true, 95), residue("F", 2, 2, true, 40)], 1, 2, 1)).toEqual([
      { start: 1, end: 2, band: 3 },
    ]);
  });

  it("draws one cell per residue when there is room, and only the domain asked for", () => {
    const owners = [95, 95, 60, 95].map((p, i) => residue("F", i + 1, i + 1, true, p));
    expect(plddtRuns(owners, 1, 4, 900)).toEqual([
      { start: 1, end: 2, band: 0 },
      { start: 3, end: 3, band: 2 },
      { start: 4, end: 4, band: 0 },
    ]);
    expect(plddtRuns(owners, 3, 4, 900)).toEqual([
      { start: 3, end: 3, band: 2 },
      { start: 4, end: 4, band: 0 },
    ]);
  });
});

describe("feature rows", () => {
  it("gives one row per source and type, domain-scale rows first", () => {
    const f = (source: string, featureType: string, start: number, accession = "P1") => ({
      accession, source, featureType, start, end: start + 5, description: null, evidenceTier: null,
    });
    const rows = featureTrackRows(
      [f("uniprot", "Binding site", 28), f("uniprot", "Helix", 31), f("uniprot", "Helix", 4), f("ted", "TED domain", 3), f("uniprot", "Domain", 13), f("uniprot", "Domain", 1, "P2")],
      "P1",
    );
    expect(rows.map((r) => r.key)).toEqual(["ted|TED domain", "uniprot|Domain", "uniprot|Helix", "uniprot|Binding site"]);
    expect(rows[2].features.map((x) => x.start)).toEqual([4, 31]);
  });
});
