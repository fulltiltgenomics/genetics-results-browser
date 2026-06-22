import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

import csBatch from "../src/test/fixtures/credible_sets_by_variant_batch.json" with { type: "json" };
import annoFinngen from "../src/test/fixtures/variant_annotation_finngen.json" with { type: "json" };
import annoGnomad from "../src/test/fixtures/variant_annotation_gnomad.json" with { type: "json" };
import nearestGenes from "../src/test/fixtures/nearest_genes.json" with { type: "json" };
import datasets from "../src/test/fixtures/datasets.json" with { type: "json" };

const app = createApp();

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// the BFF now requests format=tsv for the batch fan-out endpoints, so the stubbed upstream must serve
// TSV for those. serialize a JSON fixture array the way the API does (header from the first row, NA for
// null) so the fixtures stay single-sourced and round-trip back through the BFF's parseTsv.
const toTsv = (rows: Array<Record<string, unknown>>): string => {
  if (rows.length === 0) return "";
  const header = Object.keys(rows[0]);
  const body = rows.map((r) =>
    header.map((h) => (r[h] === null || r[h] === undefined ? "NA" : String(r[h]))).join("\t")
  );
  return [header.join("\t"), ...body].join("\n") + "\n";
};
const tsv = (rows: Array<Record<string, unknown>>, status = 200): Response =>
  new Response(toTsv(rows), { status, headers: { "content-type": "text/tab-separated-values" } });

// route the stubbed fetch by upstream path so each fan-out call gets its matching fixture
const routeFetch = (overrides: Record<string, () => Response> = {}) =>
  vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const u = String(url);
    if (overrides.rsid && u.includes("/v1/rsid/variants")) return overrides.rsid();
    if (u.includes("/v1/rsid/variants")) return json([]);
    if (u.includes("/v1/credible_sets_by_variant")) return tsv(csBatch);
    if (u.includes("/v1/variant_annotation/gnomad")) return tsv(annoGnomad);
    if (u.includes("/v1/variant_annotation/finngen")) return tsv(annoFinngen);
    if (u.includes("/v1/nearest_genes")) return tsv(nearestGenes);
    if (u.includes("/v1/datasets")) return json(datasets);
    return json({}, 404);
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /v1/results — variant list normalize", () => {
  it("rejects an empty query with 400 and never hits the upstream", async () => {
    const fetchMock = routeFetch();
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).post("/api/v1/results").send({ query: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("assembles a NormalizedResponse with raw per-variant credible sets + merged annotation", async () => {
    vi.stubGlobal("fetch", routeFetch());

    const res = await request(app).post("/api/v1/results").send({ query: "19-44908684-T-C" });

    expect(res.status).toBe(200);
    expect(res.body.queryType).toBe("variant");
    expect(res.body.inputVariants.found).toEqual(["19:44908684:T:C"]);

    const variant = res.body.variants[0];
    expect(variant.variant).toBe("19:44908684:T:C");
    // RAW count: all 6 fixture rows attach to this variant (no filtering)
    expect(variant.credibleSets).toHaveLength(6);

    // annotation merged from variant_annotation/finngen (rsid + parsed numeric AF/INFO/enrichment)
    expect(variant.annotation.rsid).toBe("rs429358");
    expect(variant.annotation.consequence).toBe("missense variant");
    expect(variant.annotation.isCoding).toBe(true);
    expect(variant.annotation.gene).toBe("APOE");
    expect(variant.annotation.af).toBeCloseTo(0.18006);
    expect(typeof variant.annotation.info).toBe("number");
    expect(variant.annotation.enrichmentNfe).toBeCloseTo(1.41508);

    // nearest gene attached + camelCased
    expect(variant.nearestGenes[0]).toMatchObject({ geneName: "APOE", distance: 0, geneStrand: "+" });
  });

  it("parses quantLevel from trait_original and coerces numerics, keeping nulls", async () => {
    vi.stubGlobal("fetch", routeFetch());

    const res = await request(app).post("/api/v1/results").send({ query: "19-44908684-T-C" });
    const cs = res.body.variants[0].credibleSets as Array<Record<string, unknown>>;

    // eQTL row has trait_original "...|exon" -> quantLevel "exon"; GWAS/pQTL have no level
    const eqtl = cs.find((r) => r.dataType === "eQTL");
    expect(eqtl?.quantLevel).toBe("exon");
    const gwas = cs.find((r) => r.dataType === "GWAS" && r.resource === "finngen");
    expect(gwas?.quantLevel).toBeNull();

    // open_targets rows: mlog10p/se null preserved; beta still numeric
    const ot = cs.filter((r) => r.resource === "open_targets");
    const nullStats = ot.find((r) => r.mlog10p === null);
    expect(nullStats).toBeDefined();
    expect(nullStats?.se).toBeNull();
    expect(typeof nullStats?.beta).toBe("number");

    // numeric coercion of csMinR2 / pip / aaf
    expect(typeof gwas?.csMinR2).toBe("number");
    expect(typeof gwas?.pip).toBe("number");
  });

  it("includes datasets and BFF-derived resources", async () => {
    vi.stubGlobal("fetch", routeFetch());

    const res = await request(app).post("/api/v1/results").send({ query: "19-44908684-T-C" });

    expect(res.body.datasets.finngen_gwas).toMatchObject({ resource: "finngen", dataType: "gwas" });
    // qtl_types filtered to the CS-qtl vocabulary
    expect(res.body.datasets.finngen_pqtl.qtlTypes).toEqual(["pQTL"]);

    const finngen = res.body.resources.find((r: { resource: string }) => r.resource === "finngen");
    expect(finngen).toBeDefined();
    expect(finngen.dataTypes).toEqual(expect.arrayContaining(["gwas", "pqtl", "eqtl"]));
    // finngen_gwas declares products.summary_stats true
    expect(finngen.hasSummaryStats).toBe(true);
    // finngen has fine-mapped (real) credible sets, not pseudo
    expect(finngen.hasCredibleSets).toBe(true);
    expect(finngen.hasPseudoCredibleSets).toBe(false);

    // finngen_mvp_ukbb declares products.credible_sets + pseudo_credible_sets -> flagged pseudo
    const pseudo = res.body.resources.find(
      (r: { resource: string }) => r.resource === "finngen_mvp_ukbb"
    );
    expect(pseudo).toBeDefined();
    expect(pseudo.hasCredibleSets).toBe(true);
    expect(pseudo.hasPseudoCredibleSets).toBe(true);

    // eqtl_catalogue is data_type "mixed" but has NO products.summary_stats -> false (regression pin)
    const eqtlCat = res.body.resources.find(
      (r: { resource: string }) => r.resource === "eqtl_catalogue"
    );
    expect(eqtlCat).toBeDefined();
    expect(eqtlCat.hasSummaryStats).toBe(false);
  });

  it("attaches a merged GnomadFreq, preferring the larger-AN row, with byPop + popmax", async () => {
    vi.stubGlobal("fetch", routeFetch());

    const res = await request(app).post("/api/v1/results").send({ query: "19-44908684-T-C" });

    const gnomad = res.body.variants[0].gnomad;
    expect(gnomad).toBeDefined();
    // 19-44908684 has two rows: e (AN 1415800) + g (AN 152092). merge picks the larger-AN exome row.
    expect(gnomad.genomeOrExome).toBe("e");
    expect(gnomad.variant).toBe("19:44908684:T:C");
    // afOverall + byPop parsed from the e row's scientific-notation strings
    expect(gnomad.afOverall).toBeCloseTo(0.14757);
    expect(gnomad.byPop.afr).toBeCloseTo(0.22661);
    expect(gnomad.byPop.nfe).toBeCloseTo(0.15142);
    expect(gnomad.byPop.mid).toBeCloseTo(0.068061);
    expect(Object.keys(gnomad.byPop).sort()).toEqual(
      ["afr", "amr", "asj", "eas", "fin", "mid", "nfe", "remaining", "sas"].sort()
    );
    // popmax is the max over byPop -> afr in the e row (0.22661)
    expect(gnomad.popmaxPop).toBe("afr");
    expect(gnomad.popmaxAf).toBeCloseTo(0.22661);
  });

  it("handles a single-row gnomAD variant (no g/e merge) and an absent variant", async () => {
    // 17-7676154-G-A returns one exome row; the gnomad fixture has no row for 1-55039974-G-T
    vi.stubGlobal("fetch", routeFetch());

    const res = await request(app)
      .post("/api/v1/results")
      .send({ query: "17-7676154-G-A\n1-55039974-G-T" });

    const byId: Record<string, { gnomad?: Record<string, unknown> }> = {};
    for (const v of res.body.variants as Array<{ variant: string }>) {
      byId[v.variant] = v as { gnomad?: Record<string, unknown> };
    }

    const tp53 = byId["17:7676154:G:A"].gnomad!;
    expect(tp53.genomeOrExome).toBe("e");
    expect(tp53.afOverall).toBeCloseTo(6.842e-7);
    // only nfe is nonzero; popmax = nfe even though every pop is present
    expect(tp53.popmaxPop).toBe("nfe");
    expect(tp53.popmaxAf).toBeCloseTo(8.9928e-7);

    // variant absent from gnomad -> no gnomad field fabricated
    expect(byId["1:55039974:G:T"].gnomad).toBeUndefined();
  });

  it("returns a clean JSON 400 for a malformed JSON body", async () => {
    const fetchMock = routeFetch();
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/v1/results")
      .set("content-type", "application/json")
      .send("{ not valid json");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_json");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves an rsID to its canonical variant and queries upstream with it", async () => {
    const fetchMock = routeFetch({
      rsid: () => json([{ rsid: "rs429358", variants: ["19-44908684-T-C"] }]),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).post("/api/v1/results").send({ query: "rs429358" });

    expect(res.status).toBe(200);
    expect(res.body.inputVariants.rsidMap).toEqual({ rs429358: ["19:44908684:T:C"] });
    expect(res.body.inputVariants.found).toEqual(["19:44908684:T:C"]);
    // the CS POST body uses the resolved canonical variant (newline string)
    const csCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/v1/credible_sets_by_variant"));
    const csBody = (csCall?.[1] as RequestInit | undefined)?.body as string;
    expect(JSON.parse(csBody)).toEqual({ variants: "19:44908684:T:C" });
  });

  it("classifies unknown rsIDs as notFound and junk as unparsed", async () => {
    const fetchMock = routeFetch({ rsid: () => json([{ rsid: "rs000", variants: [] }]) });
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/v1/results")
      .send({ query: "rs000\nnot_a_variant\n19-44908684-T-C" });

    expect(res.status).toBe(200);
    expect(res.body.inputVariants.notFound).toEqual(["rs000"]);
    expect(res.body.inputVariants.unparsed).toEqual(["not_a_variant"]);
    expect(res.body.inputVariants.found).toEqual(["19:44908684:T:C"]);
  });

  it("carries user betas/values from tab-separated input", async () => {
    vi.stubGlobal("fetch", routeFetch());

    const res = await request(app)
      .post("/api/v1/results")
      .send({ query: "19-44908684-T-C\t0.42\tsev" });

    expect(res.body.hasBetas).toBe(true);
    expect(res.body.hasCustomValues).toBe(true);
    expect(res.body.variants[0].beta).toBeCloseTo(0.42);
    expect(res.body.variants[0].value).toBe("sev");
  });

  it("returns 502 when an upstream fan-out call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).includes("/v1/credible_sets_by_variant")) throw new Error("ECONNREFUSED");
        return json([]);
      })
    );

    const res = await request(app).post("/api/v1/results").send({ query: "19-44908684-T-C" });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("upstream_error");
  });
});

describe("POST /v1/results — named variant set expansion", () => {
  // a named-set token expands via /v1/variant_sets/{name} into a variant list, then flows through
  // the normal fan-out. routeFetch serves the expansion + a CS fixture matching the expanded variant.
  const routeWithSet = (variants: string[], status = 200) =>
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/v1/variant_sets/")) {
        return status === 200
          ? json({ name: "ExampleSet", variants })
          : json({ detail: "Unknown variant set" }, status);
      }
      if (u.includes("/v1/credible_sets_by_variant")) return tsv(csBatch);
      if (u.includes("/v1/variant_annotation/gnomad")) return tsv(annoGnomad);
      if (u.includes("/v1/variant_annotation/finngen")) return tsv(annoFinngen);
      if (u.includes("/v1/nearest_genes")) return tsv(nearestGenes);
      if (u.includes("/v1/datasets")) return json(datasets);
      return json({}, 404);
    });

  it("expands a known named set token into its curated variant list", async () => {
    const fetchMock = routeWithSet(["19:44908684:T:C"]);
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).post("/api/v1/results").send({ query: "ExampleSet" });

    expect(res.status).toBe(200);
    expect(res.body.inputVariants.found).toEqual(["19:44908684:T:C"]);
    expect(res.body.inputVariants.unparsed).toEqual([]);
    // the expansion endpoint was queried with the bare token
    const calledSet = fetchMock.mock.calls.some((c) =>
      String(c[0]).includes("/v1/variant_sets/ExampleSet")
    );
    expect(calledSet).toBe(true);
  });

  it("falls back to the normal parse (token marked unparsed) when the set name is unknown (404)", async () => {
    vi.stubGlobal("fetch", routeWithSet([], 404));

    const res = await request(app).post("/api/v1/results").send({ query: "NoSuchSet" });

    expect(res.status).toBe(200);
    expect(res.body.inputVariants.unparsed).toEqual(["NoSuchSet"]);
    expect(res.body.inputVariants.found).toEqual([]);
  });

  it("does not attempt set expansion for a normal variant list", async () => {
    const fetchMock = routeWithSet(["19:44908684:T:C"]);
    vi.stubGlobal("fetch", fetchMock);

    await request(app).post("/api/v1/results").send({ query: "19-44908684-T-C" });

    const calledSet = fetchMock.mock.calls.some((c) => String(c[0]).includes("/v1/variant_sets/"));
    expect(calledSet).toBe(false);
  });
});

describe("POST /v1/results — phenotype credible-set lead expansion", () => {
  // a "pheno:{resource}:{code}" token expands via /v1/credible_sets_by_phenotype_leads into the
  // lead variant of each credible set, carrying the data beta, then flows through the normal fan-out.
  const leadRows = [
    { chr: 19, pos: 44908684, ref: "T", alt: "C", beta: 0.42, cs_id: "csX", pip: 0.9 },
    { chr: 1, pos: 100, ref: "A", alt: "G", beta: -0.1, cs_id: "csY", pip: 0.8 },
  ];
  const routeWithLeads = (rows: unknown, status = 200) =>
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/v1/credible_sets_by_phenotype_leads/")) {
        return status === 200 ? json(rows) : json({ detail: "not found" }, status);
      }
      if (u.includes("/v1/credible_sets_by_variant")) return tsv(csBatch);
      if (u.includes("/v1/variant_annotation/gnomad")) return tsv(annoGnomad);
      if (u.includes("/v1/variant_annotation/finngen")) return tsv(annoFinngen);
      if (u.includes("/v1/nearest_genes")) return tsv(nearestGenes);
      if (u.includes("/v1/datasets")) return json(datasets);
      return json({}, 404);
    });

  it("expands a pheno token into lead variants and attaches the data betas", async () => {
    const fetchMock = routeWithLeads(leadRows);
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).post("/api/v1/results").send({ query: "pheno:finngen:T2D_WIDE" });

    expect(res.status).toBe(200);
    expect(res.body.inputVariants.found).toEqual(["19:44908684:T:C", "1:100:A:G"]);
    expect(res.body.hasBetas).toBe(true);
    const lead = res.body.variants.find((v: { variant: string }) => v.variant === "19:44908684:T:C");
    expect(lead.beta).toBe(0.42);
    // addressed by resource + code
    const calledLeads = fetchMock.mock.calls.some((c) =>
      String(c[0]).includes("/v1/credible_sets_by_phenotype_leads/finngen/T2D_WIDE")
    );
    expect(calledLeads).toBe(true);
  });

  it("falls back to the normal parse when the phenotype is unknown (404)", async () => {
    vi.stubGlobal("fetch", routeWithLeads([], 404));

    const res = await request(app).post("/api/v1/results").send({ query: "pheno:finngen:NOPE" });

    expect(res.status).toBe(200);
    expect(res.body.inputVariants.unparsed).toEqual(["pheno:finngen:NOPE"]);
    expect(res.body.inputVariants.found).toEqual([]);
  });

  it("does not attempt lead expansion for a normal variant list", async () => {
    const fetchMock = routeWithLeads(leadRows);
    vi.stubGlobal("fetch", fetchMock);

    await request(app).post("/api/v1/results").send({ query: "19-44908684-T-C" });

    const calledLeads = fetchMock.mock.calls.some((c) =>
      String(c[0]).includes("/v1/credible_sets_by_phenotype_leads/")
    );
    expect(calledLeads).toBe(false);
  });
});
