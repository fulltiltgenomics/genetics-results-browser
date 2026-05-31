import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useNormalizedQuery } from "./serverQuery";

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
