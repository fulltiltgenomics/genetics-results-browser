import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { PropsWithChildren } from "react";
import { server } from "@/test/msw/server";
import CellTypeExpressionSection from "./CellTypeExpressionSection";
import { buildDotGrid, explorerUrl } from "./cellTypeDots";
import { buildCellTypeDatasetRows, buildCellTypeSummaryRows } from "./geneEvidenceExport";
import { CellTypeExpressionSummaryRow } from "@/types/types.normalized";

const wrapper = ({ children }: PropsWithChildren) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const summaryApi = (over: Record<string, unknown>) => ({
  gene_id: "ENSG1.1",
  gene_name: "PCSK9",
  cell_type_rollup: "hepatocyte",
  cell_type_rollup_ontology_term_id: "CL:0000182",
  tissue_general: "liver",
  tissue_general_ontology_term_id: "UBERON:0002107",
  n_cells: 1000,
  n_donors: 5,
  n_datasets: 2,
  mean_log1p_cp10k: 1.5,
  frac_expressing: 0.4,
  donor_pseudobulk_mean_cp10k: null,
  donor_pseudobulk_n_donors: null,
  tau: "NA",
  ...over,
});

const serveSummary = (rows: unknown[]) =>
  server.use(
    http.get("*/api/v1/cell_type_expression/:gene", ({ request }) => {
      const level = new URL(request.url).searchParams.get("level");
      return HttpResponse.json(
        level === "dataset"
          ? [
              { gene_id: "E", gene_name: "PCSK9", dataset_id: "37a17b78-aaaa", status: "present",
                tissue: "liver", cell_type: "hepatocyte", mean_log1p_cp10k: 2, frac_expressing: 0.5 },
              { gene_id: "E", gene_name: "PCSK9", dataset_id: "31f657dc-bbbb", status: "measured_no_row",
                tissue: "NA", cell_type: "NA", mean_log1p_cp10k: 0, frac_expressing: 0 },
            ]
          : rows,
        { headers: { "X-Dataset-Version": "cellxgene-2026-09" } }
      );
    })
  );

describe("CellTypeExpressionSection", () => {
  it("renders nothing where the deployment is not configured", async () => {
    const { container } = render(<CellTypeExpressionSection geneName="PCSK9" />, { wrapper });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("says data is not yet available on a 503", async () => {
    server.use(
      http.get("*/api/v1/cell_type_expression/:gene", () =>
        HttpResponse.json({ detail: "no release" }, { status: 503 })
      )
    );
    render(<CellTypeExpressionSection geneName="PCSK9" />, { wrapper });
    expect(await screen.findByText(/not yet available/)).toBeInTheDocument();
  });

  it("treats a gene-not-found 404 as no data rather than hiding the section", async () => {
    server.use(
      http.get("*/api/v1/cell_type_expression/:gene", () =>
        HttpResponse.json({ detail: "Gene X not found" }, { status: 404 })
      )
    );
    render(<CellTypeExpressionSection geneName="X" />, { wrapper });
    expect(await screen.findByText(/no single-cell expression data/)).toBeInTheDocument();
  });

  it("shows the release, the dot plot, and the per-dataset drill-down with measured-not-detected", async () => {
    serveSummary([summaryApi({}), summaryApi({ tissue_general: "lung", tissue_general_ontology_term_id: "U:2" })]);
    render(<CellTypeExpressionSection geneName="PCSK9" />, { wrapper });
    expect(await screen.findByText(/release cellxgene-2026-09/)).toBeInTheDocument();
    expect(await screen.findByTestId("cell-type-dot-plot")).toBeInTheDocument();
    expect(screen.getAllByText("log1p", { exact: false }).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByText("show per-dataset breakdown"));
    expect(await screen.findByText("measured, not detected")).toBeInTheDocument();
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain(explorerUrl("37a17b78-aaaa"));
  });

  it("table view labels pseudobulk as secondary and leaves NA blank", async () => {
    serveSummary([summaryApi({})]);
    render(<CellTypeExpressionSection geneName="PCSK9" />, { wrapper });
    await userEvent.click(await screen.findByText("table"));
    expect(await screen.findByText(/donor pseudobulk mean CP10K \(secondary\)/)).toBeInTheDocument();
    expect(screen.queryByText("NA")).not.toBeInTheDocument();
  });
});

describe("cell type helpers", () => {
  const row = (over: Partial<CellTypeExpressionSummaryRow>): CellTypeExpressionSummaryRow => ({
    geneId: "g", geneName: "G", cellType: "a", cellTypeId: "CL:1", tissue: "t1", tissueId: "U:1",
    nCells: 1, nDonors: 1, nDatasets: 1, meanLog1pCp10k: 1, fracExpressing: 0.1,
    donorPseudobulkMeanCp10k: null, donorPseudobulkNDonors: null, tau: null, ...over,
  });

  it("orders by strongest expression, caps cell types and drops rows without a mean", () => {
    const grid = buildDotGrid(
      [row({ cellType: "a", meanLog1pCp10k: 1 }), row({ cellType: "b", meanLog1pCp10k: 3 }),
       row({ cellType: "c", meanLog1pCp10k: null })],
      1
    );
    expect(grid.cellTypes).toEqual(["b"]);
    expect(grid.dots).toHaveLength(1);
    expect(grid.maxMean).toBe(3);
  });

  it("exports NA for missing values", () => {
    expect(buildCellTypeSummaryRows([row({})])[0].donor_pseudobulk_mean_cp10k).toBe("NA");
    const d = buildCellTypeDatasetRows([
      { geneId: "g", geneName: "G", datasetId: "x", status: "measured_no_row", tissue: null,
        tissueGeneral: null, cellType: null, cellTypeRollup: null, disease: null, assay: null,
        suspensionType: null, nCells: null, nDonors: null, meanLog1pCp10k: 0, fracExpressing: 0,
        donorPseudobulkMeanCp10k: null },
    ]);
    expect(d[0]).toMatchObject({ status: "measured_no_row", tissue: "NA", mean_log1p_cp10k: 0 });
  });
});
