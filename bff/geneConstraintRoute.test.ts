import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

const CONSTRAINT = {
  pLI: 2.7e-18,
  oe_lof_upper: 1.144,
  obs_lof: 57,
  obs_mis: 870,
  flags: ["no_exp_lof"],
};

const gnomadFetch = (gene: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: { gene } }), { status }));

afterEach(() => {
  vi.restoreAllMocks();
});

const get = (
  app = createApp(),
  query: Record<string, string> = { ensembl_id: "ENSG00000169174" }
) => request(app).get("/api/v1/gene_constraint").query(query);

describe("GET /api/v1/gene_constraint", () => {
  it("asks gnomAD by Ensembl id, as a GraphQL variable, and returns the trimmed record", async () => {
    const fetchMock = gnomadFetch({
      gnomad_constraint: CONSTRAINT,
      clinvar_variants: [
        "Pathogenic",
        "Pathogenic",
        "Pathogenic/Likely pathogenic",
        "Likely pathogenic",
        "Likely benign",
        "Pathogenic; risk factor",
        null,
      ].map((clinical_significance) => ({ clinical_significance })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pLI: 2.7e-18,
      loeuf: 1.144,
      observedLof: 57,
      observedMissense: 870,
      flags: ["no_exp_lof"],
      clinvar: { pathogenic: 2, pathogenicLikelyPathogenic: 1, likelyPathogenic: 1 },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gnomad.broadinstitute.org/api");
    const sent = JSON.parse(init!.body as string);
    expect(sent.variables).toEqual({ id: "ENSG00000169174" });
    expect(sent.query).not.toContain("ENSG00000169174");
  });

  it("answers a repeated gene from the cache", async () => {
    const fetchMock = gnomadFetch({ gnomad_constraint: CONSTRAINT });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp();

    await get(app);
    await get(app);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "PCSK9", "ENSG00000169174.5", 'ENSG00000169174"}'])(
    "rejects ensembl_id %s without calling upstream",
    async (ensemblId) => {
      const fetchMock = gnomadFetch(null);
      vi.stubGlobal("fetch", fetchMock);

      const res = await get(createApp(), ensemblId === undefined ? {} : { ensembl_id: ensemblId });

      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("returns 404 for a gene gnomAD does not know", async () => {
    vi.stubGlobal("fetch", gnomadFetch(null));

    expect((await get()).status).toBe(404);
  });

  it("serves a gene without constraint with null values and its ClinVar counts", async () => {
    vi.stubGlobal(
      "fetch",
      gnomadFetch({
        gnomad_constraint: null,
        clinvar_variants: [{ clinical_significance: "Likely pathogenic" }],
      })
    );

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pLI: null,
      loeuf: null,
      observedLof: null,
      observedMissense: null,
      flags: [],
      clinvar: { pathogenic: 0, pathogenicLikelyPathogenic: 0, likelyPathogenic: 1 },
    });
  });

  it("collapses an upstream failure to 502", async () => {
    vi.stubGlobal("fetch", gnomadFetch(null, 500));

    expect((await get()).status).toBe(502);
  });

  it("returns 504 when gnomAD times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<Response> => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      })
    );

    expect((await get()).status).toBe(504);
  });
});
