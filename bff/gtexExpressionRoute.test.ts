import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

const DATASETS = [
  { datasetId: "gtex_v8", gencodeVersion: "v26", genomeBuild: "GRCh38/hg38" },
  { datasetId: "gtex_v11", gencodeVersion: "v47", genomeBuild: "GRCh38/hg38" },
  { datasetId: "kids_first_harmonization", gencodeVersion: "v26", genomeBuild: "GRCh38/hg38" },
  { datasetId: "gtex_v10", gencodeVersion: "v39", genomeBuild: "GRCh38/hg38" },
];

const item = (tissueSiteDetailId: string, data: unknown[]) => ({
  tissueSiteDetailId,
  data,
  unit: "TPM",
});

interface Upstream {
  datasets?: unknown[];
  genes?: unknown[];
  pages?: unknown[][];
  status?: number;
}

// answers the three GTEx endpoints the route calls, and records what each was asked
const gtexFetch = ({
  datasets = DATASETS,
  genes = [{ gencodeId: "ENSG00000169174.13" }],
  pages = [[item("Liver", [1])]],
  status = 200,
}: Upstream = {}) =>
  vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    const body = url.pathname.endsWith("/metadata/dataset")
      ? datasets
      : url.pathname.endsWith("/reference/gene")
        ? { data: genes }
        : {
            data: pages[Number(url.searchParams.get("page"))] ?? [],
            paging_info: { numberOfPages: pages.length },
          };
    return new Response(JSON.stringify(body), { status });
  });

const asked = (fetchMock: ReturnType<typeof gtexFetch>, path: string) =>
  fetchMock.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.pathname.endsWith(path));

afterEach(() => {
  vi.restoreAllMocks();
});

const get = (
  app = createApp(),
  query: Record<string, string> = { ensembl_id: "ENSG00000169174" }
) => request(app).get("/api/v1/gtex_expression").query(query);

describe("GET /api/v1/gtex_expression", () => {
  it("serves the gene's samples in the newest release GTEx lists, and names it", async () => {
    const fetchMock = gtexFetch({
      pages: [
        [
          item("Liver", [28.3, 0, 41.5]),
          item("Whole_Blood", [0.1, null, "x", 0.2]),
          item("Lung", []),
        ],
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ensemblId: "ENSG00000169174",
      gencodeId: "ENSG00000169174.13",
      dataset: "gtex_v11",
      release: "v11",
      unit: "TPM",
      tissues: [
        { tissue: "Liver", values: [28.3, 0, 41.5] },
        { tissue: "Whole_Blood", values: [0.1, 0.2] },
      ],
    });
    // the gene id is resolved in that release's GENCODE, and the expression asked for by it
    const [gene] = asked(fetchMock, "/reference/gene");
    expect(gene.origin + gene.pathname).toBe("https://gtexportal.org/api/v2/reference/gene");
    expect(Object.fromEntries(gene.searchParams)).toEqual({
      geneId: "ENSG00000169174",
      gencodeVersion: "v47",
      genomeBuild: "GRCh38/hg38",
    });
    const [expression] = asked(fetchMock, "/expression/geneExpression");
    expect(expression.searchParams.get("gencodeId")).toBe("ENSG00000169174.13");
    expect(expression.searchParams.get("datasetId")).toBe("gtex_v11");
  });

  it("follows the pages GTEx says there are", async () => {
    const fetchMock = gtexFetch({ pages: [[item("Liver", [1])], [item("Lung", [2])]] });
    vi.stubGlobal("fetch", fetchMock);

    const res = await get();

    expect(res.body.tissues.map((t: { tissue: string }) => t.tissue)).toEqual(["Liver", "Lung"]);
    expect(asked(fetchMock, "/expression/geneExpression")).toHaveLength(2);
  });

  it("answers a repeated gene from the cache, and looks the release up once for two genes", async () => {
    const fetchMock = gtexFetch();
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp();

    await get(app);
    await get(app);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await get(app, { ensembl_id: "ENSG00000130203" });
    expect(asked(fetchMock, "/metadata/dataset")).toHaveLength(1);
  });

  it.each([undefined, "PCSK9", "ENSG00000169174.13", "ENSG00000169174&x=1"])(
    "rejects ensembl_id %s without calling upstream",
    async (ensemblId) => {
      const fetchMock = gtexFetch();
      vi.stubGlobal("fetch", fetchMock);

      const res = await get(createApp(), ensemblId === undefined ? {} : { ensembl_id: ensemblId });

      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("returns 404 for a gene the release does not have, without asking for its expression", async () => {
    const fetchMock = gtexFetch({ genes: [] });
    vi.stubGlobal("fetch", fetchMock);

    expect((await get()).status).toBe(404);
    expect(asked(fetchMock, "/expression/geneExpression")).toHaveLength(0);
  });

  it("returns 404 for a gene with no expression, and does not cache it", async () => {
    const fetchMock = gtexFetch({ pages: [[]] });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp();

    expect((await get(app)).status).toBe(404);
    expect((await get(app)).status).toBe(404);
    expect(asked(fetchMock, "/reference/gene")).toHaveLength(2);
  });

  it("is a 502 when GTEx lists no analysis release, or fails", async () => {
    vi.stubGlobal("fetch", gtexFetch({ datasets: [{ datasetId: "kids_first_harmonization" }] }));
    expect((await get()).status).toBe(502);

    vi.stubGlobal("fetch", gtexFetch({ status: 500 }));
    expect((await get()).status).toBe(502);
  });

  it("returns 504 when GTEx times out", async () => {
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
