import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { useGeneEvidenceStore } from "@/store/store.geneEvidence";
import GeneEvidencePage from "./GeneEvidencePage";

const renderAt = (path: string) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/gene" element={<GeneEvidencePage />} />
          <Route path="/gene/:geneName" element={<GeneEvidencePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

const initialStore = useGeneEvidenceStore.getState();
beforeEach(() => {
  localStorage.clear();
  useGeneEvidenceStore.setState(initialStore, true);
});

const FILTERS = {
  burdenTraitType: "binary",
  assocTraitType: "quantitative",
  assocCredibleSetKind: "susie",
  assocVariantMode: "lof",
} as const;

describe("GeneEvidencePage", () => {
  it("shows no evidence until a gene is named, and cannot be asked for an empty one", () => {
    renderAt("/gene");
    expect(screen.getByRole("button", { name: "GO" })).toBeDisabled();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("opens the evidence tabs of the gene that is entered", async () => {
    renderAt("/gene");
    await userEvent.type(screen.getByLabelText("Enter a gene name"), "apoe{Enter}");
    expect(await screen.findByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "GWAS" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /credible sets/i })).toBeNull();
  });

  it("names the open gene and keeps the search beside it, without the introduction", async () => {
    renderAt("/gene");
    expect(screen.getByText(/Browse and plot all of our results/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();

    const input = screen.getByLabelText("Enter a gene name");
    await userEvent.type(input, "apoe{Enter}");
    expect(await screen.findByRole("heading", { level: 1, name: "APOE" })).toBeInTheDocument();
    expect(screen.queryByText(/Browse and plot all of our results/)).toBeNull();
    // ready for the next gene
    expect(screen.getByLabelText("Enter a gene name")).toHaveValue("");
    expect(screen.getByRole("button", { name: "GO" })).toBeDisabled();
  });

  it("keeps the filters from gene to gene and drops them when the page is left", async () => {
    const { unmount } = renderAt("/gene/APOE");
    expect(await screen.findByRole("tablist")).toBeInTheDocument();
    useGeneEvidenceStore.setState({ ...FILTERS, assocTraitMode: "top" });

    // the mocked gene search answers APOE whatever is asked for
    await userEvent.type(screen.getByLabelText("Enter a gene name"), "pcsk9{Enter}");
    expect(await screen.findByRole("tablist")).toBeInTheDocument();
    expect(useGeneEvidenceStore.getState()).toMatchObject(FILTERS);

    unmount();
    expect(useGeneEvidenceStore.getState()).toMatchObject({
      burdenTraitType: "all",
      assocTraitType: "all",
      assocCredibleSetKind: "all",
      assocVariantMode: "any",
      assocTraitMode: "top",
    });
  });

  it("stores no filter, and reads none back from storage", async () => {
    useGeneEvidenceStore.setState({ ...FILTERS, burdenView: "plot" });
    const stored = localStorage.getItem("gene-evidence-storage")!;
    expect(stored).toContain('"burdenView":"plot"');
    for (const filter of Object.keys(FILTERS)) {
      expect(stored).not.toContain(filter);
    }

    useGeneEvidenceStore.setState(initialStore, true);
    localStorage.setItem(
      "gene-evidence-storage",
      JSON.stringify({ state: { ...FILTERS, burdenView: "plot" }, version: 0 })
    );
    await useGeneEvidenceStore.persist.rehydrate();
    expect(useGeneEvidenceStore.getState()).toMatchObject({
      burdenView: "plot",
      burdenTraitType: "all",
      assocTraitType: "all",
      assocCredibleSetKind: "all",
      assocVariantMode: "any",
    });
  });
});
