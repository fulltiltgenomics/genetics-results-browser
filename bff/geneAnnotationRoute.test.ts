import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { normalizeMyGeneHit } from "./geneAnnotationRoute.js";

const HIT = {
  symbol: "PCSK9",
  name: "proprotein convertase subtilisin/kexin type 9",
  summary: "This gene encodes a member of the subtilisin-like proprotein convertase family.",
  map_location: "1p32.3",
  type_of_gene: "protein-coding",
  MIM: "607786",
  entrezgene: "255738",
  ensembl: { gene: "ENSG00000169174" },
  uniprot: { "Swiss-Prot": "Q8NBP7" },
  pharmgkb: "PA38617",
  go: {
    BP: [
      { id: "GO:0001822", term: "kidney development", evidence: "IEA" },
      { id: "GO:0001822", term: "kidney development", evidence: "ISS" },
      { id: "GO:0006915", term: "apoptotic process", evidence: "IEA" },
    ],
    MF: { id: "GO:0005515", term: "protein binding", evidence: "IPI" },
  },
  pathway: {
    kegg: {
      id: "hsa04979",
      name: "Cholesterol metabolism - Homo sapiens (human)",
    },
    wikipathways: [{ id: "WP2846", name: "PCSK9 mediated LDL receptor degradation" }],
  },
  interpro: [
    {
      id: "IPR000209",
      desc: "Peptidase S8/S53 domain",
      short_desc: "Peptidase_S8/S53_dom",
    },
  ],
  clingen: {
    clinical_validity: {
      classification: "definitive",
      disease_label: "hypercholesterolemia, autosomal dominant, 3",
      moi: "AD",
      online_report: "https://search.clinicalgenome.org/kb/gene-validity/x",
    },
  },
};

const okFetch = (hits: unknown[] = [HIT]) =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ total: hits.length, hits }), {
        status: 200,
      })
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeMyGeneHit", () => {
  it("turns mygene's scalar-or-list fields into lists and dedupes GO terms", () => {
    const a = normalizeMyGeneHit(HIT);
    expect(a.go.BP).toEqual([
      { id: "GO:0006915", term: "apoptotic process" },
      { id: "GO:0001822", term: "kidney development" },
    ]);
    expect(a.go.MF).toEqual([{ id: "GO:0005515", term: "protein binding" }]);
    expect(a.go.CC).toEqual([]);
    expect(a.pathways).toEqual([
      { source: "kegg", id: "hsa04979", name: "Cholesterol metabolism" },
      {
        source: "wikipathways",
        id: "WP2846",
        name: "PCSK9 mediated LDL receptor degradation",
      },
    ]);
    expect(a.clingen).toEqual([
      {
        disease: "hypercholesterolemia, autosomal dominant, 3",
        classification: "definitive",
        modeOfInheritance: "AD",
        report: "https://search.clinicalgenome.org/kb/gene-validity/x",
      },
    ]);
    expect(a.uniprotId).toBe("Q8NBP7");
    expect(a.ensemblGeneId).toBe("ENSG00000169174");
  });

  it("survives a record with nothing but a symbol", () => {
    const a = normalizeMyGeneHit({ symbol: "LINC00001" });
    expect(a.summary).toBeNull();
    expect(a.uniprotId).toBeNull();
    expect(a.pathways).toEqual([]);
    expect(a.clingen).toEqual([]);
  });
});

describe("GET /api/v1/gene_annotation", () => {
  it("queries mygene.info by HGNC id and returns the trimmed record", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(createApp())
      .get("/api/v1/gene_annotation")
      .query({ hgnc_id: "HGNC:20001" });

    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe("PCSK9");
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://mygene.info/v3/query");
    expect(url.searchParams.get("q")).toBe("HGNC:20001");
    expect(url.searchParams.get("species")).toBe("human");
  });

  it("answers a repeated gene from the cache", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp();

    await request(app).get("/api/v1/gene_annotation").query({ hgnc_id: "HGNC:20001" });
    const res = await request(app).get("/api/v1/gene_annotation").query({ hgnc_id: "HGNC:20001" });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "PCSK9", "HGNC:20001 OR symbol:TP53", "HGNC:"])(
    "rejects hgnc_id %s without calling upstream",
    async (hgncId) => {
      const fetchMock = okFetch();
      vi.stubGlobal("fetch", fetchMock);

      const res = await request(createApp())
        .get("/api/v1/gene_annotation")
        .query(hgncId === undefined ? {} : { hgnc_id: hgncId });

      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("returns 404 when mygene.info has no record, and does not cache it", async () => {
    const fetchMock = okFetch([]);
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp();

    const res = await request(app).get("/api/v1/gene_annotation").query({ hgnc_id: "HGNC:1" });
    await request(app).get("/api/v1/gene_annotation").query({ hgnc_id: "HGNC:1" });

    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("collapses an upstream failure to 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 }))
    );

    const res = await request(createApp())
      .get("/api/v1/gene_annotation")
      .query({ hgnc_id: "HGNC:20001" });

    expect(res.status).toBe(502);
  });

  it("returns 504 when mygene.info times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<Response> => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      })
    );

    const res = await request(createApp())
      .get("/api/v1/gene_annotation")
      .query({ hgnc_id: "HGNC:20001" });

    expect(res.status).toBe(504);
  });
});
