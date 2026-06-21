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
  resources: [
    {
      id: "finngen",
      resource: "FinnGen",
      dataTypes: ["gwas"],
      hasSummaryStats: true,
      hasCredibleSets: true,
      hasPseudoCredibleSets: false,
    },
  ],
  hasBetas: false,
  hasCustomValues: false,
  meta: { apiVersions: {}, generatedAt: "2026-05-31" },
});

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

  it("marks pseudo-credible-set resources with a '*' and leaves real ones unmarked", () => {
    const response = makeResponse([
      makeCS({ resource: "finngen", trait: "A" }),
      makeCS({ resource: "pgc", trait: "B" }),
    ]);
    response.resources = [
      { id: "finngen", resource: "FinnGen", dataTypes: ["gwas"], hasSummaryStats: true, hasCredibleSets: true, hasPseudoCredibleSets: false },
      { id: "pgc", resource: "PGC", dataTypes: ["gwas"], hasSummaryStats: false, hasCredibleSets: true, hasPseudoCredibleSets: true },
    ];
    useDataStore.getState().setNormalizedData(response);
    render(<ResourceFilter isNotReadyYet={false} />);

    // the pseudo resource's toggle carries the "*" marker; the real one does not.
    expect(screen.getByText("*")).toBeInTheDocument();
    expect(screen.getByLabelText("FinnGen")).toBeInTheDocument();
  });

  it("omits resources that have no credible sets (a no-op toggle would only mislead)", () => {
    const response = makeResponse([makeCS({ resource: "finngen", trait: "A" })]);
    response.resources = [
      { id: "finngen", resource: "FinnGen", dataTypes: ["gwas"], hasSummaryStats: true, hasCredibleSets: true, hasPseudoCredibleSets: false },
      { id: "gtex", resource: "GTEx", dataTypes: ["expression"], hasSummaryStats: false, hasCredibleSets: false, hasPseudoCredibleSets: false },
    ];
    useDataStore.getState().setNormalizedData(response);
    render(<ResourceFilter isNotReadyYet={false} />);

    expect(screen.getByLabelText("FinnGen")).toBeInTheDocument();
    expect(screen.queryByLabelText("GTEx")).not.toBeInTheDocument();
  });

  it("first untoggle of a zero-row CS resource leaves the other displayed resources on", async () => {
    // regression: gp2/covid_hgi/pgc have credible sets but no CS rows for the current variants, so
    // seeding the filter only from present-in-data resources dropped them, untoggling several at once.
    const user = userEvent.setup();
    const response = makeResponse([makeCS({ resource: "finngen", trait: "A" })]);
    response.resources = [
      { id: "finngen", resource: "FinnGen", dataTypes: ["gwas"], hasSummaryStats: true, hasCredibleSets: true, hasPseudoCredibleSets: false },
      { id: "gp2", resource: "gp2", dataTypes: ["gwas"], hasSummaryStats: false, hasCredibleSets: true, hasPseudoCredibleSets: true },
      { id: "covid_hgi", resource: "covid_hgi", dataTypes: ["gwas"], hasSummaryStats: false, hasCredibleSets: true, hasPseudoCredibleSets: true },
      { id: "pgc", resource: "pgc", dataTypes: ["gwas"], hasSummaryStats: false, hasCredibleSets: true, hasPseudoCredibleSets: true },
    ];
    useDataStore.getState().setNormalizedData(response);
    render(<ResourceFilter isNotReadyYet={false} />);

    // pseudo toggles share the "*" accessible-name suffix; scope each query to its FormControlLabel.
    const gp2Toggle = screen.getByRole("checkbox", { name: /^gp2/ });
    await user.click(gp2Toggle);

    const filter = useDataStore.getState().resourceFilter!;
    expect(filter.has("gp2")).toBe(false);
    expect(filter.has("finngen")).toBe(true);
    expect(filter.has("covid_hgi")).toBe(true);
    expect(filter.has("pgc")).toBe(true);
  });

  it("orders real CS resources first, then pseudo, each in preferred order with unknowns last", () => {
    const response = makeResponse([makeCS({ resource: "finngen", trait: "A" })]);
    // seeded scrambled; labels equal ids here so the accessible names are predictable.
    const r = (id: string, pseudo: boolean): NormalizedResponse["resources"][number] => ({
      id,
      resource: id,
      dataTypes: ["gwas"],
      hasSummaryStats: false,
      hasCredibleSets: true,
      hasPseudoCredibleSets: pseudo,
    });
    response.resources = [
      r("ukbb", false),
      r("pgc", true),
      r("finngen", false),
      r("finngen_ukbb", true),
      r("zzz_new_real", false),
      r("eqtl_catalogue", false),
      r("finngen_mvp_ukbb", true),
      r("open_targets", false),
    ];
    useDataStore.getState().setNormalizedData(response);
    render(<ResourceFilter isNotReadyYet={false} />);

    // DOM order = real column (preferred ids, then unknowns alphabetically) then pseudo column.
    // scope to the Resources section so the Data types toggles aren't picked up.
    const resourcesSection = screen.getByText("Resources").parentElement!;
    const order = within(resourcesSection)
      .getAllByRole("checkbox")
      .map((cb) => cb.closest("label")?.textContent?.replace("*", "").trim());
    expect(order).toEqual([
      "finngen",
      "open_targets",
      "eqtl_catalogue",
      "ukbb",
      "zzz_new_real",
      "finngen_mvp_ukbb",
      "finngen_ukbb",
      "pgc",
    ]);
  });

  it("disables all switches when not ready", () => {
    useDataStore.getState().setNormalizedData(makeResponse([makeCS({ resource: "finngen" })]));
    render(<ResourceFilter isNotReadyYet={true} />);
    expect(screen.getByLabelText("FinnGen")).toBeDisabled();
  });

  it("hides the quant-level toggle when there is no leveled eQTL data", () => {
    useDataStore.getState().setNormalizedData(makeResponse([makeCS({ resource: "finngen" })]));
    render(<ResourceFilter isNotReadyYet={false} />);
    expect(screen.queryByText("eQTL quantification")).not.toBeInTheDocument();
  });

  it("shows the quant-level toggle and reactively reveals non-ge levels when turned on", async () => {
    const user = userEvent.setup();
    useDataStore.getState().setNormalizedData(
      makeResponse([
        makeCS({ resource: "eqtl_catalogue", trait: "CLASRP", dataType: "eQTL", quantLevel: "ge" }),
        makeCS({
          resource: "eqtl_catalogue",
          trait: "CLASRP",
          dataType: "eQTL",
          quantLevel: "exon",
          csId: "cs2",
        }),
      ])
    );
    render(<ResourceFilter isNotReadyYet={false} />);

    // default off = ge-level only: the exon row is filtered out (refactor.md §4).
    expect(
      useDataStore.getState().filteredVariants[0].credibleSets.map((c) => c.quantLevel)
    ).toEqual(["ge"]);

    const toggle = screen.getByLabelText(
      "Show all eQTL Catalogue quantification levels (exon/tx/txrev/leafcutter/majiq)"
    );
    await user.click(toggle);

    expect(useDataStore.getState().includeAllQuantLevels).toBe(true);
    expect(
      useDataStore.getState().filteredVariants[0].credibleSets.map((c) => c.quantLevel).sort()
    ).toEqual(["exon", "ge"]);
  });
});
