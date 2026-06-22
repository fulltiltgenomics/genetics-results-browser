import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

import csByGene from "../src/test/fixtures/credible_sets_by_gene.json" with { type: "json" };
import datasets from "../src/test/fixtures/datasets.json" with { type: "json" };

const app = createApp();

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// credible_sets_by_gene is now requested as format=tsv, so the stub serves TSV (serialized from the
// JSON fixture the way the API does: header from the first row, NA for null). datasets stays JSON.
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

// route the stubbed fetch by upstream path: the gene path fans out to credible_sets_by_gene + datasets
const routeFetch = () =>
  vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/v1/credible_sets_by_gene")) return tsv(csByGene);
    if (u.includes("/v1/datasets")) return json(datasets);
    return json({}, 404);
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /v1/gene_results/:gene — gene query normalize", () => {
  it("assembles a NormalizedResponse with queryType gene and per-variant credible sets", async () => {
    vi.stubGlobal("fetch", routeFetch());

    const res = await request(app).get("/api/v1/gene_results/CLASRP");

    expect(res.status).toBe(200);
    expect(res.body.queryType).toBe("gene");
    // 10 fixture rows over 7 distinct variants -> 7 VariantResults; found mirrors the members
    expect(res.body.variants).toHaveLength(7);
    expect(res.body.inputVariants.found).toHaveLength(7);
    // a gene query has no parsed variant input
    expect(res.body.inputVariants.notFound).toEqual([]);
    expect(res.body.inputVariants.unparsed).toEqual([]);
    expect(res.body.hasBetas).toBe(false);
    expect(res.body.hasCustomValues).toBe(false);

    // 19:45040529:C:T appears in 3 fixture rows (eQTL/eQTL/caQTL) -> 3 credible sets, no filtering
    const multi = res.body.variants.find(
      (v: { variant: string }) => v.variant === "19:45040529:C:T"
    );
    expect(multi.credibleSets).toHaveLength(3);
    // annotation derived from the CS row (no separate annotation fan-out): rsid null, gene/consequence present
    expect(multi.annotation.rsid).toBeNull();
    expect(multi.annotation.gene).toBe("CLASRP");
    expect(multi.annotation.af).toBeNull();
    // gnomAD deferred for the gene path
    expect(multi.gnomad).toBeUndefined();
  });

  it("parses quantLevel from trait_original and coerces numerics, keeping nulls", async () => {
    vi.stubGlobal("fetch", routeFetch());

    const res = await request(app).get("/api/v1/gene_results/CLASRP");
    const allCs = (res.body.variants as Array<{ credibleSets: Array<Record<string, unknown>> }>)
      .flatMap((v) => v.credibleSets);

    // eqtl_catalogue eQTL row "...|ge" -> quantLevel "ge"; sQTL "...|leafcutter" -> "leafcutter"
    const ge = allCs.find((r) => r.dataType === "eQTL" && r.resource === "eqtl_catalogue");
    expect(ge?.quantLevel).toBe("ge");
    const sqtl = allCs.find((r) => r.dataType === "sQTL");
    expect(sqtl?.quantLevel).toBe("leafcutter");
    // finngen eQTL trait_original has no "|" suffix -> null level
    const finngenEqtl = allCs.find((r) => r.dataType === "eQTL" && r.resource === "finngen");
    expect(finngenEqtl?.quantLevel).toBeNull();
    // GWAS / caQTL carry no quant level
    const gwas = allCs.find((r) => r.dataType === "GWAS");
    expect(gwas?.quantLevel).toBeNull();

    // numeric coercion preserved across the row
    expect(typeof gwas?.pip).toBe("number");
    expect(typeof gwas?.csMinR2).toBe("number");
    expect(typeof gwas?.beta).toBe("number");
  });

  it("includes datasets and BFF-derived resources (same metadata as the variant path)", async () => {
    vi.stubGlobal("fetch", routeFetch());

    const res = await request(app).get("/api/v1/gene_results/CLASRP");

    expect(res.body.datasets.finngen_gwas).toMatchObject({ resource: "finngen", dataType: "gwas" });
    const finngen = res.body.resources.find((r: { resource: string }) => r.resource === "finngen");
    expect(finngen).toBeDefined();
    expect(finngen.hasSummaryStats).toBe(true);

    // phenotypes seeded from the CS rows present, keyed `${resource}|${trait}`
    expect(res.body.phenotypes["finngen_ukbb|Alzheimer_disease"]).toMatchObject({
      resource: "finngen_ukbb",
      dataType: "GWAS",
      trait: "Alzheimer_disease",
    });
  });

  it("passes an optional numeric window to the upstream and ignores junk", async () => {
    const fetchMock = routeFetch();
    vi.stubGlobal("fetch", fetchMock);

    await request(app).get("/api/v1/gene_results/CLASRP?window=500000");
    const geneCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/v1/credible_sets_by_gene")
    );
    expect(String(geneCall?.[0])).toContain("window=500000");

    fetchMock.mockClear();
    await request(app).get("/api/v1/gene_results/CLASRP?window=notanumber");
    const geneCall2 = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/v1/credible_sets_by_gene")
    );
    expect(String(geneCall2?.[0])).not.toContain("window=");
  });

  it("returns 502 when the upstream credible_sets_by_gene fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).includes("/v1/credible_sets_by_gene")) throw new Error("ECONNREFUSED");
        return json([]);
      })
    );

    const res = await request(app).get("/api/v1/gene_results/CLASRP");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("upstream_error");
  });
});
