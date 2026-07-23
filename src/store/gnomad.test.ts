import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDataStore } from "./store";
import {
  CredibleSetMembership,
  GnomadFreq,
  NormalizedResponse,
  VariantResult,
} from "../types/types.normalized";

// the store's lazy gnomAD path (genetics-results-browser-3lu.1) fetches via ./gnomad; mock it so we
// can assert the per-page merge, in-flight de-dup, and the shared "ensure all rows" path that the
// sort/filter/export features await — WITHOUT a real network/BFF.
vi.mock("./gnomad", () => ({
  fetchGnomadForVariants: vi.fn(),
}));
import { fetchGnomadForVariants } from "./gnomad";

const mockFetch = vi.mocked(fetchGnomadForVariants);

const freq = (variant: string, af: number): GnomadFreq => ({
  variant,
  afOverall: af,
  byPop: {},
  genomeOrExome: "e",
});

const cs = (): CredibleSetMembership => ({
  resource: "finngen",
  version: "R12",
  dataset: "FinnGen_kanta",
  dataType: "GWAS",
  trait: "T2D",
  traitOriginal: "T2D",
  quantLevel: null,
  cellType: null,
  chr: 1,
  pos: 1,
  ref: "A",
  alt: "G",
  csId: "cs1",
  csSize: 5,
  csMinR2: 0.8,
  mlog10p: 10,
  beta: 0.5,
  se: 0.1,
  pip: 0.9,
  aaf: 0.1,
  mostSevere: "missense_variant",
  geneMostSevere: "GENE",
});

// N variants, each a member of one credible set (so they survive the default pip filter).
const makeResponse = (variantIds: string[]): NormalizedResponse => ({
  queryType: "variant",
  inputVariants: { found: variantIds, notFound: [], unparsed: [], ac0: [], rsidMap: {} },
  variants: variantIds.map(
    (v): VariantResult => ({
      variant: v,
      annotation: { rsid: null, consequence: "", isCoding: false, isLoF: false, gene: null, af: null },
      credibleSets: [cs()],
    })
  ),
  phenotypes: {},
  datasets: {},
  resources: [],
  hasBetas: false,
  hasCustomValues: false,
  meta: { apiVersions: {}, generatedAt: "2026-07-23" },
});

const gnomadOf = (variant: string): GnomadFreq | undefined =>
  useDataStore.getState().normalizedData?.variants.find((v) => v.variant === variant)?.gnomad;

beforeEach(() => {
  mockFetch.mockReset();
  useDataStore.setState({
    normalizedData: undefined,
    filteredVariants: [],
    gnomadLoaded: new Set<string>(),
    gnomadFullyLoaded: true,
    gnomadLoading: false,
    pipThreshold: 0.01,
    pValueThreshold: 1,
    resourceFilter: undefined,
    toggledCredibleSetDataTypes: {},
    includeAllQuantLevels: false,
    selectedPhenotype: undefined,
  });
});

describe("deferred gnomAD store path", () => {
  it("setNormalizedData for the variant path marks gnomAD not-yet-fully-loaded", () => {
    useDataStore.getState().setNormalizedData(makeResponse(["1:1:A:G", "2:2:A:G"]));
    expect(useDataStore.getState().gnomadFullyLoaded).toBe(false);
    expect(useDataStore.getState().gnomadLoaded.size).toBe(0);
    // no variant carries gnomAD yet (it is deferred, loaded lazily per page)
    expect(gnomadOf("1:1:A:G")).toBeUndefined();
  });

  it("loadGnomadForVariants fetches only the requested page and merges it into the store", async () => {
    useDataStore.getState().setNormalizedData(makeResponse(["1:1:A:G", "2:2:A:G", "3:3:A:G"]));
    mockFetch.mockResolvedValueOnce({ "1:1:A:G": freq("1:1:A:G", 0.1) });

    await useDataStore.getState().loadGnomadForVariants(["1:1:A:G"]);

    // only the requested page id was fetched...
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(["1:1:A:G"]);
    // ...and merged into both the raw data and the reactive filteredVariants
    expect(gnomadOf("1:1:A:G")?.afOverall).toBe(0.1);
    expect(gnomadOf("2:2:A:G")).toBeUndefined();
    const fv = useDataStore.getState().filteredVariants.find((v) => v.variant === "1:1:A:G");
    expect(fv?.gnomad?.afOverall).toBe(0.1);
    // partial load -> still not fully loaded
    expect(useDataStore.getState().gnomadFullyLoaded).toBe(false);
  });

  it("does not refetch an already-loaded variant (per-page de-dup)", async () => {
    useDataStore.getState().setNormalizedData(makeResponse(["1:1:A:G", "2:2:A:G"]));
    mockFetch.mockResolvedValueOnce({ "1:1:A:G": freq("1:1:A:G", 0.1) });
    await useDataStore.getState().loadGnomadForVariants(["1:1:A:G"]);

    // re-request the same page: it's already loaded, so no second fetch
    await useDataStore.getState().loadGnomadForVariants(["1:1:A:G"]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("marks a variant loaded even when gnomAD has no row for it, so it is not refetched", async () => {
    useDataStore.getState().setNormalizedData(makeResponse(["1:1:A:G"]));
    mockFetch.mockResolvedValueOnce({}); // gnomAD returns nothing for this variant
    await useDataStore.getState().loadGnomadForVariants(["1:1:A:G"]);

    expect(gnomadOf("1:1:A:G")).toBeUndefined();
    // the single variant is now the whole set and is marked loaded -> fully loaded, no field fabricated
    expect(useDataStore.getState().gnomadFullyLoaded).toBe(true);

    await useDataStore.getState().loadGnomadForVariants(["1:1:A:G"]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("ensureAllGnomadLoaded fetches every not-yet-loaded variant and flips fullyLoaded", async () => {
    useDataStore.getState().setNormalizedData(makeResponse(["1:1:A:G", "2:2:A:G", "3:3:A:G"]));
    // page 1 already loaded
    mockFetch.mockResolvedValueOnce({ "1:1:A:G": freq("1:1:A:G", 0.1) });
    await useDataStore.getState().loadGnomadForVariants(["1:1:A:G"]);

    // ensure-all fetches ONLY the remaining ids (2 and 3), then everything is loaded
    mockFetch.mockResolvedValueOnce({
      "2:2:A:G": freq("2:2:A:G", 0.2),
      "3:3:A:G": freq("3:3:A:G", 0.3),
    });
    await useDataStore.getState().ensureAllGnomadLoaded();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith(["2:2:A:G", "3:3:A:G"]);
    expect(gnomadOf("2:2:A:G")?.afOverall).toBe(0.2);
    expect(gnomadOf("3:3:A:G")?.afOverall).toBe(0.3);
    expect(useDataStore.getState().gnomadFullyLoaded).toBe(true);
  });

  it("de-dupes concurrent ensureAllGnomadLoaded calls into a single fetch (shared in-flight)", async () => {
    useDataStore.getState().setNormalizedData(makeResponse(["1:1:A:G", "2:2:A:G"]));
    let resolveFetch!: (v: Record<string, GnomadFreq>) => void;
    mockFetch.mockReturnValueOnce(
      new Promise<Record<string, GnomadFreq>>((res) => {
        resolveFetch = res;
      })
    );

    // sort + filter + export all triggering the full load at once must share ONE fetch
    const a = useDataStore.getState().ensureAllGnomadLoaded();
    const b = useDataStore.getState().ensureAllGnomadLoaded();
    resolveFetch({ "1:1:A:G": freq("1:1:A:G", 0.1), "2:2:A:G": freq("2:2:A:G", 0.2) });
    await Promise.all([a, b]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(useDataStore.getState().gnomadFullyLoaded).toBe(true);
  });

  it("a new query resets the loaded set and clears any pending in-flight fetches", async () => {
    useDataStore.getState().setNormalizedData(makeResponse(["1:1:A:G"]));
    mockFetch.mockResolvedValueOnce({ "1:1:A:G": freq("1:1:A:G", 0.1) });
    await useDataStore.getState().loadGnomadForVariants(["1:1:A:G"]);
    expect(useDataStore.getState().gnomadLoaded.size).toBe(1);

    useDataStore.getState().setNormalizedData(makeResponse(["9:9:A:G"]));
    expect(useDataStore.getState().gnomadLoaded.size).toBe(0);
    expect(useDataStore.getState().gnomadFullyLoaded).toBe(false);

    // the new query's variant fetches fresh (not blocked by the old loaded set)
    mockFetch.mockResolvedValueOnce({ "9:9:A:G": freq("9:9:A:G", 0.9) });
    await useDataStore.getState().loadGnomadForVariants(["9:9:A:G"]);
    expect(gnomadOf("9:9:A:G")?.afOverall).toBe(0.9);
  });

  it("mergeGnomad refreshes filteredVariants so the AF sort/filter/export see gnomAD", () => {
    useDataStore.getState().setNormalizedData(makeResponse(["1:1:A:G"]));
    const before = useDataStore.getState().filteredVariants[0];
    expect(before.gnomad).toBeUndefined();

    useDataStore.getState().mergeGnomad(["1:1:A:G"], { "1:1:A:G": freq("1:1:A:G", 0.42) });

    const after = useDataStore.getState().filteredVariants[0];
    // fresh object (new reference) carrying gnomAD, so the table re-renders with the AF value
    expect(after).not.toBe(before);
    expect(after.gnomad?.afOverall).toBe(0.42);
  });
});
