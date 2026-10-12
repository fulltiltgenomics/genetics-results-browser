import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PhenotypeSearchContainer from "./PhenotypeSearchContainer";
import { useDataStore } from "../../store/store";
import { CredibleSetDataType, NormalizedResponse } from "../../types/types.normalized";
import * as exportModule from "../table/utils/export";

// capture what the download button hands the exporter (jsdom cannot save a file)
const exportSpy = vi.hoisted(() => vi.fn());
vi.mock("../table/utils/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../table/utils/export")>()),
  exportPhenotypeSearch: exportSpy,
}));

// component coverage for the phenotype-search tab (refactor.md §5). seeds the store with the real
// fixture (so input variants + per-variant credible sets are present), preselects a phenotype via
// store.selectedPhenotype (the Phenotype summary handoff path), and asserts the summary-stats table
// renders per-variant rows with the inCredibleSet flag derived from the store's credible sets.

const fixture = require("../../test/fixtures/normalized_response.json") as NormalizedResponse;

const Wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
};

beforeEach(() => {
  const s = useDataStore.getState();
  s.setVariantInput("19:44908684:T:C");
  s.setPipThreshold(0);
  s.setPhenotypeSearchSelection(undefined);
  s.setNormalizedData(fixture);
});

describe("PhenotypeSearchContainer (phenotype search tab)", () => {
  it("prompts the user to enter variants when there are no input variants", () => {
    useDataStore.getState().setNormalizedData(undefined);
    render(<PhenotypeSearchContainer />, { wrapper: Wrapper });
    expect(screen.getByText(/enter variants/i)).toBeInTheDocument();
  });

  it("preselects from the Phenotype summary handoff and renders a populated sumstats table", async () => {
    // trait 3000242 has a GWAS credible set for 19:44908684:T:C in the fixture, so inCredibleSet=true
    useDataStore.getState().setPhenotypeSearchSelection({ resource: "finngen", trait: "3000242" });
    render(<PhenotypeSearchContainer />, { wrapper: Wrapper });

    // the sumstats fixture row is for 19:44908684:T:C
    await waitFor(() =>
      expect(screen.getByText("19:44908684:T:C")).toBeInTheDocument()
    );
    expect(screen.getByText("rs429358")).toBeInTheDocument();
    // inCredibleSet flag rendered as a "yes" chip
    expect(screen.getByText("yes")).toBeInTheDocument();
  });

  // For GWAS the credible-set `trait` is now a harmonized display name while `trait_original` is the
  // phenocode; summary_stats (and therefore the search box's /search `code`) keys on the phenocode.
  // So the inCredibleSet join must match cs.trait_original (not cs.trait) for GWAS — the handoff carries
  // trait_original alongside the display trait. These cases pin that: each CS has a display trait that
  // DIFFERS from its phenocode, and only a join on trait_original yields the "yes" chip (a join on the
  // display trait would read "no"). See sumstatsPhenoId in PhenotypeSearchContainer.
  const gwasDisplayVsPhenocode: Array<{ resource: string; code: string; display: string }> = [
    { resource: "finngen", code: "G6_ALZHEIMER", display: "Alzheimer_disease" },
    { resource: "pgc", code: "SCZ", display: "Schizophrenia" },
    { resource: "gp2", code: "PD", display: "Parkinson’s_disease" },
    { resource: "covid_hgi", code: "COVID_C2", display: "COVID-19" },
  ];

  it.each(gwasDisplayVsPhenocode)(
    "flags inCredibleSet for $resource GWAS by matching trait_original ($code), not the display trait",
    async ({ resource, code, display }) => {
      // one input variant (matching the summary_stats fixture row at 19:44908684:T:C) whose single CS
      // membership is a GWAS signal with a harmonized display trait != its phenocode trait_original.
      const csVariant: NormalizedResponse["variants"][number] = {
        ...fixture.variants[0],
        credibleSets: [
          {
            ...fixture.variants[0].credibleSets[0],
            resource,
            dataType: "GWAS",
            trait: display,
            traitOriginal: code,
            pip: 0.5,
          },
        ],
      };
      const seeded: NormalizedResponse = {
        ...fixture,
        variants: [csVariant],
        inputVariants: { ...fixture.inputVariants, found: ["19:44908684:T:C"] },
        // the handoff reads data_type from phenotypes[`${resource}|${trait}`] (keyed by display trait)
        phenotypes: {
          ...fixture.phenotypes,
          [`${resource}|${display}`]: {
            resource,
            dataType: "GWAS",
            trait: display,
            phenostring: display,
          },
        },
      };
      useDataStore.getState().setNormalizedData(seeded);
      // the handoff carries the display trait AND the phenocode (trait_original)
      useDataStore
        .getState()
        .setPhenotypeSearchSelection({ resource, trait: display, traitOriginal: code });

      render(<PhenotypeSearchContainer />, { wrapper: Wrapper });

      await waitFor(() =>
        expect(screen.getByText("19:44908684:T:C")).toBeInTheDocument()
      );
      // a "yes" chip proves the join matched cs.trait_original against the phenocode (a join on the
      // display trait, or a handoff that passed the display name to summary_stats, would read "no")
      expect(screen.getByText("yes")).toBeInTheDocument();
    }
  );

  // an R14 four-cohort meta-analysis row: fg + aou_eur contributed, mvp_afr is present-but-null as a
  // multi-phenotype union header leaves it, and one leave-one-out block. the detail is discovered
  // from these keys, not from fixed column definitions.
  const r14Row = {
    resource: "finngen_mvp_ukbb_aou",
    version: "R14",
    phenotype: "T2D",
    chr: 19,
    pos: 44908684,
    ref: "T",
    alt: "C",
    rsids: "rs429358",
    nearest_genes: "APOE",
    pval: 1e-10,
    mlog10p: 10,
    beta: 0.05,
    se: 0.01,
    af: 0.15,
    meta_n: 1500000,
    fg_beta: 0.061,
    fg_se: 0.012,
    fg_pval: 2e-7,
    fg_af: 0.181,
    aou_eur_beta: 0.042,
    aou_eur_se: 0.015,
    aou_eur_pval: 0.005,
    aou_eur_af: 0.152,
    mvp_afr_beta: null,
    mvp_afr_se: null,
    mvp_afr_pval: null,
    mvp_afr_af: null,
    mvp_afr_r2: null,
    leave_aou_beta: 0.055,
    leave_aou_se: 0.011,
    leave_aou_pval: 6e-7,
    leave_aou_mlog10p: 6.2218,
    leave_aou_n: 1100000,
    leave_aou_het_p: 0.42,
  };

  const handoffR14 = () => {
    useDataStore.getState().setNormalizedData({
      ...fixture,
      phenotypes: {
        ...fixture.phenotypes,
        "finngen_mvp_ukbb_aou|T2D": {
          resource: "finngen_mvp_ukbb_aou",
          dataType: "GWAS",
          trait: "T2D",
          phenostring: "Type 2 diabetes",
        },
      },
    });
    useDataStore
      .getState()
      .setPhenotypeSearchSelection({ resource: "finngen_mvp_ukbb_aou", trait: "T2D" });
  };

  it("renders an expandable per-cohort and leave-one-out detail discovered from the row keys", async () => {
    server.use(
      http.post("*/api/v1/summary_stats/:resource/:dataType", () => HttpResponse.json([r14Row]))
    );
    handoffR14();
    render(<PhenotypeSearchContainer />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText("19:44908684:T:C")).toBeInTheDocument());
    // header line: the chosen phenotype's contributing cohorts from resource_metadata
    const header = await screen.findByTestId("contributing-cohorts");
    expect(within(header).getByText("AoU-EUR")).toBeInTheDocument();

    expect(screen.queryByTestId("cohort-detail")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /expand/i })[1]);
    const detail = await screen.findByTestId("cohort-detail");
    const lines = Array.from(detail.children).map((c) => c.textContent);
    expect(lines).toEqual([
      "FG: beta 0.0610 ± 0.0120, p 2.00e-7, AF 0.181",
      "AoU-EUR: beta 0.0420 ± 0.0150, p 5.00e-3, AF 0.152",
      "leave out AoU: beta 0.0550 ± 0.0110, p 6.00e-7, N 1,100,000, het p 0.42",
    ]);
  });

  // the fixed download header every resource without contributing_cohorts must keep
  const fixedHeader = [
    "variant",
    "rsid",
    "af",
    "most_severe",
    "most_severe_gene",
    "p-value",
    "beta",
    "se",
    "in_credible_set",
    "pip",
  ];

  const handoff = (resource: string, dataType: CredibleSetDataType, trait: string) => {
    useDataStore.getState().setNormalizedData({
      ...fixture,
      phenotypes: {
        ...fixture.phenotypes,
        [`${resource}|${trait}`]: { resource, dataType, trait, phenostring: trait },
      },
    });
    useDataStore.getState().setPhenotypeSearchSelection({ resource, trait });
  };

  const downloadHeader = async (): Promise<string[]> => {
    exportSpy.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /download search results/i }));
    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
    const [rows, , , withCohorts] = exportSpy.mock.calls[0];
    return Object.keys(exportModule.buildPhenotypeSearchRows(rows, withCohorts)[0]);
  };

  // a real R13 finngen_mvp_ukbb row: its fg_/mvp_eur_/ukbb_ and leave_ukbb_ columns are numeric and
  // share names with the R14 pattern, but its metadata lists no contributing_cohorts
  const r13Row = {
    ...Object.fromEntries(Object.entries(r14Row).filter(([k]) => !/^(fg|aou|mvp|leave)_/.test(k))),
    resource: "finngen_mvp_ukbb",
    version: "R13",
    fg_beta: 0.061,
    fg_se: 0.012,
    fg_pval: 2e-7,
    fg_af: 0.181,
    mvp_eur_beta: 0.04,
    mvp_eur_se: 0.01,
    mvp_eur_pval: 1e-4,
    mvp_eur_af: 0.15,
    ukbb_beta: 0.05,
    ukbb_se: 0.02,
    ukbb_pval: 0.01,
    ukbb_af: 0.16,
    leave_ukbb_beta: 0.055,
    leave_ukbb_se: 0.011,
    leave_ukbb_pval: 6e-7,
  };

  // a finngen_ukbb_pqtl row: per-cohort blocks and leave-one-out families of its own
  const pqtlRow = {
    ...Object.fromEntries(Object.entries(r13Row).filter(([k]) => !/^(fg|mvp|ukbb|leave)_/.test(k))),
    resource: "finngen_ukbb_pqtl",
    phenotype: "APOE",
    fg2_3k_beta: 0.1,
    fg2_3k_se: 0.02,
    ukbb_ppp_beta: 0.12,
    ukbb_ppp_se: 0.03,
    fg3_cb_beta: 0.09,
    leave_fg2_3k_beta: 0.11,
    leave_ukbb_ppp_beta: 0.1,
    leave_fg3_cb_beta: 0.12,
  };

  it.each([
    { label: "an R13 finngen_mvp_ukbb meta row", row: r13Row, resource: "finngen_mvp_ukbb", dataType: "GWAS" as const, trait: "T2D" },
    { label: "a finngen_ukbb_pqtl row", row: pqtlRow, resource: "finngen_ukbb_pqtl", dataType: "pQTL" as const, trait: "APOE" },
  ])(
    "renders no expand column and keeps the fixed download header for $label",
    async ({ row, resource, dataType, trait }) => {
      server.use(
        http.post("*/api/v1/summary_stats/:resource/:dataType", () => HttpResponse.json([row]))
      );
      handoff(resource, dataType, trait);
      render(<PhenotypeSearchContainer />, { wrapper: Wrapper });

      await waitFor(() => expect(screen.getByText("19:44908684:T:C")).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument();
      expect(screen.queryByTestId("cohort-detail")).not.toBeInTheDocument();
      expect(screen.queryByTestId("contributing-cohorts")).not.toBeInTheDocument();
      expect(await downloadHeader()).toEqual(fixedHeader);
    }
  );

  it("adds the discovered cohort columns to the R14 download once the metadata lists cohorts", async () => {
    server.use(
      http.post("*/api/v1/summary_stats/:resource/:dataType", () => HttpResponse.json([r14Row]))
    );
    handoffR14();
    render(<PhenotypeSearchContainer />, { wrapper: Wrapper });
    await screen.findByTestId("contributing-cohorts");
    const header = await downloadHeader();
    expect(header.slice(0, fixedHeader.length)).toEqual(fixedHeader);
    expect(header).toContain("leave_aou_beta");
    expect(header).not.toContain("mvp_afr_beta");
  });
});
