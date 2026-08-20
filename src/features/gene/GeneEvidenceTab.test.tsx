import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderHook, waitFor as waitForHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { PropsWithChildren } from "react";
import { server } from "@/test/msw/server";
import GeneEvidenceTab from "./GeneEvidenceTab";
import {
  parseGeneBurdenTsv,
  useGeneBurden,
  useGeneDisease,
  useGeneExpression,
} from "@/store/serverQuery";

// chart.js needs a real canvas context, which jsdom does not provide; the plot's data shaping is
// covered by gtexTissues.test.ts instead
vi.mock("react-chartjs-2", () => ({
  Bar: ({ data }: { data: { labels: string[] } }) => (
    <div data-testid="gtex-plot">{data.labels.join("|")}</div>
  ),
}));

// fresh client with retries off so a failing query rejects immediately instead of retrying for seconds
const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};

describe("parseGeneBurdenTsv", () => {
  const tsv = [
    "dataset\ttrait\tgene\tgene_id\tgene_chr\tgene_start_pos\tgene_end_pos\tannotation\tmlog10p_burden\tbeta\tse\ttotal_variants\ttotal_variants_pheno\tn_cases\tn_controls\ttrait_original\tflags",
    "genebass\tApolipoprotein A\tAPOE\tENSG00000130203\t19\t44905791\t44909393\tmissense|LC\t6.28038e+00\t-2.84859e-03\t5.67767e-04\t223\t211\t343018\tNA\tcontinuous_30630\tNA",
    "genebass\tC-reactive protein\tAPOE\tENSG00000130203\t19\t44905791\t44909393\tmissense|LC\t9.5\t-2.68729e-03\t5.90874e-04\t223\t219\t376005\tNA\tcontinuous_30710\tNA",
  ].join("\n");

  it("parses header-indexed rows with numeric coercion and NA -> null", () => {
    const rows = parseGeneBurdenTsv(tsv);
    expect(rows).toHaveLength(2);
    const top = rows[0];
    expect(top.trait).toBe("C-reactive protein"); // higher -log10p sorts first
    expect(top.mlog10pBurden).toBeCloseTo(9.5);
    expect(top.beta).toBeCloseTo(-0.00268729);
    expect(top.nCases).toBe(376005);
    expect(top.nControls).toBeNull(); // "NA" -> null
    expect(top.annotation).toBe("missense|LC");
  });

  it("sorts by burden -log10(p) descending", () => {
    const rows = parseGeneBurdenTsv(tsv);
    expect(rows.map((r) => r.mlog10pBurden)).toEqual([9.5, expect.closeTo(6.28038)]);
  });

  it("returns [] for an empty body", () => {
    expect(parseGeneBurdenTsv("")).toEqual([]);
  });
});

describe("gene-evidence hooks (MSW)", () => {
  it("useGeneBurden parses the TSV fixture into sorted rows", async () => {
    const { result } = renderHook(() => useGeneBurden("APOE"), { wrapper: makeWrapper() });
    await waitForHook(() => expect(result.current.isSuccess).toBe(true));
    const rows = result.current.data!;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].gene).toBe("APOE");
    // sorted descending
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].mlog10pBurden ?? -Infinity).toBeGreaterThanOrEqual(
        rows[i].mlog10pBurden ?? -Infinity
      );
    }
  });

  it("useGeneExpression parses level strings and sorts descending", async () => {
    const { result } = renderHook(() => useGeneExpression("APOE"), { wrapper: makeWrapper() });
    await waitForHook(() => expect(result.current.isSuccess).toBe(true));
    const rows = result.current.data!;
    expect(rows.length).toBeGreaterThan(0);
    expect(typeof rows[0].level).toBe("number");
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].level ?? -Infinity).toBeGreaterThanOrEqual(rows[i].level ?? -Infinity);
    }
  });

  it("useGeneDisease maps snake_case to GeneDiseaseRow", async () => {
    const { result } = renderHook(() => useGeneDisease("APOE"), { wrapper: makeWrapper() });
    await waitForHook(() => expect(result.current.isSuccess).toBe(true));
    const rows = result.current.data!;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      geneSymbol: "APOE",
      resource: "gencc",
    });
    expect(rows[0].diseaseTitle).toBeTruthy();
    expect(rows[0].modeOfInheritance).toBeTruthy();
  });
});

describe("GeneEvidenceTab (component)", () => {
  it("renders all evidence sections populated for APOE", async () => {
    render(<GeneEvidenceTab geneName="APOE" />, { wrapper: makeWrapper() });

    expect(screen.getByText("Gene burden")).toBeInTheDocument();
    expect(screen.getByText("Gene-disease (Mendelian)")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Expression (GTEx v10)")).toBeInTheDocument());

    // burden trait from the fixture (the fixture has multiple Apolipoprotein A rows)
    await waitFor(() => expect(screen.getAllByText("Apolipoprotein A").length).toBeGreaterThan(0));
    // a gene-disease row from the fixture
    expect(screen.getAllByText(/hyperlipoproteinemia/i).length).toBeGreaterThan(0);
  });

  it("reads a gene-disease 404 as no associations rather than a failure", async () => {
    server.use(
      http.get("*/api/v1/gene_disease/:gene", () =>
        HttpResponse.json({ detail: "No disease associations found for gene OR51B4" }, { status: 404 })
      )
    );

    render(<GeneEvidenceTab geneName="OR51B4" />, { wrapper: makeWrapper() });

    expect(
      await screen.findByText("no gene-disease associations for this gene")
    ).toBeInTheDocument();
    expect(screen.queryByText(/failed to load/)).not.toBeInTheDocument();
  });

  it("surfaces a gene-disease server error", async () => {
    server.use(http.get("*/api/v1/gene_disease/:gene", () => new HttpResponse(null, { status: 500 })));

    render(<GeneEvidenceTab geneName="APOE" />, { wrapper: makeWrapper() });

    expect(await screen.findByText(/failed to load/)).toBeInTheDocument();
  });

  it("lists only burden associations at p < 1e-4, whichever dataset they come from", async () => {
    // genebass reaches the API already cut at this threshold; SCHEMA/BipEx/IBD arrive complete, and
    // almost none of their rows clear it (22-62 rows genome-wide per dataset)
    const tsv = [
      "dataset\ttrait\tgene\tgene_id\tgene_chr\tgene_start_pos\tgene_end_pos\tannotation\tmlog10p_burden\tbeta\tse\ttotal_variants\ttotal_variants_pheno\tn_cases\tn_controls\ttrait_original\tflags",
      "genebass\tApolipoprotein A\tAPOE\tENSG00000130203\t19\t44905791\t44909393\tmissense|LC\t6.28\t-0.0028\t0.0005\t223\t211\t343018\tNA\tcontinuous_30630\tNA",
      "SCHEMA2\tschizophrenia\tAPOE\tENSG00000130203\t19\t44905791\t44909393\tPTV\t0.04\t0.363\t0.4\t223\t211\t87959\t150587\tschizophrenia\tNA",
      "IBD_exome\tcrohns disease\tAPOE\tENSG00000130203\t19\t44905791\t44909393\tpLoF\t5.1\t0.127\t0.03\t223\t211\t512657\t478363\tcrohns_disease\tNA",
    ].join("\n");
    server.use(http.get("*/api/v1/gene_based/:gene", () => HttpResponse.text(tsv)));

    render(<GeneEvidenceTab geneName="APOE" />, { wrapper: makeWrapper() });

    // the significant genebass and IBD rows survive; the sub-threshold SCHEMA row does not
    expect(await screen.findByRole("cell", { name: "Apolipoprotein A" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "crohns disease" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "schizophrenia" })).not.toBeInTheDocument();
  });

  it("shows GTEx as a plot by default and switches to the table on toggle", async () => {
    const user = userEvent.setup();
    render(<GeneEvidenceTab geneName="APOE" />, { wrapper: makeWrapper() });

    // plot is the default view, labelled with the official GTEx tissue names
    const plot = await screen.findByTestId("gtex-plot");
    // official label for a v8 tissue, and a v10 sub-tissue named off its parent
    expect(plot.textContent).toContain("Heart - Atrial Appendage");
    expect(plot.textContent).toContain("Stomach (muscularis)");
    expect(screen.queryByText("median TPM")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "table" }));
    expect(screen.queryByTestId("gtex-plot")).not.toBeInTheDocument();
    expect(screen.getByText("median TPM")).toBeInTheDocument();
    expect(screen.getByText("Heart - Atrial Appendage")).toBeInTheDocument();
  });

  it("reports no HPA data when the response carries only GTEx rows", async () => {
    render(<GeneEvidenceTab geneName="APOE" />, { wrapper: makeWrapper() });

    expect(await screen.findByText("Expression (Human Protein Atlas)")).toBeInTheDocument();
    expect(await screen.findByText("no HPA expression data for this gene")).toBeInTheDocument();
  });

  it("lists HPA staining levels strongest first, with organ/cell labels collapsed", async () => {
    // shape copied from the live endpoint: `organ|tissue|cell_type` and a categorical level
    const hpaRow = (tissueCell: string, level: string) => ({
      resource: "hpa",
      version: "24.1",
      dataset: "HPA_24.1",
      chrom: 19,
      gene_start: 44905791,
      gene_end: 44909393,
      gene_name: "APOE",
      gene_id: "ENSG00000130203.10",
      tissue_cell: tissueCell,
      level,
    });
    server.use(
      http.get("*/api/v1/expression_by_gene/:gene", () =>
        HttpResponse.json([
          hpaRow("spleen|spleen|cells_in_red_pulp", "Not_detected"),
          hpaRow("lung|lung|macrophages", "High"),
          hpaRow("endometrium|endometrium_2|glandular_cells", "Low"),
          hpaRow("colon|colon|glandular_cells", "Medium"),
        ])
      )
    );

    render(<GeneEvidenceTab geneName="APOE" />, { wrapper: makeWrapper() });

    // "level" is unique to the HPA table; the burden table on the same page also has rows
    const hpaTable = (await screen.findByText("level")).closest("table")!;
    const body = within(hpaTable)
      .getAllByRole("row")
      .slice(1) // header row
      .map((r) => r.textContent);
    expect(body[0]).toContain("lung, macrophages");
    expect(body[0]).toContain("High");
    expect(body.map((t) => t?.match(/High|Medium|Low|Not detected/)?.[0])).toEqual([
      "High",
      "Medium",
      "Low",
      "Not detected",
    ]);
    // numbered organ samples keep their number; dataset ids lose their underscores
    expect(screen.getByText("endometrium 2, glandular cells")).toBeInTheDocument();
    expect(screen.getAllByText("HPA 24.1").length).toBeGreaterThan(0);
  });
});
