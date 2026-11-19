import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { clearDatasetsCache } from "./normalize.js";
import { datasetLookups } from "./geneAssociationRoute.js";
import { buildGeneAssociationSummary } from "./geneAssociationSummary.js";
import { PIP_SCALE, TRAIT_TYPE, VARIANT_CLASS } from "./geneAssociationTypes.js";

const row = (over: Record<string, string | null> = {}): Record<string, string | null> => ({
  resource: "finngen",
  version: "R14",
  dataset: "FinnGen_R14",
  data_type: "GWAS",
  trait: "Alzheimer_disease",
  trait_original: "G6_ALZHEIMER",
  cell_type: null,
  chr: "19",
  pos: "44908684",
  ref: "T",
  alt: "C",
  mlog10p: "300",
  beta: "1.2",
  se: "0.02",
  pip: "0.9",
  cs_id: "chr19_44908684_T_C",
  cs_size: "3",
  cs_min_r2: "0.8",
  aaf: "0.18",
  most_severe: "missense_variant",
  gene_most_severe: "APOE",
  ...over,
});

const ROWS = [
  row(),
  // upstream of the first, with a higher PIP: the lead, and first in genomic order
  row({
    pos: "44907000",
    ref: "G",
    alt: "A",
    pip: "0.95",
    mlog10p: null,
    beta: "-0.3",
    most_severe: "intron_variant",
  }),
  // the API can serve a variant of a set twice
  row(),
  // a second set on the same trait shares its dictionary entry
  row({ cs_id: "second", pip: "0.0123", most_severe: "stop_gained", gene_most_severe: "TOMM40" }),
  row({
    resource: "finngen_mvp_ukbb_aou",
    dataset: "FinnGen_R14_MVP_UKBB_AOU",
    trait: "LDL_Q",
    trait_original: "LDL_Q",
    cs_id: "meta",
    most_severe: null,
    gene_most_severe: null,
  }),
  row({ data_type: "eQTL", cs_id: "qtl" }),
];

const DATASETS = [
  {
    dataset_id: "finngen_gwas",
    resource: "finngen",
    dataset: "FinnGen_R14",
    data_type: "gwas",
    trait_type: "binary",
  },
  {
    dataset_id: "finngen_kanta",
    resource: "finngen",
    dataset: "FinnGen_kanta",
    data_type: "gwas",
    trait_type: "mixed",
  },
  {
    dataset_id: "meta",
    resource: "finngen_mvp_ukbb_aou",
    dataset: "FinnGen_R14_MVP_UKBB_AOU",
    data_type: "gwas",
    trait_type: "mixed",
    pseudo_credible_sets: true,
  },
  // not a GWAS dataset: no say in the resource's trait type
  {
    dataset_id: "finngen_eqtl",
    resource: "finngen",
    dataset: "FinnGen_R14",
    data_type: "eqtl",
    trait_type: "quantitative",
  },
  // two datasets under one label that disagree on the type
  { dataset_id: "pgc_a", resource: "pgc", dataset: "PGC", data_type: "gwas", trait_type: "binary" },
  {
    dataset_id: "pgc_b",
    resource: "pgc",
    dataset: "PGC",
    data_type: "gwas",
    trait_type: "quantitative",
  },
  {
    dataset_id: "t2d",
    resource: "t2d",
    dataset: null,
    data_type: "gwas",
    trait_type: "binary",
    pseudo_credible_sets: true,
  },
];

const lookups = (
  traitMeta = new Map<string, Map<string, { name: string; traitType: string | null }>>()
) => ({ traitMeta, ...datasetLookups(DATASETS as never) });

describe("buildGeneAssociationSummary", () => {
  const { summary, setIds } = buildGeneAssociationSummary(
    "APOE",
    1000,
    ROWS,
    lookups(
      new Map([
        [
          "finngen_mvp_ukbb_aou",
          new Map([["LDL_Q", { name: "LDL cholesterol", traitType: "quantitative" }]]),
        ],
      ])
    )
  );

  it("lists each variant once, in genomic order, with its class and gene", () => {
    expect(summary.variants.pos).toEqual([44907000, 44908684]);
    expect(summary.variants.ref).toEqual(["G", "T"]);
    expect(summary.variants.alt).toEqual(["A", "C"]);
    expect(summary.variants.consequence.map((c) => summary.consequences[c])).toEqual([
      "intron_variant",
      "missense_variant",
    ]);
    expect(summary.variants.gene.map((g) => summary.genes[g])).toEqual(["APOE", "APOE"]);
    expect(summary.variants.variantClass).toEqual([VARIANT_CLASS.other, VARIANT_CLASS.coding]);
  });

  it("keeps a variant's first annotation, so a later row cannot reclassify it", () => {
    // the "second" set's row calls 44908684 a TOMM40 stop gain; the first row already named it
    expect(summary.variants.pos).toHaveLength(2);
  });

  it("groups GWAS rows into sets, dropping repeats and other data types", () => {
    expect(setIds.csId).toEqual(["chr19_44908684_T_C", "second", "meta"]);
    expect(summary.sets.memberCount).toEqual([2, 1, 1]);
    expect(summary.members.variant).toEqual([0, 1, 1, 1]);
    expect(summary.members.pip).toEqual(
      [0.95, 0.9, 0.0123, 0.9].map((p) => Math.round(p * PIP_SCALE))
    );
    expect(summary.sets.size).toEqual([3, 3, 3]);
    expect(summary.sets.minR2).toEqual([0.8, 0.8, 0.8]);
  });

  it("takes the member with the highest PIP as the lead, with its statistics", () => {
    expect(summary.sets.lead).toEqual([0, 1, 1]);
    expect(summary.sets.leadMlog10p).toEqual([null, 300, 300]);
    expect(summary.sets.leadBeta).toEqual([-0.3, 1.2, 1.2]);
  });

  it("shares a trait between its sets and joins the name, type and pseudo flag", () => {
    expect(summary.sets.trait).toEqual([0, 0, 1]);
    expect(summary.traits.code).toEqual(["G6_ALZHEIMER", "LDL_Q"]);
    // the API's own name is kept; a code served as the name is replaced from the metadata
    expect(summary.traits.name).toEqual(["Alzheimer_disease", "LDL cholesterol"]);
    // finngen has no metadata here: the dataset's single type stands in
    expect(summary.traits.type).toEqual([TRAIT_TYPE.binary, TRAIT_TYPE.quantitative]);
    expect(summary.traits.resource.map((r) => summary.resources[r])).toEqual([
      "finngen",
      "finngen_mvp_ukbb_aou",
    ]);
    expect(summary.sets.pseudo).toEqual([0, 0, 1]);
    expect(summary.sets.dataset.map((d) => summary.datasets[d])).toEqual([
      "FinnGen_R14",
      "FinnGen_R14",
      "FinnGen_R14_MVP_UKBB_AOU",
    ]);
  });

  it("names the sets with a key the ids share", () => {
    expect(summary.setsKey).toMatch(/^[0-9a-f]{16}$/);
    expect(setIds.setsKey).toBe(summary.setsKey);
    const other = buildGeneAssociationSummary("APOE", 1000, ROWS.slice(0, 1), lookups());
    expect(other.summary.setsKey).not.toBe(summary.setsKey);
  });

  it("serves empty columns for no rows", () => {
    const empty = buildGeneAssociationSummary("APOE", 0, [], lookups()).summary;
    expect(empty.variants.pos).toEqual([]);
    expect(empty.sets.lead).toEqual([]);
  });
});

describe("datasetLookups", () => {
  const { isPseudo, datasetTraitType } = datasetLookups(DATASETS as never);

  it("decides by dataset label, and by resource where a dataset has none", () => {
    expect(isPseudo("finngen_mvp_ukbb_aou", "FinnGen_R14_MVP_UKBB_AOU")).toBe(true);
    expect(isPseudo("finngen", "FinnGen_R14")).toBe(false);
    expect(isPseudo("t2d", "anything")).toBe(true);
    expect(isPseudo("unknown", "unknown")).toBe(false);
  });

  it("gives a trait type only where every dataset of the label agrees on one", () => {
    expect(datasetTraitType("finngen", "FinnGen_R14")).toBe("binary");
    expect(datasetTraitType("finngen", "FinnGen_kanta")).toBeNull();
    expect(datasetTraitType("pgc", "PGC")).toBeNull();
    expect(datasetTraitType("unknown", "unknown")).toBeNull();
  });
});

const toTsv = (rows: Array<Record<string, string | null>>): string => {
  const header = Object.keys(rows[0]);
  return [header.join("\t"), ...rows.map((r) => header.map((h) => r[h] ?? "NA").join("\t"))].join(
    "\n"
  );
};

const upstream = (overrides: Record<string, () => Response> = {}) =>
  vi.fn<typeof fetch>(async (url) => {
    const u = String(url);
    for (const [part, respond] of Object.entries(overrides)) {
      if (u.includes(part)) return respond();
    }
    if (u.includes("/v1/credible_sets_by_gene/")) return new Response(toTsv(ROWS));
    if (u.includes("/v1/datasets")) return new Response(JSON.stringify(DATASETS));
    if (u.includes("/v1/resource_metadata/finngen_mvp_ukbb_aou"))
      return new Response(
        JSON.stringify([
          {
            phenotype_code: "LDL_Q",
            phenotype_string: "LDL cholesterol",
            trait_type: "quantitative",
          },
        ])
      );
    return new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
  });

const calls = (mock: ReturnType<typeof upstream>, part: string): string[] =>
  mock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes(part));

afterEach(() => {
  vi.restoreAllMocks();
  clearDatasetsCache();
});

describe("GET /api/v1/gene_association/:gene", () => {
  it("asks the API for the gene's GWAS rows as TSV and serves the summary", async () => {
    const fetchMock = upstream();
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(createApp())
      .get("/api/v1/gene_association/APOE")
      .query({ window: 500000 });

    expect(res.status).toBe(200);
    expect(res.body.gene).toBe("APOE");
    expect(res.body.window).toBe(500000);
    expect(res.body.traits.name).toEqual(["Alzheimer_disease", "LDL cholesterol"]);
    expect(res.body.sets.pseudo).toEqual([0, 0, 1]);
    const [url] = calls(fetchMock, "/v1/credible_sets_by_gene/");
    expect(url).toContain("/v1/credible_sets_by_gene/APOE?");
    expect(url).toContain("window=500000");
    expect(url).toContain("data_types=GWAS");
    expect(url).toContain("format=tsv");
  });

  it("serves gzip to a client that takes it, and plain JSON to one that does not", async () => {
    vi.stubGlobal("fetch", upstream());
    const app = createApp();

    const plain = await request(app)
      .get("/api/v1/gene_association/APOE")
      .set("Accept-Encoding", "identity");
    expect(plain.headers["content-encoding"]).toBeUndefined();

    const zipped = await request(app)
      .get("/api/v1/gene_association/APOE")
      .set("Accept-Encoding", "gzip")
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(zipped.headers["content-encoding"]).toBe("gzip");
    expect(zipped.headers["vary"]).toContain("Accept-Encoding");
    // supertest inflates a gzip body before the parser sees it
    const body = zipped.body as Buffer;
    const text = body[0] === 0x1f ? gunzipSync(body).toString() : body.toString();
    expect(JSON.parse(text)).toEqual(plain.body);
  });

  it("answers a repeated gene, and its set ids, from the cache", async () => {
    const fetchMock = upstream();
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp();

    const first = await request(app).get("/api/v1/gene_association/APOE");
    await request(app).get("/api/v1/gene_association/APOE");
    const ids = await request(app).get("/api/v1/gene_association/APOE/set_ids");

    expect(ids.body).toEqual({
      setsKey: first.body.setsKey,
      csId: ["chr19_44908684_T_C", "second", "meta"],
    });
    expect(calls(fetchMock, "/v1/credible_sets_by_gene/")).toHaveLength(1);
    // a second window is its own entry, but the resource metadata is already held
    await request(app).get("/api/v1/gene_association/APOE").query({ window: 1000 });
    expect(calls(fetchMock, "/v1/credible_sets_by_gene/")).toHaveLength(2);
    expect(calls(fetchMock, "/v1/resource_metadata/finngen_mvp_ukbb_aou")).toHaveLength(1);
  });

  it("shares one upstream request between concurrent callers", async () => {
    const fetchMock = upstream();
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp();

    await Promise.all([
      request(app).get("/api/v1/gene_association/APOE"),
      request(app).get("/api/v1/gene_association/APOE/set_ids"),
    ]);

    expect(calls(fetchMock, "/v1/credible_sets_by_gene/")).toHaveLength(1);
  });

  it("serves the sets without names or types when a resource's metadata fails", async () => {
    const fetchMock = upstream({
      "/v1/resource_metadata/finngen_mvp_ukbb_aou": () => new Response("boom", { status: 500 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp();

    const res = await request(app).get("/api/v1/gene_association/APOE");
    expect(res.status).toBe(200);
    expect(res.body.traits.name).toEqual(["Alzheimer_disease", "LDL_Q"]);

    // the failure is not held: another window asks for the metadata again
    await request(app).get("/api/v1/gene_association/APOE").query({ window: 1000 });
    expect(calls(fetchMock, "/v1/resource_metadata/finngen_mvp_ukbb_aou")).toHaveLength(2);
  });

  it.each(["-1", "1.5", "abc", "1000001"])("refuses window=%s", async (window) => {
    const fetchMock = upstream();
    vi.stubGlobal("fetch", fetchMock);
    const res = await request(createApp()).get("/api/v1/gene_association/APOE").query({ window });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a gene that is not a symbol", async () => {
    const fetchMock = upstream();
    vi.stubGlobal("fetch", fetchMock);
    const res = await request(createApp()).get("/api/v1/gene_association/AP%20OE%3Fx");
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 404 for a gene the API does not know, and does not hold the miss", async () => {
    const fetchMock = upstream({
      "/v1/credible_sets_by_gene/": () =>
        new Response(JSON.stringify({ detail: "Gene NOPE not found" }), { status: 404 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp();

    expect((await request(app).get("/api/v1/gene_association/NOPE")).status).toBe(404);
    await request(app).get("/api/v1/gene_association/NOPE");
    expect(calls(fetchMock, "/v1/credible_sets_by_gene/")).toHaveLength(2);
  });

  it("answers 502 when the API fails", async () => {
    vi.stubGlobal(
      "fetch",
      upstream({ "/v1/credible_sets_by_gene/": () => new Response("boom", { status: 500 }) })
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(createApp()).get("/api/v1/gene_association/APOE");
    expect(res.status).toBe(502);
  });
});
