import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PhenotypeTooltip } from "./PhenotypeTooltip";

// the MSW resource_metadata handler serves one plain row (G6_ALZHEIMER) and one R14 meta-analysis
// row (T2D) carrying contributing_cohorts + n_by_cohort; the chips must follow the keys' presence.

const renderTooltip = (phenocode: string, resource: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PhenotypeTooltip
        resource={resource}
        phenocode={phenocode}
        phenostring={phenocode}
        dataType="GWAS"
        content={<span>{`trait ${phenocode}`}</span>}
      />
    </QueryClientProvider>
  );
  const target = screen.getByText(`trait ${phenocode}`);
  fireEvent.mouseEnter(target.parentElement!);
  fireEvent.mouseOver(target);
};

describe("PhenotypeTooltip contributing cohorts", () => {
  it("shows a chip per contributing cohort with its sample size in the chip title", async () => {
    renderTooltip("T2D", "finngen_mvp_ukbb_aou");
    const chips = await screen.findByTestId("contributing-cohorts");
    expect(chips).toHaveTextContent("Cohorts:");
    for (const label of ["FG", "AoU-EUR", "UKBB-EUR", "MVP-AFR"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    const fg = screen.getByText("FG").closest("[title]");
    expect(fg?.getAttribute("title")).toMatch(/^70.?000 cases \/ 400.?000 controls$/);
  });

  it("renders no cohort line for a phenotype whose metadata has no contributing_cohorts", async () => {
    renderTooltip("G6_ALZHEIMER", "finngen");
    await waitFor(() => expect(screen.getByText(/cases/)).toBeInTheDocument());
    expect(screen.queryByTestId("contributing-cohorts")).not.toBeInTheDocument();
  });
});
