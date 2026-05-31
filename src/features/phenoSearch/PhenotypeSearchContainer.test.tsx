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
});
