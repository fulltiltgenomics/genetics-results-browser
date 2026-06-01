import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PhenotypeSearchContainer from "./PhenotypeSearchContainer";
import { useDataStore } from "../../store/store";
import { NormalizedResponse } from "../../types/types.normalized";

// component coverage for the phenotype-search view (.24). seeds the store with the real fixture (so
// input variants + per-variant credible sets are present), preselects a phenotype via the URL query
// params (the .20 handoff path), and asserts the summary-stats table renders per-variant rows with
// the inCredibleSet flag derived from the store's credible sets.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fixture = require("../../test/fixtures/normalized_response.json") as NormalizedResponse;

const makeWrapper = (initialEntry: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
};

beforeEach(() => {
  const s = useDataStore.getState();
  s.setVariantInput("19:44908684:T:C");
  s.setPipThreshold(0);
  s.setSelectedPhenotype(undefined);
  s.setNormalizedData(fixture);
});

describe("PhenotypeSearchContainer (.24)", () => {
  it("prompts the user back to /annotate when there are no input variants", () => {
    useDataStore.getState().setNormalizedData(undefined);
    const Wrapper = makeWrapper("/annotate/phenotype-search");
    render(<PhenotypeSearchContainer />, { wrapper: Wrapper });
    expect(screen.getByText(/start by entering/i)).toBeInTheDocument();
  });

  it("preselects from the ?resource=&trait= handoff and renders a populated sumstats table", async () => {
    // trait 3000242 has a GWAS credible set for 19:44908684:T:C in the fixture, so inCredibleSet=true
    const Wrapper = makeWrapper(
      "/annotate/phenotype-search?resource=finngen&trait=3000242"
    );
    render(<PhenotypeSearchContainer />, { wrapper: Wrapper });

    // the sumstats fixture row is for 19:44908684:T:C
    await waitFor(() =>
      expect(screen.getByText("19:44908684:T:C")).toBeInTheDocument()
    );
    expect(screen.getByText("rs429358")).toBeInTheDocument();
    // inCredibleSet flag rendered as a PIP chip (pip 0.9618 -> "PIP 0.96")
    expect(screen.getByText(/PIP 0\.96/)).toBeInTheDocument();
  });

  // genetics-results-browser-7rd: the inCredibleSet join keys on `cs.resource === chosen.resource &&
  // cs.trait === chosen.code`. chosen.code comes from /search; cs.trait passes straight through
  // bff/normalize.normalizeCsRow from the upstream credible-set `trait` field. This was verified live
  // (2026-06-01, :2000) to hold (code === trait === trait_original) for EVERY sumstats-searchable GWAS
  // resource the phenotype-search box can surface: finngen, pgc, gp2, covid_hgi. QTL resources never
  // appear in types=phenotypes search, and ibd_gwas has summary_stats but no credible sets (so its
  // inCredibleSet is correctly always "no"). These cases pin that alignment per resource so a future
  // resource whose CS-trait vocab diverges from its /search code fails here instead of silently
  // false-negativing the flag.
  const sumstatsCodeEqualsCsTrait: Array<{ resource: string; code: string }> = [
    { resource: "finngen", code: "F5_SCHZPHR" },
    { resource: "pgc", code: "SCZ" },
    { resource: "gp2", code: "PD" },
    { resource: "covid_hgi", code: "COVID_C2" },
  ];

  it.each(sumstatsCodeEqualsCsTrait)(
    "flags inCredibleSet when a store CS for $resource has trait === the /search code $code",
    async ({ resource, code }) => {
      // minimal normalized response: one input variant (matching the summary_stats fixture row at
      // 19:44908684:T:C) whose single CS membership uses (resource, trait=code) exactly as the live
      // API emits them. if the join broke or the vocab diverged, the chip would read "no".
      const csVariant: NormalizedResponse["variants"][number] = {
        ...fixture.variants[0],
        credibleSets: [
          {
            ...fixture.variants[0].credibleSets[0],
            resource,
            trait: code,
            traitOriginal: code,
            pip: 0.5,
          },
        ],
      };
      const seeded: NormalizedResponse = {
        ...fixture,
        variants: [csVariant],
        inputVariants: {
          ...fixture.inputVariants,
          found: ["19:44908684:T:C"],
        },
      };
      useDataStore.getState().setNormalizedData(seeded);

      const Wrapper = makeWrapper(
        `/annotate/phenotype-search?resource=${resource}&trait=${code}`
      );
      render(<PhenotypeSearchContainer />, { wrapper: Wrapper });

      await waitFor(() =>
        expect(screen.getByText("19:44908684:T:C")).toBeInTheDocument()
      );
      // pip 0.5 -> "PIP 0.50"; presence of the chip proves cs.trait matched chosen.code for this resource
      expect(screen.getByText(/PIP 0\.50/)).toBeInTheDocument();
    }
  );
});
