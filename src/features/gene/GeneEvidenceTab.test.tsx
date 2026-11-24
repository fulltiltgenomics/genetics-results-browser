import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderHook, waitFor as waitForHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { PropsWithChildren } from "react";
import { server } from "@/test/msw/server";
import geneAnnotation from "@/test/fixtures/gene_annotation.json";
import { MemberRow, memberRow, summaryOf } from "@/test/geneAssociationSummary";
import GeneEvidenceTab from "./GeneEvidenceTab";
import { GeneEvidenceTabName, useGeneEvidenceStore } from "@/store/store.geneEvidence";
import {
  parseGeneBurdenTsv,
  useGeneBurden,
  useGeneDisease,
  useGeneExpression,
} from "@/store/serverQuery";

// chart.js needs a real canvas context, which jsdom does not provide
vi.mock("react-chartjs-2", () => ({
  Scatter: ({ data }: { data: { datasets: { label: string; data: unknown[] }[] } }) => (
    <div data-testid="burden-plot">
      {data.datasets.map((d) => `${d.label}:${d.data.length}`).join("|")}
    </div>
  ),
}));

const initialStore = useGeneEvidenceStore.getState();
beforeEach(() => {
  localStorage.clear();
  useGeneEvidenceStore.setState(initialStore, true);
});

const renderTab = (tab: GeneEvidenceTabName, geneName = "APOE") => {
  useGeneEvidenceStore.setState({ activeTab: tab });
  return render(<GeneEvidenceTab geneName={geneName} />, { wrapper: makeWrapper() });
};

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
  it("offers every evidence kind as a tab, opening on gene burden", async () => {
    render(<GeneEvidenceTab geneName="APOE" />, { wrapper: makeWrapper() });

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "ai summary",
      "gene burden",
      "GWAS",
      "qtl",
      "expression",
      "mendelian",
      "annotation",
    ]);
    // nothing to show there yet
    expect(screen.getByRole("tab", { name: "qtl" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("tab", { name: "qtl" }));
    expect(screen.getByRole("tab", { name: "gene burden" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // burden trait from the fixture (the fixture has multiple Apolipoprotein A rows)
    await waitFor(() => expect(screen.getAllByText("Apolipoprotein A").length).toBeGreaterThan(0));
    // the other tabs' content is not mounted
    expect(screen.queryByText(/Expression \(GTEx/)).not.toBeInTheDocument();
  });

  describe("the protein tab", () => {
    const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent);
    const serveModels = (status: number, body: unknown) => {
      let asked = 0;
      server.use(
        http.get("*/api/v1/protein_structure/models/:gene", () => {
          asked += 1;
          return HttpResponse.json(body as never, { status });
        })
      );
      return () => asked;
    };

    it("is offered once the deployment answers for the layer, and says when the gene has no model", async () => {
      const asked = serveModels(404, { detail: "No model file is listed under gene APOE in release r" });
      const user = userEvent.setup();
      render(<GeneEvidenceTab geneName="APOE" />, { wrapper: makeWrapper() });

      // not before the answer: a deployment without the layer must never show it
      expect(tabNames()).not.toContain("protein");
      await user.click(await screen.findByRole("tab", { name: "protein" }));
      expect(tabNames().indexOf("protein")).toBe(tabNames().indexOf("expression") + 1);
      expect(await screen.findByText("no predicted structure for this gene")).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "protein" })).toHaveAttribute("aria-selected", "true");
      // the section reads the tab strip's answer
      expect(asked()).toBe(1);
    });

    it("stays while a release is yet to load", async () => {
      serveModels(503, { detail: "no release loaded" });
      render(<GeneEvidenceTab geneName="APOE" />, { wrapper: makeWrapper() });
      expect(await screen.findByRole("tab", { name: "protein" })).toBeInTheDocument();
    });

    it("is absent where the deployment serves no protein-structure routes", async () => {
      // the default handler answers as FastAPI does for a route that is not registered
      const asked = serveModels(404, { detail: "Not Found" });
      render(<GeneEvidenceTab geneName="APOE" />, { wrapper: makeWrapper() });
      await waitFor(() => expect(asked()).toBe(1));
      await waitFor(() => expect(screen.getAllByText("Apolipoprotein A").length).toBeGreaterThan(0));
      expect(tabNames()).not.toContain("protein");
    });

    it("falls back to the default tab when a remembered protein tab is not served", async () => {
      serveModels(404, { detail: "Not Found" });
      renderTab("protein");
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "gene burden" })).toHaveAttribute(
          "aria-selected",
          "true"
        )
      );
      expect(tabNames()).not.toContain("protein");
      expect(screen.queryByTestId("protein-section")).toBeNull();
      await waitFor(() => expect(screen.getAllByText("Apolipoprotein A").length).toBeGreaterThan(0));
    });

    it("opens on a remembered protein tab where the layer is served", async () => {
      serveModels(404, { detail: "No model file is listed under gene APOE in release r" });
      renderTab("protein");
      // held through the wait, so no other tab's content is fetched first
      expect(screen.getByRole("tab", { name: "protein" })).toHaveAttribute("aria-selected", "true");
      expect(await screen.findByText("no predicted structure for this gene")).toBeInTheDocument();
      expect(screen.queryByText("Apolipoprotein A")).toBeNull();
    });
  });

  it("switches tabs and remembers the selection in localStorage", async () => {
    const user = userEvent.setup();
    render(<GeneEvidenceTab geneName="APOE" />, { wrapper: makeWrapper() });

    await user.click(screen.getByRole("tab", { name: "mendelian" }));
    expect((await screen.findAllByText(/hyperlipoproteinemia/i)).length).toBeGreaterThan(0);
    expect(localStorage.getItem("gene-evidence-storage")).toContain('"activeTab":"mendelian"');

    await user.click(screen.getByRole("tab", { name: "expression" }));
    expect(await screen.findByText("Expression by tissue: GTEx v11")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "APOE on the GTEx Portal" })).toHaveAttribute(
      "href",
      "https://gtexportal.org/home/gene/ENSG00000130203"
    );
  });

  it("reads a gene-disease 404 as no associations rather than a failure", async () => {
    server.use(
      http.get("*/api/v1/gene_disease/:gene", () =>
        HttpResponse.json(
          { detail: "No disease associations found for gene OR51B4" },
          { status: 404 }
        )
      )
    );

    renderTab("mendelian", "OR51B4");

    expect(
      await screen.findByText("no gene-disease associations for this gene")
    ).toBeInTheDocument();
    expect(screen.queryByText(/failed to load/)).not.toBeInTheDocument();
  });

  it("surfaces a gene-disease server error", async () => {
    server.use(
      http.get("*/api/v1/gene_disease/:gene", () => new HttpResponse(null, { status: 500 }))
    );

    renderTab("mendelian");

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

  it("shows GTEx as a violin plot of the portal's samples by default, and their table on toggle", async () => {
    let asked: URLSearchParams | undefined;
    server.events.on("request:start", ({ request }) => {
      if (request.url.includes("gtex_expression")) asked = new URL(request.url).searchParams;
    });
    const user = userEvent.setup();
    renderTab("expression");

    // the plot is the default view, labelled with the official GTEx tissue names
    const plot = await screen.findByTestId("gtex-violin-plot");
    expect(plot.textContent).toContain("Heart - Atrial Appendage");
    expect(asked?.get("ensembl_id")).toBe("ENSG00000130203");
    // the release is the one the response names
    expect(screen.getByText("Expression by tissue: GTEx v11")).toBeInTheDocument();
    expect(screen.queryByText("median TPM")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "table" }));
    expect(screen.queryByTestId("gtex-violin-plot")).not.toBeInTheDocument();
    // the same samples, summarised per tissue and strongest first
    const rows = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) =>
        within(r)
          .getAllByRole("cell")
          .map((c) => c.textContent)
      );
    expect(rows).toEqual([
      ["Liver", "6", "195.0", "157.5", "232.5"],
      ["Heart - Atrial Appendage", "4", "2.500", "1.750", "3.250"],
      ["Whole Blood", "3", "0.000", "0.000", "0.2500"],
    ]);
    server.events.removeAllListeners();
  });

  it("says so when the GTEx portal cannot be reached or has nothing for the gene", async () => {
    server.use(
      http.get("*/api/v1/gtex_expression", () =>
        HttpResponse.json({ error: "bad_gateway", message: "GTEx unreachable" }, { status: 502 })
      )
    );
    const first = renderTab("expression");
    expect(await screen.findByText(/failed to load/)).toBeInTheDocument();
    first.unmount();

    server.use(
      http.get("*/api/v1/gtex_expression", () =>
        HttpResponse.json({ error: "not_found" }, { status: 404 })
      )
    );
    renderTab("expression");
    expect(await screen.findByText("no GTEx expression data for this gene")).toBeInTheDocument();
  });

  it("offers each expression source as a tab of its own, opening on GTEx", async () => {
    // configured, with no release loaded: enough for the tab to be on offer
    server.use(
      http.get("*/api/v1/cell_type_expression/:gene", () =>
        HttpResponse.json({ detail: "no release loaded" }, { status: 503 })
      )
    );
    const user = userEvent.setup();
    renderTab("expression");
    const sources = within(screen.getByRole("tablist", { name: "expression source" }));
    expect(sources.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "GTEx",
      "CELLxGENE",
      "Human Protein Atlas",
    ]);
    expect(await screen.findByText("Expression by tissue: GTEx v11")).toBeInTheDocument();
    expect(screen.queryByText(/Protein levels by tissue/)).toBeNull();

    await user.click(sources.getByRole("tab", { name: "CELLxGENE" }));
    expect(
      await screen.findByText(/single-cell expression data is not yet available/)
    ).toBeInTheDocument();
    expect(screen.queryByText("Expression by tissue: GTEx v11")).toBeNull();
    expect(localStorage.getItem("gene-evidence-storage")).toContain('"expressionTab":"cellxgene"');
  });

  it("offers no CELLxGENE tab where the deployment has no such data", async () => {
    server.use(
      http.get("*/api/v1/cell_type_expression/:gene", () =>
        HttpResponse.json({ detail: "Not Found" }, { status: 404 })
      )
    );
    useGeneEvidenceStore.setState({ expressionTab: "cellxgene" });
    renderTab("expression");
    const sources = within(screen.getByRole("tablist", { name: "expression source" }));
    await waitFor(() =>
      expect(sources.getAllByRole("tab").map((t) => t.textContent)).toEqual([
        "GTEx",
        "Human Protein Atlas",
      ])
    );
    // the remembered tab is not on offer, so the first one opens
    expect(await screen.findByText("Expression by tissue: GTEx v11")).toBeInTheDocument();
  });

  it("greys out the HPA tab, saying why, for a gene with no HPA data", async () => {
    // remembered from another gene, and not openable for this one
    useGeneEvidenceStore.setState({ expressionTab: "hpa" });
    const user = userEvent.setup();
    renderTab("expression");

    const hpa = screen.getByRole("tab", { name: "Human Protein Atlas" });
    await waitFor(() => expect(hpa).toHaveAttribute("aria-disabled", "true"));
    expect(await screen.findByText("Expression by tissue: GTEx v11")).toBeInTheDocument();

    await user.hover(within(hpa).getByText("Human Protein Atlas"));
    expect(
      await screen.findByText("No Human Protein Atlas protein level data for APOE")
    ).toBeInTheDocument();
    await user.click(hpa);
    expect(screen.queryByText(/Protein levels by tissue/)).toBeNull();
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

    useGeneEvidenceStore.setState({ expressionTab: "hpa" });
    renderTab("expression");

    expect(
      await screen.findByText("Protein levels by tissue (IHC staining): Human Protein Atlas")
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Human Protein Atlas" })).not.toHaveAttribute(
      "aria-disabled"
    );
    expect(
      await screen.findByRole("link", { name: "APOE in the Human Protein Atlas" })
    ).toHaveAttribute("href", "https://www.proteinatlas.org/ENSG00000130203/tissue");
    // "level" is unique to the HPA table
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

describe("gene burden tab", () => {
  const header =
    "dataset\ttrait\tgene\tgene_id\tgene_chr\tgene_start_pos\tgene_end_pos\tannotation\tmlog10p_burden\tbeta\tse\ttotal_variants\ttotal_variants_pheno\tn_cases\tn_controls\ttrait_original\tflags\tresource";
  const line = (
    dataset: string,
    trait: string,
    mask: string,
    mlog10p: number,
    beta: number,
    nControls: string
  ) =>
    `${dataset}\t${trait}\tAPOE\tENSG00000130203\t19\t44905791\t44909393\t${mask}\t${mlog10p}\t${beta}\t0.01\t223\t211\t1000\t${nControls}\t${trait}\tNA\t${dataset.toLowerCase()}`;
  const useBurden = () =>
    server.use(
      http.get("*/api/v1/gene_based/:gene", () =>
        HttpResponse.text(
          [
            header,
            line("genebass", "LDL", "pLoF", 30, -0.5, "NA"),
            line("genebass", "LDL", "missense|LC", 12, -0.1, "NA"),
            line("genebass", "statin", "missense|LC", 9, 0.2, "5000"),
            line("genebass", "statin", "pLoF", 6, 0.9, "5000"),
            line("IBD_exome", "crohns", "pLoF", 5, 0.3, "7000"),
          ].join("\n")
        )
      )
    );

  const bodyRows = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((r) =>
        within(r)
          .getAllByRole("cell")
          .map((c) => c.textContent)
      );

  it("shows the top mask per trait by default, with NA controls for quantitative traits", async () => {
    useBurden();
    renderTab("gene burden");

    await screen.findByRole("columnheader", { name: /burden mask/ });
    expect(bodyRows().map((r) => r.slice(0, 4))).toEqual([
      ["Q", "genebass", "LDL", "pLoF"],
      ["B", "genebass", "statin", "missense|LC"],
      ["B", "IBD exome", "crohns", "pLoF"],
    ]);
    expect(bodyRows().map((r) => r[7])).toEqual(["NA", "5,000", "7,000"]);
    const table = within(screen.getByRole("table"));
    expect(table.getAllByLabelText("quantitative")).toHaveLength(1);
    expect(table.getAllByLabelText("binary")).toHaveLength(2);
    expect(
      screen.getByRole("radio", { name: "both binary and quantitative traits" })
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "only the top burden mask for each trait" })
    ).toBeChecked();
  });

  it("filters by trait type and mask mode, and stores only the mask mode", async () => {
    useBurden();
    const user = userEvent.setup();
    renderTab("gene burden");
    await screen.findByRole("columnheader", { name: /burden mask/ });

    await user.click(screen.getByRole("radio", { name: "only binary traits" }));
    expect(bodyRows().map((r) => r[2])).toEqual(["statin", "crohns"]);

    await user.click(screen.getByRole("radio", { name: "all burden masks for each trait" }));
    expect(bodyRows().map((r) => r[3])).toEqual(["missense|LC", "pLoF", "pLoF"]);

    const stored = localStorage.getItem("gene-evidence-storage");
    expect(useGeneEvidenceStore.getState().burdenTraitType).toBe("binary");
    expect(stored).not.toContain("burdenTraitType");
    expect(stored).toContain('"burdenMaskMode":"all"');
  });

  it("picks the top mask among the masks the search keeps", async () => {
    useBurden();
    const user = userEvent.setup();
    renderTab("gene burden");
    await screen.findByRole("columnheader", { name: /burden mask/ });

    const search = screen.getByLabelText("search");
    await user.type(search, "PLOF");
    // statin's best mask overall is missense|LC; searched for pLoF it is still listed
    expect(bodyRows().map((r) => r.slice(1, 4))).toEqual([
      ["genebass", "LDL", "pLoF"],
      ["genebass", "statin", "pLoF"],
      ["IBD exome", "crohns", "pLoF"],
    ]);

    await user.clear(search);
    await user.type(search, "ibd exome");
    expect(bodyRows().map((r) => r[2])).toEqual(["crohns"]);
  });

  it("sorts beta by magnitude", async () => {
    useBurden();
    const user = userEvent.setup();
    renderTab("gene burden");
    await user.click(await screen.findByRole("radio", { name: /^all burden masks/ }));

    await user.click(screen.getByText("beta"));
    expect(bodyRows().map((r) => r[5])).toEqual(["0.900", "-0.500", "0.300", "0.200", "-0.100"]);
  });

  it("switches to the plot, keeps the filters and the download, and remembers the view", async () => {
    useBurden();
    // the plot runs from the dataset testing the fewest traits to the one testing the most
    server.use(
      http.get("*/api/v1/datasets", () =>
        HttpResponse.json([
          { dataset_id: "g", resource: "genebass", stats: { n_phenotypes: 4529 } },
          { dataset_id: "i", resource: "ibd_exome", n_phenotypes: 3 },
        ])
      )
    );
    const user = userEvent.setup();
    renderTab("gene burden");
    await screen.findByRole("columnheader", { name: /burden mask/ });
    expect(screen.getByRole("button", { name: "DOWNLOAD TABLE" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "DOWNLOAD PLOT" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "plot" }));
    await waitFor(() =>
      expect(screen.getByTestId("burden-plot").textContent).toBe("IBD exome:1|genebass:2")
    );
    expect(screen.getByRole("button", { name: "DOWNLOAD PLOT" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "DOWNLOAD TABLE" })).not.toBeInTheDocument();
    expect(localStorage.getItem("gene-evidence-storage")).toContain('"burdenView":"plot"');

    await user.click(screen.getByRole("radio", { name: "only quantitative traits" }));
    expect(screen.getByTestId("burden-plot").textContent).toBe("genebass:1");
  });
});

describe("annotation tab", () => {
  it("shows the gene, its model, the mygene.info record and the external links", async () => {
    renderTab("annotation");

    expect(await screen.findByText("apolipoprotein E")).toBeInTheDocument();
    expect(await screen.findByTestId("gene-model")).toHaveTextContent("4 exons");
    expect(await screen.findByText(/major apoprotein of the chylomicron/)).toBeInTheDocument();
    expect(screen.getByText(/19q13\.32 · chr19:44,903,787-44,909,396/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "gnomAD" })).toHaveAttribute(
      "href",
      "https://gnomad.broadinstitute.org/gene/ENSG00000130203?dataset=gnomad_r4"
    );
    expect(screen.getByRole("link", { name: "ClinGen" })).toHaveAttribute(
      "href",
      "https://search.clinicalgenome.org/kb/genes/HGNC:613"
    );
    expect(screen.getByRole("link", { name: "UniProt" })).toHaveAttribute(
      "href",
      "https://www.uniprot.org/uniprotkb/P02649/entry"
    );
    expect(screen.getByRole("link", { name: "hyperlipoproteinemia type 3" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cholesterol metabolism" })).toBeInTheDocument();
  });

  it("shows a long gene ontology list in full only on request", async () => {
    renderTab("annotation");

    expect(await screen.findByText("biological process (14)")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "process 14" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "show all 14" }));
    expect(screen.getByRole("link", { name: "process 14" })).toBeInTheDocument();
  });

  it("shows gnomAD constraint ahead of the summary", async () => {
    renderTab("annotation");

    const heading = await screen.findByText("gnomAD", { selector: "h6" });
    const summary = await screen.findByText("Summary");
    expect(
      heading.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(await screen.findByText("2.7e-18")).toBeInTheDocument();
    expect(screen.getByText("1.14")).toBeInTheDocument();
    expect(screen.getByText("57")).toBeInTheDocument();
    expect(screen.getByText("870")).toBeInTheDocument();
    expect(screen.getByText("ClinVar pathogenic").nextSibling).toHaveTextContent("9");
    expect(screen.getByText("ClinVar pathogenic/likely pathogenic").nextSibling).toHaveTextContent(
      "4"
    );
    expect(screen.getByText("ClinVar likely pathogenic").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("constraint flags").nextSibling).toHaveTextContent("none");
  });

  it("says so when gnomAD does not know the gene", async () => {
    server.use(
      http.get("*/v1/gene_constraint", () =>
        HttpResponse.json({ error: "not_found" }, { status: 404 })
      )
    );
    renderTab("annotation");

    expect(await screen.findByText("no gnomAD record for this gene")).toBeInTheDocument();
    expect(await screen.findByText("Summary")).toBeInTheDocument();
  });

  it("cuts a long pathway list the same way", async () => {
    server.use(
      http.get("*/v1/gene_annotation", () =>
        HttpResponse.json({
          ...geneAnnotation,
          pathways: Array.from({ length: 15 }, (_, i) => ({
            source: "reactome",
            id: `R-HSA-${i}`,
            name: `pathway ${i + 1}`,
          })),
        })
      )
    );
    renderTab("annotation");

    expect(await screen.findByText("Reactome (15)")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "pathway 15" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "show all 15" }));
    expect(screen.getByRole("link", { name: "pathway 15" })).toBeInTheDocument();
  });

  it("keeps the gene, its model and the id-based links when mygene.info has no record", async () => {
    server.use(
      http.get("*/v1/gene_annotation", () =>
        HttpResponse.json({ error: "not_found" }, { status: 404 })
      )
    );
    renderTab("annotation");

    expect(await screen.findByText("no mygene.info record for this gene")).toBeInTheDocument();
    expect(screen.getByTestId("gene-model")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "gnomAD" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "UniProt" })).not.toBeInTheDocument();
  });
});

describe("variant association tab", () => {
  const rows = [
    memberRow({}),
    memberRow({ pos: 44907000, ref: "G", alt: "A", pip: 0.1, most_severe: "intron_variant" }),
    // pseudo per the datasets fixture, quantitative per the metadata joined below
    memberRow({
      resource: "finngen_mvp_ukbb_aou",
      dataset: "FinnGen_R14_MVP_UKBB_AOU",
      trait: "LDL_Q",
      trait_original: "LDL_Q",
      cs_id: "meta",
      cs_size: 40,
      cs_min_r2: 0.31,
      pip: 0.2,
      pos: 44908822,
      ref: "C",
      most_severe: "stop_gained",
    }),
    // a neighbouring gene's missense, well upstream of the default view
    memberRow({
      cs_id: "neighbour",
      pos: 44895000,
      pip: 0.6,
      gene_most_severe: "TOMM40",
      trait: "Other_trait",
      trait_original: "OTHER",
    }),
  ];
  const requested: string[] = [];
  const TRACK_WIDTH = 1000;

  const useSummary = (members: MemberRow[]) => {
    const built = (window: number) =>
      summaryOf(members, {
        window,
        traitMeta: {
          finngen_mvp_ukbb_aou: { LDL_Q: { name: "LDL cholesterol", traitType: "quantitative" } },
        },
      });
    server.use(
      http.get("*/v1/gene_association/:gene/set_ids", ({ request }) =>
        HttpResponse.json(built(Number(new URL(request.url).searchParams.get("window"))).setIds)
      ),
      http.get("*/v1/gene_association/:gene", ({ request }) => {
        requested.push(new URL(request.url).pathname + new URL(request.url).search);
        return HttpResponse.json(
          built(Number(new URL(request.url).searchParams.get("window"))).summary
        );
      }),
      http.get("*/v1/credible_sets_by_id/:resource/:trait/:csId", ({ params }) =>
        HttpResponse.json(members.filter((m) => m.cs_id === params.csId))
      )
    );
  };

  beforeEach(() => {
    requested.length = 0;
    useSummary(rows);
    // jsdom lays nothing out: the virtualized table needs a scroll window to fill, the tracks a
    // width to map pixels to base pairs, and the canvas has no context to paint with
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(600);
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(TRACK_WIDTH);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, TRACK_WIDTH, 240)
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  const bodyRows = () => screen.getAllByTestId("assoc-row");
  const loaded = async () => {
    await screen.findByRole("cell", { name: "Alzheimer disease" });
    // the padded region has replaced the gene body, and brought the ids with it
    await waitFor(() => expect(requested).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /download table/i })).toBeEnabled()
    );
  };
  const tracks = () => screen.getByTestId("assoc-tracks");
  // APOE's default view is its transcript and a margin, 3.6 kb across the mocked 1000 px
  const xOf = (pos: number) => ((pos - 44905760) / (44909429 - 44905760)) * TRACK_WIDTH;
  // jsdom has no PointerEvent; React goes by the event's type, and a MouseEvent carries the rest
  const pointer = (type: "down" | "move" | "up" | "out", init: MouseEventInit = {}) =>
    fireEvent(tracks(), new MouseEvent(`pointer${type}`, { bubbles: true, ...init }));
  // a variant's dot, at its PIP on the 110 px between the two PIP lines
  const dot = (pos: number, pip: number) => ({ clientX: xOf(pos), clientY: 132 - pip * 110 });
  const click = (at: MouseEventInit) => {
    pointer("down", { button: 0, ...at });
    pointer("up", { button: 0, ...at });
  };
  const zoomOutFully = async (user: ReturnType<typeof userEvent.setup>) => {
    const zoomOut = screen.getByRole("button", { name: "zoom out" });
    // 3.6 kb doubles nine times before it reaches the megabase loaded around the gene
    for (let i = 0; i < 9; i++) {
      expect(zoomOut).toBeEnabled();
      await user.click(zoomOut);
    }
    expect(zoomOut).toBeDisabled();
  };

  it("asks for the gene body, then the padded region, and for nothing else of the API", async () => {
    renderTab("variant association");
    await loaded();
    expect(requested).toEqual([
      "/api/v1/gene_association/APOE?window=0",
      "/api/v1/gene_association/APOE?window=500000",
    ]);
  });

  const accounting = () => screen.getByTestId("assoc-accounting");
  const status = () => screen.getByTestId("assoc-status");

  it("lists the credible sets with a variant in view, strongest coding PIP first", async () => {
    renderTab("variant association");
    await loaded();

    expect(bodyRows()).toHaveLength(2);
    const [first, second] = bodyRows();
    expect(within(first).getByText("19:44908684:T:C")).toBeInTheDocument();
    expect(within(first).getByText("SuSiE")).toBeInTheDocument();
    expect(within(first).getByText("missense")).toBeInTheDocument();
    expect(within(first).getByText("B")).toHaveClass("badge", "binary");
    expect(within(first).getByText("2 (1 coding)")).toBeInTheDocument();
    expect(within(second).getByText("LDL cholesterol")).toBeInTheDocument();
    expect(within(second).getByText("stop gained")).toBeInTheDocument();
    expect(within(second).getByText("pseudo")).toBeInTheDocument();
    // one of the set's forty variants is inside the loaded region, so the coding count is a floor
    expect(within(second).getByText("40 (≥1 coding)")).toBeInTheDocument();
    // a cell gets its title on hover
    const lead = within(second).getByText("19:44908822:C:C");
    expect(lead).not.toHaveAttribute("title");
    fireEvent.mouseOver(lead);
    expect(lead).toHaveAttribute("title", "19:44908822:C:C");
    fireEvent.mouseOver(within(second).getByText("LDL cholesterol"));
    expect(lead).not.toHaveAttribute("title");
    // upstream of the default view
    expect(screen.queryByText("Other trait")).not.toBeInTheDocument();
    expect(screen.getByTestId("assoc-row-count")).toHaveTextContent("2 credible sets");
    expect(status()).toHaveTextContent("3 variants in view · each at its highest PIP");
    expect(accounting()).toHaveTextContent(/^2 of the 2 credible sets with a variant in view$/);
    // the column for a selected variant keeps its place while there is none
    expect(screen.getByRole("columnheader", { name: /PIP of selected/ })).toHaveClass("idle");
  });

  it("follows the track's view: zooming out brings the sets around the gene into the table", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();

    await zoomOutFully(user);
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    expect(within(bodyRows()[1]).getByText("Other trait")).toBeInTheDocument();
    // the coding variant is the neighbouring gene's, which the coding PIP names
    expect(within(bodyRows()[1]).getByText("TOMM40 0.600")).toBeInTheDocument();
    expect(status()).toHaveTextContent("4 variants in view");

    await user.click(screen.getByRole("button", { name: "reset zoom" }));
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
  });

  it("stays on a pinned stretch while the track moves", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();

    await user.click(within(screen.getByTestId("assoc-scope")).getByText("in view"));
    expect(screen.getByTestId("assoc-scope")).toHaveTextContent("pinned to chr19:44,905,7");
    await zoomOutFully(user);
    expect(status()).toHaveTextContent("4 variants in view");
    expect(bodyRows()).toHaveLength(2);
    expect(accounting()).toHaveTextContent("with a variant in the pinned stretch");

    await user.click(within(screen.getByTestId("assoc-scope")).getByTestId("CancelIcon"));
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
  });

  it("points at a lead variant that lies outside the view", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();

    // half the view around its centre keeps the intronic variant and loses the set's lead
    await user.click(screen.getByRole("button", { name: "zoom in" }));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    const lead = within(bodyRows()[0]).getByText("19:44908684:T:C →");
    fireEvent.mouseOver(lead);
    expect(lead).toHaveAttribute("title", "19:44908684:T:C lies to the right of the current view");
  });

  it("passes the sets with a variant of the kind asked for, fades the rest and remembers the kind", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();
    expect(screen.getByRole("radio", { name: "credible sets with any variant" })).toBeChecked();

    // both sets have a coding variant above the PIP threshold
    await user.click(screen.getByRole("radio", { name: "with a coding variant PIP > 0.05" }));
    expect(bodyRows()).toHaveLength(2);
    expect(status()).toHaveTextContent("3 variants in view · each");

    await user.click(screen.getByRole("radio", { name: "with a LoF variant PIP > 0.05" }));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(within(bodyRows()[0]).getByText("LDL cholesterol")).toBeInTheDocument();
    expect(useGeneEvidenceStore.getState().assocVariantMode).toBe("lof");
    // nothing leaves the track: the other set's variants are counted, and faint. the count is
    // written on the next paint
    await waitFor(() =>
      expect(status()).toHaveTextContent(
        "3 variants in view, 1 in credible sets that pass the filters"
      )
    );
    expect(accounting()).toHaveTextContent("1 of the 2 credible sets with a variant in view");
    // the dot is where every set puts it, and the line below says what the filter leaves
    pointer("move", dot(44908684, 0.9));
    expect(screen.getByTestId("assoc-readout")).toHaveTextContent(
      "highest PIP 0.900 · in 1 credible set · none passing the filters"
    );

    // the filter is put away from its chip
    await user.click(
      within(screen.getByText("LoF variant PIP > 0.05").parentElement!).getByTestId("CancelIcon")
    );
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(screen.getByRole("radio", { name: "credible sets with any variant" })).toBeChecked();
  });

  it("does not count a variant of the kind at or below the PIP threshold", async () => {
    useSummary([
      memberRow({ most_severe: "intron_variant" }),
      memberRow({ pos: 44907000, ref: "G", alt: "A", pip: 0.05 }),
    ]);
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();

    await user.click(screen.getByRole("radio", { name: "with a coding variant PIP > 0.05" }));
    expect(await screen.findByTestId("assoc-empty")).toHaveTextContent(
      "no credible sets with a variant in view pass the filters"
    );
  });

  it("sorts by a column on a click of its header, and turns round on the next", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();
    const header = (name: RegExp) => screen.getByRole("columnheader", { name });
    const trait = header(/^trait/);
    const order = screen.getByTestId("assoc-sort");
    // one column carries the order, and the footer names the whole of it
    expect(header(/coding PIP/)).toHaveAttribute("aria-sort", "descending");
    expect(header(/^PIP(?! of)/)).toHaveAttribute("aria-sort", "none");
    expect(order).toHaveTextContent(/^sorted by coding PIP, then PIP$/);

    await user.click(trait);
    expect(trait).toHaveAttribute("aria-sort", "ascending");
    expect(header(/coding PIP/)).toHaveAttribute("aria-sort", "none");
    expect(within(bodyRows()[0]).getByText("Alzheimer disease")).toBeInTheDocument();
    expect(order).toHaveTextContent(/^sorted by trait, then PIP · reset$/);
    await user.click(trait);
    expect(trait).toHaveAttribute("aria-sort", "descending");
    expect(within(bodyRows()[0]).getByText("LDL cholesterol")).toBeInTheDocument();

    // back to the opening order from the footer, or by its own column
    await user.click(within(order).getByRole("button", { name: "reset" }));
    expect(header(/coding PIP/)).toHaveAttribute("aria-sort", "descending");
    expect(within(bodyRows()[0]).getByText("Alzheimer disease")).toBeInTheDocument();
    expect(order).toHaveTextContent(/^sorted by coding PIP, then PIP$/);
    await user.click(header(/^PIP(?! of)/));
    expect(order).toHaveTextContent(/^sorted by PIP · reset$/);
    await user.click(header(/coding PIP/));
    expect(order).toHaveTextContent(/^sorted by coding PIP, then PIP$/);
  });

  it("keeps the order the user chose across a selection", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();
    const order = screen.getByTestId("assoc-sort");
    await user.click(screen.getByRole("columnheader", { name: /^trait/ }));

    click(dot(44907000, 0.1));
    await waitFor(() => expect(order).toHaveTextContent(/^sorted by PIP of selected, then PIP$/));
    click(dot(44907000, 0.1));
    await waitFor(() => expect(order).toHaveTextContent(/^sorted by trait, then PIP · reset$/));
  });

  it("opens a row to the variants of its credible set, the coding ones first, fetched then", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();
    expect(screen.queryByTestId("assoc-members")).not.toBeInTheDocument();

    await user.click(bodyRows()[0]);
    const members = await screen.findByTestId("assoc-members");
    const memberRows = await within(members).findAllByRole("row");
    expect(memberRows.map((r) => r.textContent)).toEqual([
      "1 coding variant in this credible set",
      expect.stringMatching(/^variantconsequencegenePIP/),
      expect.stringMatching(/^19:44908684:T:Cmissense/),
      "1 non-coding variant in this credible set",
      expect.stringMatching(/^19:44907000:G:Aintron/),
    ]);
    expect(bodyRows()[0]).toHaveAttribute("aria-expanded", "true");

    await user.click(bodyRows()[0]);
    expect(screen.queryByTestId("assoc-members")).not.toBeInTheDocument();
  });

  it("heads the variants of a set without a coding one with their number alone", async () => {
    useSummary([
      memberRow({ most_severe: "intron_variant" }),
      memberRow({ pos: 44907000, ref: "G", alt: "A", pip: 0.1, most_severe: "intron_variant" }),
    ]);
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();

    await user.click(bodyRows()[0]);
    const members = await screen.findByTestId("assoc-members");
    expect((await within(members).findAllByRole("row"))[0]).toHaveTextContent(
      /^2 variants in this credible set$/
    );
  });

  it("gives a credible set of one variant nothing to open", async () => {
    useSummary([memberRow({ cs_size: 1 })]);
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();

    expect(bodyRows()[0]).toHaveClass("single");
    expect(within(bodyRows()[0]).getByText("1 (1 coding)")).toBeInTheDocument();
    await user.click(bodyRows()[0]);
    expect(screen.queryByTestId("assoc-members")).not.toBeInTheDocument();
  });

  it("lists a variant's credible sets on a click of it, with its PIP in each", async () => {
    renderTab("variant association");
    await loaded();
    expect(screen.queryByTestId("assoc-selection")).not.toBeInTheDocument();

    // no variant here, and nothing selected to put away
    click({ clientX: xOf(44908000), clientY: 60 });
    expect(screen.queryByTestId("assoc-selection")).not.toBeInTheDocument();
    expect(bodyRows()).toHaveLength(2);

    // the intronic variant is at PIP 0.1 in a set led by its missense variant
    click(dot(44907000, 0.1));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(within(bodyRows()[0]).getByText("Alzheimer disease")).toBeInTheDocument();
    expect(screen.getByTestId("assoc-selection")).toHaveTextContent("19:44907000:G:A");
    expect(accounting()).toHaveTextContent("1 of the 1 credible sets with this variant");
    const selectedPip = screen.getByRole("columnheader", { name: /PIP of selected/ });
    expect(selectedPip).not.toHaveClass("idle");
    expect(selectedPip).toHaveAttribute("aria-sort", "descending");
    expect(within(bodyRows()[0]).getByText("0.100")).toBeInTheDocument();
    // the LoF variant shares no set with it
    await waitFor(() =>
      expect(status()).toHaveTextContent(
        "3 variants in view, 2 in credible sets that pass the filters and hold the selection"
      )
    );

    // a click on the selected variant puts the selection away
    click(dot(44907000, 0.1));
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(screen.queryByTestId("assoc-selection")).not.toBeInTheDocument();

    // and so does a click on the track beside it
    click(dot(44908822, 0.2));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    click({ clientX: xOf(44908000), clientY: 60 });
    await waitFor(() => expect(bodyRows()).toHaveLength(2));

    click(dot(44908822, 0.2));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    fireEvent.keyDown(tracks(), { key: "Escape" });
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
  });

  it("keeps the top trait per lead variant and dataset on request, and says what a row stands for", async () => {
    useSummary([
      memberRow({}),
      memberRow({ trait: "Dementia", trait_original: "F5_DEMENTIA", cs_id: "weaker", pip: 0.4 }),
      memberRow({ trait: "Memory_loss", trait_original: "MEM", cs_id: "faint", pip: 0.01 }),
    ]);
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();
    expect(bodyRows()).toHaveLength(3);
    expect(screen.queryByRole("columnheader", { name: /^more/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /top trait only/ }));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(within(bodyRows()[0]).getByText("Alzheimer disease")).toBeInTheDocument();
    expect(within(bodyRows()[0]).getByText("+2")).toBeInTheDocument();
    expect(accounting()).toHaveTextContent(
      "1 row for 3 of the 3 credible sets with a variant in view"
    );
    expect(useGeneEvidenceStore.getState().assocTraitMode).toBe("top");
    // the track is not told: the dot is in every one of the sets
    pointer("move", dot(44908684, 0.9));
    expect(screen.getByTestId("assoc-readout")).toHaveTextContent(/in 3 credible sets$/);

    // a search leaves one of the sets, and the dot goes to its PIP in that one
    await user.type(screen.getByRole("textbox", { name: "search" }), "dementia");
    await waitFor(() => expect(within(bodyRows()[0]).getByText("Dementia")).toBeInTheDocument());
    await waitFor(() => {
      pointer("move", dot(44908684, 0.4));
      expect(screen.getByTestId("assoc-readout")).toHaveTextContent(
        "highest PIP 0.900 · in 3 credible sets · 1 passing the filters, highest PIP 0.400 in those"
      );
    });
  });

  it("moves a variant to its PIP in the credible set of the table row under the pointer", async () => {
    useSummary([
      memberRow({}),
      memberRow({ trait: "Memory_loss", trait_original: "MEM", cs_id: "faint", pip: 0.01 }),
    ]);
    renderTab("variant association");
    await loaded();
    const readout = screen.getByTestId("assoc-readout");
    pointer("move", dot(44908684, 0.9));
    expect(readout).toHaveTextContent("19:44908684:T:C");

    fireEvent.mouseOver(screen.getByRole("cell", { name: "Memory loss" }));
    await waitFor(() => {
      pointer("move", dot(44908684, 0.01));
      expect(readout).toHaveTextContent("19:44908684:T:C");
    });
    pointer("move", dot(44908684, 0.9));
    expect(readout).not.toHaveTextContent("19:44908684:T:C");

    // and back once the pointer has left the table
    fireEvent.mouseLeave(screen.getByTestId("assoc-table"));
    await waitFor(() => {
      pointer("move", dot(44908684, 0.9));
      expect(readout).toHaveTextContent("19:44908684:T:C");
    });
  });

  it("selects the region a drag covers, and pans on a drag with ctrl held", async () => {
    renderTab("variant association");
    await loaded();

    pointer("down", { button: 0, clientX: xOf(44908600) });
    pointer("move", { clientX: xOf(44908900) });
    pointer("up", { clientX: xOf(44908900) });
    await waitFor(() => expect(screen.getByTestId("assoc-selection")).toHaveTextContent("301 bp"));
    expect(bodyRows()).toHaveLength(2);
    expect(accounting()).toHaveTextContent("2 of the 2 credible sets with a variant in the region");
    // the view stayed where it was
    expect(screen.getByRole("button", { name: "reset zoom" })).toBeDisabled();

    // a click inside the region keeps it, one outside puts it away
    click({ clientX: xOf(44908750), clientY: 60 });
    expect(screen.getByTestId("assoc-selection")).toBeInTheDocument();
    click({ clientX: xOf(44908000), clientY: 60 });
    await waitFor(() => expect(screen.queryByTestId("assoc-selection")).not.toBeInTheDocument());

    pointer("down", { button: 0, clientX: 500, ctrlKey: true });
    pointer("move", { clientX: 300, ctrlKey: true });
    pointer("up", { clientX: 300, ctrlKey: true });
    // the view moved, and nothing was selected
    await waitFor(() => expect(screen.getByRole("button", { name: "reset zoom" })).toBeEnabled());
    expect(screen.queryByTestId("assoc-selection")).not.toBeInTheDocument();
  });

  it("zooms on ctrl + wheel and leaves a plain wheel to scroll the page", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();
    const reset = screen.getByRole("button", { name: "reset zoom" });

    const plain = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
    tracks().dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(reset).toBeDisabled();

    const zoom = new WheelEvent("wheel", {
      deltaY: 100,
      ctrlKey: true,
      clientX: 500,
      bubbles: true,
      cancelable: true,
    });
    tracks().dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);
    await waitFor(() => expect(reset).toBeEnabled());

    await user.click(reset);
    expect(reset).toBeDisabled();
    await zoomOutFully(user);
  });

  it("names what is under the pointer in the line below the tracks, without a tooltip", async () => {
    renderTab("variant association");
    await loaded();
    const readout = screen.getByTestId("assoc-readout");
    expect(readout).toHaveTextContent("click a variant for its credible sets");

    pointer("move", dot(44908684, 0.9));
    expect(readout).toHaveTextContent(
      /^19:44908684:T:C · missense · APOE · highest PIP 0\.900 · in 1 credible set$/
    );
    // the cursor says what a press would do
    expect(tracks().style.cursor).toBe("pointer");
    // the gene, on the forward strand's lane
    pointer("move", { clientX: 500, clientY: 168 });
    expect(readout).toHaveTextContent(
      /^APOE · chr19:44,905,7\d\d–44,909,3\d\d · 3\.6 kb · 4 exons · forward strand$/
    );
    expect(tracks().style.cursor).toBe("crosshair");
    pointer("move", { clientX: 500, clientY: 168, ctrlKey: true });
    expect(tracks().style.cursor).toBe("grab");
    // React derives a leave from the pointer going out
    pointer("out");
    expect(readout).toHaveTextContent("click a variant for its credible sets");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("filters by trait type and credible set kind, and remembers the radios", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();

    await user.click(screen.getByRole("radio", { name: /only binary traits/ }));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(screen.getByRole("cell", { name: "Alzheimer disease" })).toBeInTheDocument();
    expect(useGeneEvidenceStore.getState().assocTraitType).toBe("binary");
    // the gene burden tab keeps its own setting
    expect(useGeneEvidenceStore.getState().burdenTraitType).toBe("all");

    await user.click(screen.getByRole("radio", { name: /both binary and quantitative/ }));
    await user.click(screen.getByRole("radio", { name: "only pseudo credible sets" }));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(screen.getByRole("cell", { name: "LDL cholesterol" })).toBeInTheDocument();
    expect(screen.getByText("pseudo only")).toBeInTheDocument();
  });

  it("searches for every word typed, in the trait or the dataset", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();
    const search = screen.getByRole("textbox", { name: "search" });
    expect(screen.queryByRole("button", { name: "clear search" })).not.toBeInTheDocument();

    // one word is the trait's, the other the dataset's
    await user.type(search, "cholesterol mvp");
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(screen.getByRole("cell", { name: "LDL cholesterol" })).toBeInTheDocument();

    // each word matches a set, and no set has both
    await user.clear(search);
    await user.type(search, "cholesterol alzheimer");
    expect(await screen.findByTestId("assoc-empty")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "clear search" }));
    expect(search).toHaveValue("");
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
  });

  it("says so when there is no GWAS credible set near the gene", async () => {
    useSummary([]);
    renderTab("variant association");
    expect(
      await screen.findByText("no GWAS credible sets within 500 kb of this gene")
    ).toBeInTheDocument();
  });
});

describe("ai summary tab", () => {
  const summary = {
    gene: "APOE",
    generated: "2026-11-23",
    model: "a-model",
    headline: "the headline",
    overview: "the overview",
    findings: [
      {
        statement: "a burden finding",
        tab: "gene burden",
        evidence: [
          {
            id: "B1",
            label: "genebass · Apolipoprotein A · missense|LC · p 5.2e-7",
          },
          {
            id: "B2",
            label: "genebass · C-reactive protein · missense|LC · p 3.2e-10",
          },
        ],
      },
      {
        statement: "a QTL finding",
        tab: "qtl",
        evidence: [{ id: "Q1", label: "an eQTL" }],
      },
    ],
    gaps: ["nothing colocalizes"],
  };

  it("shows the summary, with the rows behind a finding on request", async () => {
    server.use(http.get("*/api/v1/gene_summary/:gene", () => HttpResponse.json(summary)));
    renderTab("ai summary");

    expect(await screen.findByRole("heading", { name: "the headline" })).toBeInTheDocument();
    expect(screen.getByText("the overview")).toBeInTheDocument();
    expect(screen.getByText("nothing colocalizes")).toBeInTheDocument();
    expect(screen.getByText(/a-model.*2026-11-23/)).toBeInTheDocument();

    expect(screen.queryByText(/Apolipoprotein A/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "show the 2 results behind this" }));
    expect(screen.getByText(/Apolipoprotein A/)).toBeInTheDocument();
    expect(screen.getByText(/C-reactive protein/)).toBeInTheDocument();
  });

  it("opens the tab a finding points at, and offers no way into one that is not there yet", async () => {
    server.use(http.get("*/api/v1/gene_summary/:gene", () => HttpResponse.json(summary)));
    renderTab("ai summary");

    await screen.findByText("a QTL finding");
    expect(screen.getByText(/qtl tab, coming soon/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "open the qtl tab" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "open the gene burden tab" }));
    expect(screen.getByRole("tab", { name: "gene burden" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("says so for a gene without a summary", async () => {
    renderTab("ai summary");
    expect(await screen.findByText("no AI summary for APOE yet")).toBeInTheDocument();
  });

  it("surfaces a server error", async () => {
    server.use(
      http.get("*/api/v1/gene_summary/:gene", () => HttpResponse.json({}, { status: 500 }))
    );
    renderTab("ai summary");
    expect(await screen.findByText(/failed to load/)).toBeInTheDocument();
  });
});
