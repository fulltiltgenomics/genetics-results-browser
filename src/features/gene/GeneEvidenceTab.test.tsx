import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderHook, waitFor as waitForHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { PropsWithChildren } from "react";
import { server } from "@/test/msw/server";
import geneAnnotation from "@/test/fixtures/gene_annotation.json";
import GeneEvidenceTab from "./GeneEvidenceTab";
import { GeneEvidenceTabName, useGeneEvidenceStore } from "@/store/store.geneEvidence";
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
      "annotation",
      "gene burden",
      "variant association",
      "qtl",
      "expression",
      "mendelian",
    ]);
    expect(screen.getByRole("tab", { name: "gene burden" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // burden trait from the fixture (the fixture has multiple Apolipoprotein A rows)
    await waitFor(() => expect(screen.getAllByText("Apolipoprotein A").length).toBeGreaterThan(0));
    // the other tabs' content is not mounted
    expect(screen.queryByText(/Expression \(GTEx/)).not.toBeInTheDocument();
  });

  it("switches tabs and remembers the selection in localStorage", async () => {
    const user = userEvent.setup();
    render(<GeneEvidenceTab geneName="APOE" />, { wrapper: makeWrapper() });

    await user.click(screen.getByRole("tab", { name: "mendelian" }));
    expect((await screen.findAllByText(/hyperlipoproteinemia/i)).length).toBeGreaterThan(0);
    expect(localStorage.getItem("gene-evidence-storage")).toContain('"activeTab":"mendelian"');

    await user.click(screen.getByRole("tab", { name: "expression" }));
    expect(await screen.findByText("Expression (GTEx v10)")).toBeInTheDocument();
  });

  it("reads a gene-disease 404 as no associations rather than a failure", async () => {
    server.use(
      http.get("*/api/v1/gene_disease/:gene", () =>
        HttpResponse.json({ detail: "No disease associations found for gene OR51B4" }, { status: 404 })
      )
    );

    renderTab("mendelian", "OR51B4");

    expect(
      await screen.findByText("no gene-disease associations for this gene")
    ).toBeInTheDocument();
    expect(screen.queryByText(/failed to load/)).not.toBeInTheDocument();
  });

  it("surfaces a gene-disease server error", async () => {
    server.use(http.get("*/api/v1/gene_disease/:gene", () => new HttpResponse(null, { status: 500 })));

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

  it("shows GTEx as a plot by default and switches to the table on toggle", async () => {
    const user = userEvent.setup();
    renderTab("expression");

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
    renderTab("expression");

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

    renderTab("expression");

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
      .map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));

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
    expect(screen.getByRole("radio", { name: "both binary and quantitative traits" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "only the top burden mask for each trait" })
    ).toBeChecked();
  });

  it("filters by trait type and mask mode, and remembers both", async () => {
    useBurden();
    const user = userEvent.setup();
    renderTab("gene burden");
    await screen.findByRole("columnheader", { name: /burden mask/ });

    await user.click(screen.getByRole("radio", { name: "only binary traits" }));
    expect(bodyRows().map((r) => r[2])).toEqual(["statin", "crohns"]);

    await user.click(screen.getByRole("radio", { name: "all burden masks for each trait" }));
    expect(bodyRows().map((r) => r[3])).toEqual(["missense|LC", "pLoF", "pLoF"]);

    const stored = localStorage.getItem("gene-evidence-storage");
    expect(stored).toContain('"burdenTraitType":"binary"');
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
    expect(heading.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
  const csRow = (over: Record<string, unknown>) => ({
    resource: "finngen",
    version: "R14",
    dataset: "FinnGen_R14",
    data_type: "GWAS",
    trait: "Alzheimer_disease",
    trait_original: "G6_ALZHEIMER",
    cell_type: null,
    chr: 19,
    pos: 44908684,
    ref: "T",
    alt: "C",
    mlog10p: 300,
    beta: 1.2,
    se: 0.02,
    pip: 0.9,
    cs_id: "chr19_44908684_T_C",
    cs_size: 2,
    cs_min_r2: 0.8,
    aaf: 0.18,
    most_severe: "missense_variant",
    gene_most_severe: "APOE",
    ...over,
  });

  beforeEach(() => {
    server.use(
      http.get("*/v1/credible_sets_by_gene/:gene", () =>
        HttpResponse.json([
          csRow({}),
          csRow({ pos: 44907000, ref: "G", alt: "A", pip: 0.1, most_severe: "intron_variant" }),
          // pseudo per the datasets fixture, and a trait the metadata fixture does not list
          csRow({
            resource: "finngen_mvp_ukbb_aou",
            dataset: "FinnGen_R14_MVP_UKBB_AOU",
            trait: "LDL_cholesterol",
            trait_original: "LDL_Q",
            cs_id: "meta",
            cs_size: 40,
            cs_min_r2: 0.31,
            pip: 0.2,
            pos: 44908822,
            ref: "C",
            most_severe: "stop_gained",
          }),
          csRow({ cs_id: "neighbour", gene_most_severe: "TOMM40", trait: "Other_trait" }),
        ])
      )
    );
  });

  const bodyRows = () => screen.getAllByRole("row").slice(1);

  it("lists one row per credible set with a coding variant of the gene, strongest PIP first", async () => {
    renderTab("variant association");

    expect(await screen.findByRole("cell", { name: "Alzheimer disease" })).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(2);
    expect(within(bodyRows()[0]).getByText("19:44908684:T:C")).toBeInTheDocument();
    expect(within(bodyRows()[0]).getByText("SuSiE")).toBeInTheDocument();
    expect(within(bodyRows()[0]).getByText("0.800")).toBeInTheDocument();
    expect(within(bodyRows()[1]).getByText("stop gained")).toBeInTheDocument();
    expect(within(bodyRows()[1]).getByText("pseudo")).toBeInTheDocument();
    expect(within(bodyRows()[1]).getByText("40")).toBeInTheDocument();
    expect(screen.queryByText("Other trait")).not.toBeInTheDocument();
    expect(await screen.findByTestId("gene-model")).toHaveTextContent("4 exons");
  });

  it("draws the variants of the credible set under the pointer on the gene model", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await screen.findByRole("cell", { name: "Alzheimer disease" });
    const model = await screen.findByTestId("gene-model");
    expect(model.querySelectorAll("[data-variant-class]")).toHaveLength(0);

    await user.hover(bodyRows()[0]);
    expect(screen.getByTestId("shown-credible-set")).toHaveTextContent(
      "Alzheimer disease · FinnGen R14 · 2 of 2 variants in view"
    );
    expect(
      Array.from(model.querySelectorAll("[data-variant-class]")).map((m) =>
        m.getAttribute("data-variant-class")
      )
    ).toEqual(["other", "coding"]);

    await user.hover(bodyRows()[1]);
    expect(
      Array.from(model.querySelectorAll("[data-variant-class]")).map((m) =>
        m.getAttribute("data-variant-class")
      )
    ).toEqual(["lof"]);
  });

  it("marks the table's coding variants on the gene model, with a per-dataset tooltip", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await screen.findByRole("cell", { name: "Alzheimer disease" });
    const model = await screen.findByTestId("gene-model");
    const classes = () =>
      Array.from(model.querySelectorAll("[data-mark-class]")).map((m) =>
        m.getAttribute("data-mark-class")
      );
    expect(classes()).toEqual(["coding", "lof"]);

    await user.hover(model.querySelector('[data-mark-class="lof"]')!);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("19:44908822:C:C");
    expect(tooltip).toHaveTextContent("stop gained");
    expect(tooltip).toHaveTextContent("FinnGen+MVP+UKB+AoU (R14)LDL cholesterol0.200");

    // the meta-analysis set's coding variant has PIP 0.2: raising the threshold drops its row and mark
    const minPip = screen.getByLabelText("min coding PIP");
    expect(minPip).toHaveValue("0.05");
    await user.clear(minPip);
    await user.type(minPip, "0.5");
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(classes()).toEqual(["coding"]);
  });

  it("zooms out to the gene's surroundings and back, counting what the view leaves out", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await screen.findByRole("cell", { name: "Alzheimer disease" });
    const model = await screen.findByTestId("gene-model");
    await user.hover(bodyRows()[0]);
    expect(screen.queryByTestId("variants-beyond-left")).not.toBeInTheDocument();

    // the transcript is 3.6 kb: three halvings leave ~450 bp around its middle, between the two variants
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByRole("button", { name: "zoom in" }));
    }
    expect(screen.getByTestId("shown-credible-set")).toHaveTextContent("0 of 2 variants in view");
    expect(screen.getByTestId("variants-beyond-left")).toHaveTextContent("◀ 1");
    expect(screen.getByTestId("variants-beyond-right")).toHaveTextContent("1 ▶");
    expect(model.querySelectorAll("[data-variant-class]")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "reset zoom" }));
    expect(screen.getByTestId("shown-credible-set")).toHaveTextContent("2 of 2 variants in view");
    await user.click(screen.getByRole("button", { name: "zoom out" }));
    expect(model.querySelectorAll("[data-variant-class]")).toHaveLength(2);
  });

  it("filters by trait type, credible set kind and search, and remembers the radios", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await screen.findByRole("cell", { name: "Alzheimer disease" });

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

    await user.type(screen.getByLabelText("search"), "alzheimer");
    expect(await screen.findByText("no credible sets match these filters")).toBeInTheDocument();
  });

  it("says so when no credible set holds a coding variant of the gene", async () => {
    server.use(http.get("*/v1/credible_sets_by_gene/:gene", () => HttpResponse.json([])));
    renderTab("variant association");
    expect(
      await screen.findByText("no GWAS credible sets with a coding variant in this gene")
    ).toBeInTheDocument();
  });
});
