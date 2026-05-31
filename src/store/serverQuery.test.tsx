import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useColocByCredibleSet, useNormalizedQuery } from "./serverQuery";

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
