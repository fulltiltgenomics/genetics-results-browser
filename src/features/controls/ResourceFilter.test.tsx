import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResourceFilter from "./ResourceFilter";
import { useDataStore } from "../../store/store";
import {
  CredibleSetMembership,
  NormalizedResponse,
  VariantResult,
} from "../../types/types.normalized";

// drives the real store (no mock): seeds normalizedData, renders the control, and asserts it
// derives the resource list from the CS data and that toggling flows through to the store and
// reactively refilters filteredVariants (stage-2, no refetch — refactor.md §4).

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
  pip: 0.9,
  aaf: 0.1,
  mostSevere: "missense_variant",
  geneMostSevere: "APOE",
  ...over,
});

const makeResponse = (credibleSets: CredibleSetMembership[]): NormalizedResponse => ({
  queryType: "variant",
  inputVariants: { found: ["19:44908684:T:C"], notFound: [], unparsed: [], ac0: [], rsidMap: {} },
  variants: [
    { variant: "19:44908684:T:C", annotation: {} as VariantResult["annotation"], credibleSets },
  ],
  phenotypes: {},
  datasets: {},
  resources: [{ id: "finngen", resource: "FinnGen", dataTypes: ["gwas"], hasSummaryStats: true }],
  hasBetas: false,
  hasCustomValues: false,
  meta: { apiVersions: {}, generatedAt: "2026-05-31" },
});

beforeEach(() => {
  useDataStore.setState({
    normalizedData: undefined,
    filteredVariants: [],
    pipThreshold: 0.01,
    csMinR2Threshold: 0,
    resourceFilter: undefined,
    toggledCredibleSetDataTypes: {},
    includeAllQuantLevels: false,
    selectedPhenotype: undefined,
  });
});

describe("ResourceFilter", () => {
  it("lists distinct resources present in the CS data, with ResourceMeta labels when available", () => {
    useDataStore.getState().setNormalizedData(
      makeResponse([
        makeCS({ resource: "finngen", trait: "A" }),
        makeCS({ resource: "ukbb", trait: "B" }),
        makeCS({ resource: "eqtl_catalogue", trait: "C", dataType: "eQTL" }),
      ])
    );
    render(<ResourceFilter isNotReadyYet={false} />);

    // "finngen" id maps to the friendly "FinnGen" label; the others fall back to their id.
    expect(screen.getByLabelText("FinnGen")).toBeInTheDocument();
    expect(screen.getByLabelText("ukbb")).toBeInTheDocument();
    expect(screen.getByLabelText("eqtl_catalogue")).toBeInTheDocument();
  });

  it("toggling a resource off updates the store and reactively drops its CS rows", async () => {
    const user = userEvent.setup();
    useDataStore.getState().setNormalizedData(
      makeResponse([
        makeCS({ resource: "finngen", trait: "A" }),
        makeCS({ resource: "ukbb", trait: "B" }),
      ])
    );
    render(<ResourceFilter isNotReadyYet={false} />);

    // both resources start enabled (resourceFilter undefined = all on).
    expect(useDataStore.getState().filteredVariants[0].credibleSets).toHaveLength(2);

    await user.click(screen.getByLabelText("ukbb"));

    expect(useDataStore.getState().resourceFilter).toEqual(new Set(["finngen"]));
    const remaining = useDataStore
      .getState()
      .filteredVariants[0].credibleSets.map((c) => c.resource);
    expect(remaining).toEqual(["finngen"]);
  });

  it("renders data-type toggles wired to the new credible-set filter path", async () => {
    const user = userEvent.setup();
    useDataStore.getState().setNormalizedData(
      makeResponse([
        makeCS({ resource: "finngen", trait: "A", dataType: "GWAS" }),
        makeCS({ resource: "eqtl_catalogue", trait: "B", dataType: "eQTL" }),
      ])
    );
    render(<ResourceFilter isNotReadyYet={false} />);

    const dataTypeGroup = screen.getByText("Data types").closest("div")!;
    await user.click(within(dataTypeGroup).getByLabelText("eQTL"));

    expect(useDataStore.getState().toggledCredibleSetDataTypes.eQTL).toBe(false);
    const remaining = useDataStore
      .getState()
      .filteredVariants[0].credibleSets.map((c) => c.dataType);
    expect(remaining).toEqual(["GWAS"]);
  });

  it("disables all switches when not ready", () => {
    useDataStore.getState().setNormalizedData(makeResponse([makeCS({ resource: "finngen" })]));
    render(<ResourceFilter isNotReadyYet={true} />);
    expect(screen.getByLabelText("FinnGen")).toBeDisabled();
  });
});
