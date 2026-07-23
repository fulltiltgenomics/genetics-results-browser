import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { clearDatasetsCache } from "./normalize.js";

import csByGene from "../src/test/fixtures/credible_sets_by_gene.json" with { type: "json" };
import datasets from "../src/test/fixtures/datasets.json" with { type: "json" };

const app = createApp();

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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

const routeFetch = () =>
  vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/v1/credible_sets_by_gene")) return tsv(csByGene);
    if (u.includes("/v1/datasets")) return json(datasets);
    return json({}, 404);
  });

const datasetsCalls = (mock: ReturnType<typeof routeFetch>): number =>
  mock.mock.calls.filter((c) => String(c[0]).includes("/v1/datasets")).length;

afterEach(() => {
  vi.restoreAllMocks();
  // the datasets cache is a process-wide singleton; reset it so each case starts empty
  clearDatasetsCache();
});

describe("/v1/datasets process-wide cache", () => {
  it("fetches /v1/datasets only once across multiple queries", async () => {
    const fetchMock = routeFetch();
    vi.stubGlobal("fetch", fetchMock);

    await request(app).get("/api/v1/gene_results/CLASRP");
    await request(app).get("/api/v1/gene_results/CLASRP");

    expect(datasetsCalls(fetchMock)).toBe(1);
  });

  it("refetches after the cache is cleared (e.g. a process restart)", async () => {
    const fetchMock = routeFetch();
    vi.stubGlobal("fetch", fetchMock);

    await request(app).get("/api/v1/gene_results/CLASRP");
    clearDatasetsCache();
    await request(app).get("/api/v1/gene_results/CLASRP");

    expect(datasetsCalls(fetchMock)).toBe(2);
  });
});
