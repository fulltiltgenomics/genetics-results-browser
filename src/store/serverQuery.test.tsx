import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import {
  useColocByCredibleSet,
  useGeneCredibleSets,
  useGeneInfo,
  useGenesInRegion,
  useGeneTransCredibleSets,
  useNormalizedQuery,
  usePhenotypeSearch,
  useSummaryStats,
} from "./serverQuery";

// fresh client with retries off so a failing query rejects immediately instead of retrying for seconds
const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};

describe("useNormalizedQuery (BFF stage-1 fetch)", () => {
  it("POSTs { query } to /v1/results and returns the NormalizedResponse", async () => {
    const { result } = renderHook(() => useNormalizedQuery("19-44908684-T-C"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data!;
    expect(data.queryType).toBe("variant");
    expect(data.inputVariants.found).toEqual(["19:44908684:T:C"]);
    // raw, unfiltered credible sets come through untouched (stage 2 munge filters later)
    expect(data.variants[0].variant).toBe("19:44908684:T:C");
    expect(data.variants[0].credibleSets.length).toBeGreaterThan(0);
    expect(data.resources.length).toBeGreaterThan(0);
    expect(Object.keys(data.datasets).length).toBeGreaterThan(0);
  });

  it("stays disabled (no fetch) when the input is empty", () => {
    const { result } = renderHook(() => useNormalizedQuery(undefined), {
      wrapper: makeWrapper(),
    });
    // enabled:!!variantInput keeps the query idle, so it never resolves data
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });
});

describe("useColocByCredibleSet (lazy per-credible-set colocalization)", () => {
  it("stays idle until enabled (lazy fetch)", () => {
    const { result } = renderHook(
      () => useColocByCredibleSet("finngen", "AD_LO_EXMORE", "chr19:..._1", false),
      { wrapper: makeWrapper() }
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("maps partner rows to ColocPair, filters by PP.H4, and sorts descending", async () => {
    const { result } = renderHook(
      () => useColocByCredibleSet("finngen", "AD_LO_EXMORE", "chr19:40193321-46644804_1", true),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const pairs = result.current.data!;
    // all three fixture rows have PP.H4 >= 0.5, so all survive; sorted by PP.H4 desc
    expect(pairs.length).toBe(3);
    expect(pairs.map((p) => p.ppH4)).toEqual([...pairs.map((p) => p.ppH4)].sort((a, b) => b - a));

    const top = pairs[0];
    expect(top.resource2).toBe("finngen");
    expect(top.dataType2).toBe("GWAS");
    expect(top.trait2).toBe("AD_LO_EXMORE");
    expect(top.ppH4).toBe(0.9999);
    expect(top.clpp).toBe(0.9618);
    expect(top.cs2Size).toBe(1);
    expect(top.hit2).toBe("19:44908684:T:C");
  });
});

describe("usePhenotypeSearch (phenotype autocomplete, has_summary_stats)", () => {
  it("stays idle for queries shorter than 2 chars", () => {
    const { result } = renderHook(() => usePhenotypeSearch("a"), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("maps /search rows to PhenotypeSearchHit", async () => {
    const { result } = renderHook(() => usePhenotypeSearch("asthma"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const hits = result.current.data!;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({
      code: "ASTHMA_OBESITY",
      resource: "finngen",
      dataType: "gwas",
      hasSummaryStats: true,
    });
    expect(hits[0].sampleSize).toBe(455643);
  });
});

describe("gene view hooks (credible sets + gene track on the new API)", () => {
  it("useGeneInfo resolves a gene symbol to its coordinates via /search", async () => {
    const { result } = renderHook(() => useGeneInfo("APOE"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const info = result.current.data!;
    expect(info.symbol).toBe("APOE");
    expect(info.chr).toBe("19");
    expect(info.start).toBeGreaterThan(0);
    expect(info.end).toBeGreaterThan(info.start);
  });

  it("useGeneCredibleSets returns grouped CSDatum[] from credible_sets_by_gene", async () => {
    const { result } = renderHook(() => useGeneCredibleSets("APOE"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    expect(data.length).toBeGreaterThan(0);
    // resource is rewritten to the legacy config dataName so the view's color/toggle logic works
    expect(data.every((d) => d.resource && !d.resource.includes("_catalogue"))).toBe(true);
    expect(data.every((d) => d.variant.length === d.pip.length)).toBe(true);
  });

  it("useGeneTransCredibleSets returns grouped CSDatum[] from credible_sets_by_qtl_gene", async () => {
    const { result } = renderHook(() => useGeneTransCredibleSets("APOE"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((d) => ["eQTL", "pQTL", "sQTL"].includes(d.dataType))).toBe(true);
  });

  it("useGenesInRegion adapts genes_in_region rows into GeneModel[]", async () => {
    const { result } = renderHook(() => useGenesInRegion("19", 44900000, 44920000), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const models = result.current.data!;
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.exonStarts.length === 1)).toBe(true);
  });

  it("useGenesInRegion stays idle until coordinates are known", () => {
    const { result } = renderHook(() => useGenesInRegion(undefined, undefined, undefined), {
      wrapper: makeWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useSummaryStats (full sumstats for input variants × phenotype)", () => {
  it("stays idle without variants", () => {
    const { result } = renderHook(
      () => useSummaryStats("finngen", "gwas", undefined, "ASTHMA_OBESITY"),
      { wrapper: makeWrapper() }
    );
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches summary-stat rows for the given variants and phenotype", async () => {
    const { result } = renderHook(
      () => useSummaryStats("finngen", "gwas", ["19:44908684:T:C"], "ASTHMA_OBESITY"),
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const rows = result.current.data!;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      resource: "finngen",
      phenotype: "ASTHMA_OBESITY",
      chr: 19,
      pos: 44908684,
      rsids: "rs429358",
    });
  });
});
