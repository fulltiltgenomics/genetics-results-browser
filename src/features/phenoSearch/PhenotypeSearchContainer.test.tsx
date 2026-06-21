import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PhenotypeSearchContainer from "./PhenotypeSearchContainer";
import { useDataStore } from "../../store/store";
import { NormalizedResponse } from "../../types/types.normalized";

// component coverage for the phenotype-search tab (refactor.md §5). seeds the store with the real
// fixture (so input variants + per-variant credible sets are present), preselects a phenotype via
// store.selectedPhenotype (the Phenotype summary handoff path), and asserts the summary-stats table
// renders per-variant rows with the inCredibleSet flag derived from the store's credible sets.

// eslint-disable-next-line @typescript-eslint/no-var-requires
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
});
