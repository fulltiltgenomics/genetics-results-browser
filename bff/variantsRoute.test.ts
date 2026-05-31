import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

import csBatch from "../src/test/fixtures/credible_sets_by_variant_batch.json" with { type: "json" };
import annoFinngen from "../src/test/fixtures/variant_annotation_finngen.json" with { type: "json" };
import nearestGenes from "../src/test/fixtures/nearest_genes.json" with { type: "json" };
import datasets from "../src/test/fixtures/datasets.json" with { type: "json" };

const app = createApp();

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// route the stubbed fetch by upstream path so each fan-out call gets its matching fixture
const routeFetch = (overrides: Record<string, () => Response> = {}) =>
  vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const u = String(url);
    if (overrides.rsid && u.includes("/v1/rsid/variants")) return overrides.rsid();
    if (u.includes("/v1/rsid/variants")) return json([]);
    if (u.includes("/v1/credible_sets_by_variant")) return json(csBatch);
    if (u.includes("/v1/variant_annotation/finngen")) return json(annoFinngen);
    if (u.includes("/v1/nearest_genes")) return json(nearestGenes);
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

    // eqtl_catalogue is data_type "mixed" but has NO products.summary_stats -> false (regression pin)
    const eqtlCat = res.body.resources.find(
      (r: { resource: string }) => r.resource === "eqtl_catalogue"
    );
    expect(eqtlCat).toBeDefined();
    expect(eqtlCat.hasSummaryStats).toBe(false);
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
