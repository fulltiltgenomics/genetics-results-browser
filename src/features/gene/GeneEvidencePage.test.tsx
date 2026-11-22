import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
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

describe("GeneEvidencePage", () => {
  it("shows no evidence until a gene is named, and cannot be asked for an empty one", () => {
    renderAt("/gene");
    expect(screen.getByRole("button", { name: "Show evidence" })).toBeDisabled();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("opens the evidence tabs of the gene that is entered", async () => {
    renderAt("/gene");
    await userEvent.type(screen.getByLabelText("Enter a gene name"), "apoe{Enter}");
    expect(await screen.findByText("APOE")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "variant association" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /credible sets/i })).toBeNull();
  });
});
