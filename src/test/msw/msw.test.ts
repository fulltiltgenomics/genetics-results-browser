import { describe, expect, it } from "vitest";
import api from "@/store/api";
import { server } from "./server";
import { http, HttpResponse } from "msw";

// proves the mock layer is wired end to end: the project's axios client (configured from VITE_API_URL)
// hits an endpoint and gets the captured fixture back, with no real network.
describe("MSW mock layer", () => {
  it("returns the credible_sets_by_variant fixture through the app's api client", async () => {
    const { data } = await api.get("/v1/credible_sets_by_variant/19-44908684-T-C", {
      params: { format: "json" },
    });

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    // fixture is real API output, so it carries the credible-set record shape and pleiotropic data types
    expect(data[0]).toMatchObject({ chr: 19, pos: 44908684, ref: "T", alt: "C" });
    const dataTypes = new Set(data.map((r: { data_type: string }) => r.data_type));
    expect(dataTypes).toContain("GWAS");
    expect(dataTypes).toContain("pQTL");
  });

  it("serves the datasets fixture", async () => {
    const { data } = await api.get("/v1/datasets");
    expect(data.some((d: { data_type: string }) => d.data_type === "gwas")).toBe(true);
  });

  it("supports per-test handler overrides via resetHandlers afterEach", async () => {
    server.use(
      http.get("*/api/v1/datasets", () => HttpResponse.json([{ dataset_id: "override" }]))
    );
    const { data } = await api.get("/v1/datasets");
    expect(data).toEqual([{ dataset_id: "override" }]);
  });
});
