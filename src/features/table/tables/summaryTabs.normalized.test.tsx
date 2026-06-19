import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DataTypeTable from "./DataTypeTable.normalized";
import PhenotypeSummaryTable from "./PhenotypeSummaryTable.normalized";
import TissueSummaryTable from "./TissueSummaryTable.normalized";
import { useDataStore } from "../../../store/store";
import { NormalizedResponse } from "../../../types/types.normalized";

// light component coverage for the three migrated summary tabs (.19/.20/.21). seeds the store with
// the real fixture (which drives filteredVariants via setNormalizedData) and asserts each tab renders
// credible-set-derived data, plus the tissue eQTL/caQTL local toggle.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fixture = require("../../../test/fixtures/normalized_response.json") as NormalizedResponse;

const seedStore = () => {
  const s = useDataStore.getState();
  s.setVariantInput("19:44908684:T:C");
  // pip 0 keeps everything; default includeAllQuantLevels stays false so the exon eQTL row drops,
  // matching the live default behavior.
  s.setPipThreshold(0);
  s.setNormalizedData(fixture);
};

beforeEach(() => {
  seedStore();
});

describe("DataTypeTable (.19)", () => {
  it("renders one row per variant with per-data-type CS counts", () => {
    render(<DataTypeTable enableTopToolbar={false} />);
    expect(screen.getByText("19:44908684:T:C")).toBeInTheDocument();
    // headers for each data type column are present
    expect(screen.getByText("GWAS CS")).toBeInTheDocument();
    expect(screen.getByText("caQTL CS")).toBeInTheDocument();
    expect(screen.getByText("total CS")).toBeInTheDocument();
  });
});

describe("PhenotypeSummaryTable (.20)", () => {
  it("renders trait rows derived from CS membership with a search handoff button", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <PhenotypeSummaryTable />
        </MemoryRouter>
      </QueryClientProvider>
    );
    // one search-handoff button per trait row; the tooltip title is its accessible name.
    expect(
      screen.getAllByRole("button", { name: /full summary-stat results/i }).length
    ).toBeGreaterThan(0);
  });
});

describe("TissueSummaryTable (.21)", () => {
  it("defaults to eQTL and switches the table when the local caQTL toggle is clicked", () => {
    // wrapped in a QueryClientProvider: the caQTL "linked genes" cell fetches peak_to_genes live
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TissueSummaryTable />
      </QueryClientProvider>
    );
    // eQTL is the default selection: the eQTL tissue label (ge-only default drops the exon eQTL row,
    // so the brain eQTL tissue is absent; pQTL "plasma" is NOT shown here as this tab is QTL-typed to
    // eQTL). switching to caQTL must surface the ATAC cell type.
    const caqtlToggle = screen.getByRole("button", { name: "caQTL" });
    fireEvent.click(caqtlToggle);
    expect(screen.getByText("l1.PBMC")).toBeInTheDocument();
    // the peak->gene "linked genes" column header is present in caQTL mode
    expect(screen.getByText("linked genes")).toBeInTheDocument();
  });
});
