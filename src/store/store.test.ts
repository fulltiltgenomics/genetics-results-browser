import { describe, it, expect, beforeEach } from "vitest";
import { useDataStore } from "./store";
import {
  CredibleSetMembership,
  NormalizedResponse,
  VariantResult,
} from "../types/types.normalized";

// tests for the normalized credible-set path wired into the Zustand store (.14). we drive the
// store directly via getState()/the setters and assert filteredVariants recomputes reactively from
// the raw normalizedData WITHOUT any refetch (stage-2 is client-side, refactor.md §1).
// the legacy path (serverData/clientData) is untouched and covered elsewhere.

const makeCS = (over: Partial<CredibleSetMembership> = {}): CredibleSetMembership => ({
  resource: "finngen",
  version: "R12",
  dataset: "FinnGen_kanta",
  dataType: "GWAS",
  trait: "T2D",
  traitOriginal: "T2D",
  quantLevel: null,
  cellType: null,
  chr: 19,
  pos: 44908684,
  ref: "T",
  alt: "C",
  csId: "cs1",
  csSize: 5,
  csMinR2: 0.8,
  mlog10p: 10,
  beta: 0.5,
  se: 0.1,
  pip: 0.5,
  aaf: 0.1,
  mostSevere: "missense_variant",
  geneMostSevere: "APOE",
  ...over,
});

const makeResponse = (credibleSets: CredibleSetMembership[]): NormalizedResponse => ({
  queryType: "variant",
  inputVariants: { found: ["19:44908684:T:C"], notFound: [], unparsed: [], ac0: [], rsidMap: {} },
  variants: [
    {
      variant: "19:44908684:T:C",
      annotation: {
        rsid: "rs429358",
        consequence: "missense variant",
        isCoding: true,
        isLoF: false,
        gene: "APOE",
        af: 0.18,
      },
      credibleSets,
    } as VariantResult,
  ],
  phenotypes: {},
  datasets: {},
  resources: [],
  hasBetas: false,
  hasCustomValues: false,
  meta: { apiVersions: {}, generatedAt: "2026-05-31" },
});

// surviving trait list of the (single) variant, for terse assertions.
const traits = () =>
  useDataStore
    .getState()
    .filteredVariants[0].credibleSets.map((c) => c.trait)
    .sort();

// reset only the normalized-path fields back to their defaults between tests (the legacy fields are
// irrelevant here). a fresh store per test would need module re-import; resetting state is simpler.
beforeEach(() => {
  useDataStore.setState({
    normalizedData: undefined,
    filteredVariants: [],
    pipThreshold: 0.01,
    pValueThreshold: 1,
    resourceFilter: undefined,
    toggledCredibleSetDataTypes: {},
    includeAllQuantLevels: false,
    selectedPhenotype: undefined,
  });
});

describe("store normalized path", () => {
  it("setNormalizedData populates filteredVariants (applying default filters)", () => {
    const s = useDataStore.getState();
    s.setNormalizedData(
      makeResponse([
        makeCS({ trait: "KEEP", pip: 0.9 }),
        makeCS({ trait: "DROP_LOW_PIP", pip: 0.001 }), // below default pipThreshold 0.01
      ])
    );
    // default pipThreshold 0.01 already drops the low-pip row at ingest time.
    expect(traits()).toEqual(["KEEP"]);
  });

  it("starts with empty filteredVariants and no data", () => {
    expect(useDataStore.getState().normalizedData).toBeUndefined();
    expect(useDataStore.getState().filteredVariants).toEqual([]);
  });

  it("changing pipThreshold recomputes from the same raw data (no refetch)", () => {
    const s = useDataStore.getState();
    s.setNormalizedData(makeResponse([makeCS({ trait: "A", pip: 0.6 }), makeCS({ trait: "B", pip: 0.3 })]));
    expect(traits()).toEqual(["A", "B"]); // both above default 0.01
    const dataRef = useDataStore.getState().normalizedData;
    useDataStore.getState().setPipThreshold(0.5);
    expect(traits()).toEqual(["A"]); // B dropped
    // raw payload object is the SAME reference -> recompute is client-side, never refetched.
    expect(useDataStore.getState().normalizedData).toBe(dataRef);
  });

  it("changing pValueThreshold recomputes filteredVariants", () => {
    const s = useDataStore.getState();
    s.setNormalizedData(
      makeResponse([makeCS({ trait: "SIG", mlog10p: 8 }), makeCS({ trait: "NS", mlog10p: 1 })])
    );
    expect(traits().sort()).toEqual(["NS", "SIG"]); // both kept at default threshold 1
    useDataStore.getState().setPValueThreshold(0.05);
    expect(traits()).toEqual(["SIG"]); // NS (p=0.1) dropped
  });

  it("setResourceFilter recomputes; toggleResource flips a single resource", () => {
    const s = useDataStore.getState();
    s.setNormalizedData(
      makeResponse([
        makeCS({ trait: "FG", resource: "finngen" }),
        makeCS({ trait: "UK", resource: "ukbb" }),
      ])
    );
    useDataStore.getState().setResourceFilter(new Set(["finngen"]));
    expect(traits()).toEqual(["FG"]);

    // toggleResource from undefined seeds from present resources then removes the clicked one.
    useDataStore.getState().setResourceFilter(undefined);
    useDataStore.getState().toggleResource("ukbb");
    expect(useDataStore.getState().resourceFilter).toEqual(new Set(["finngen"]));
    expect(traits()).toEqual(["FG"]);
    // toggling it back adds it again.
    useDataStore.getState().toggleResource("ukbb");
    expect(traits()).toEqual(["FG", "UK"]);
  });

  it("toggleCredibleSetDataType flips an absent type to disabled and back", () => {
    const s = useDataStore.getState();
    s.setNormalizedData(
      makeResponse([
        makeCS({ trait: "G", dataType: "GWAS" }),
        makeCS({ trait: "E", dataType: "eQTL", quantLevel: "ge" }),
      ])
    );
    expect(traits()).toEqual(["E", "G"]); // both enabled by default (absent = on)
    useDataStore.getState().toggleCredibleSetDataType("eQTL");
    expect(useDataStore.getState().toggledCredibleSetDataTypes.eQTL).toBe(false);
    expect(traits()).toEqual(["G"]);
    useDataStore.getState().toggleCredibleSetDataType("eQTL");
    expect(useDataStore.getState().toggledCredibleSetDataTypes.eQTL).toBe(true);
    expect(traits()).toEqual(["E", "G"]);
  });

  it("includeAllQuantLevels gates non-gene eQTL levels (default ge-only)", () => {
    const s = useDataStore.getState();
    s.setNormalizedData(
      makeResponse([
        makeCS({ trait: "GE", dataType: "eQTL", quantLevel: "ge" }),
        makeCS({ trait: "EXON", dataType: "eQTL", quantLevel: "exon" }),
      ])
    );
    expect(traits()).toEqual(["GE"]); // default false -> exon dropped
    useDataStore.getState().setIncludeAllQuantLevels(true);
    expect(traits()).toEqual(["EXON", "GE"]);
  });

  it("setSelectedPhenotype narrows to one resource+trait", () => {
    const s = useDataStore.getState();
    s.setNormalizedData(
      makeResponse([
        makeCS({ trait: "A", resource: "finngen" }),
        makeCS({ trait: "B", resource: "finngen" }),
        makeCS({ trait: "A", resource: "ukbb" }),
      ])
    );
    useDataStore.getState().setSelectedPhenotype({ resource: "finngen", trait: "A" });
    const cs = useDataStore.getState().filteredVariants[0].credibleSets;
    expect(cs).toHaveLength(1);
    expect(cs[0].resource).toBe("finngen");
    expect(cs[0].trait).toBe("A");
  });

  it("setPhenotypeSearchSelection does NOT narrow filteredVariants (handoff is search-tab-only)", () => {
    const s = useDataStore.getState();
    s.setNormalizedData(
      makeResponse([
        makeCS({ trait: "A", resource: "finngen" }),
        makeCS({ trait: "B", resource: "finngen" }),
        makeCS({ trait: "A", resource: "ukbb" }),
      ])
    );
    // picking a phenotype for the search tab must leave the other tables' data fully intact
    useDataStore.getState().setPhenotypeSearchSelection({ resource: "finngen", trait: "A" });
    expect(useDataStore.getState().filteredVariants[0].credibleSets).toHaveLength(3);
  });

  it("combines multiple active filters (pip + resource + data type)", () => {
    const s = useDataStore.getState();
    s.setNormalizedData(
      makeResponse([
        makeCS({ trait: "KEEP", resource: "finngen", dataType: "GWAS", pip: 0.9 }),
        makeCS({ trait: "WRONG_RES", resource: "ukbb", dataType: "GWAS", pip: 0.9 }),
        makeCS({ trait: "LOW_PIP", resource: "finngen", dataType: "GWAS", pip: 0.1 }),
        makeCS({ trait: "OFF_TYPE", resource: "finngen", dataType: "pQTL", pip: 0.9 }),
      ])
    );
    useDataStore.getState().setPipThreshold(0.5);
    useDataStore.getState().setResourceFilter(new Set(["finngen"]));
    useDataStore.getState().toggleCredibleSetDataType("pQTL"); // off
    expect(traits()).toEqual(["KEEP"]);
  });
});
