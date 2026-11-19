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
    // no coding variant of the gene: a neighbour's missense, well upstream
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
    await waitFor(() => expect(screen.getByRole("button", { name: /download table/i })).toBeEnabled());
  };
  const tracks = () => screen.getByTestId("assoc-tracks");
  // APOE's default view is its transcript and a margin, 3.6 kb across the mocked 1000 px
  const xOf = (pos: number) => ((pos - 44905760) / (44909429 - 44905760)) * TRACK_WIDTH;
  // jsdom has no PointerEvent; React goes by the event's type, and a MouseEvent carries the rest
  const pointer = (type: "down" | "move" | "up" | "out", init: MouseEventInit = {}) =>
    fireEvent(tracks(), new MouseEvent(`pointer${type}`, { bubbles: true, ...init }));
  const clickTrack = (pos: number) => {
    pointer("down", { button: 0, clientX: xOf(pos), clientY: 60 });
    pointer("up", { button: 0, clientX: xOf(pos), clientY: 60 });
  };

  it("asks for the gene body, then the padded region, and for nothing else of the API", async () => {
    renderTab("variant association");
    await loaded();
    expect(requested).toEqual([
      "/api/v1/gene_association/APOE?window=0",
      "/api/v1/gene_association/APOE?window=500000",
    ]);
  });

  it("lists the credible sets with a coding variant of the gene, strongest coding PIP first", async () => {
    renderTab("variant association");
    await loaded();

    expect(bodyRows()).toHaveLength(2);
    const [first, second] = bodyRows();
    expect(within(first).getByText("19:44908684:T:C")).toBeInTheDocument();
    expect(within(first).getByText("SuSiE")).toBeInTheDocument();
    expect(within(first).getByText("missense")).toBeInTheDocument();
    expect(within(first).getByTitle("binary")).toHaveTextContent("B");
    expect(within(second).getByText("LDL cholesterol")).toBeInTheDocument();
    expect(within(second).getByText("stop gained")).toBeInTheDocument();
    expect(within(second).getByText("pseudo")).toBeInTheDocument();
    expect(within(second).getByText("40")).toBeInTheDocument();
    // one of the set's forty variants is inside the loaded region
    expect(within(second).getByText("†")).toBeInTheDocument();
    expect(screen.queryByText("Other trait")).not.toBeInTheDocument();
    expect(screen.getByTestId("assoc-row-count")).toHaveTextContent("2 credible sets");
  });

  it("lists every credible set once the coding filter is off, and remembers that", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();
    expect(screen.getByLabelText("min coding PIP")).toHaveValue("0.05");

    await user.click(screen.getByRole("checkbox", { name: /only credible sets with a coding variant/ }));
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    // sets without a coding variant follow those with one, by the PIP of their lead
    expect(within(bodyRows()[2]).getByText("Other trait")).toBeInTheDocument();
    expect(screen.getByLabelText("min PIP")).toBeInTheDocument();
    expect(useGeneEvidenceStore.getState().assocCodingOnly).toBe(false);
  });

  it("sorts by a column on a click of its header, and turns round on the next", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();
    const trait = screen.getByRole("columnheader", { name: /^trait/ });
    expect(screen.getByRole("columnheader", { name: /coding PIP/ })).toHaveAttribute(
      "aria-sort",
      "descending"
    );

    await user.click(trait);
    expect(trait).toHaveAttribute("aria-sort", "ascending");
    expect(within(bodyRows()[0]).getByText("Alzheimer disease")).toBeInTheDocument();
    await user.click(trait);
    expect(trait).toHaveAttribute("aria-sort", "descending");
    expect(within(bodyRows()[0]).getByText("LDL cholesterol")).toBeInTheDocument();
  });

  it("opens a row to every variant of its credible set, fetched then", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();
    expect(screen.queryByTestId("assoc-members")).not.toBeInTheDocument();

    await user.click(bodyRows()[0]);
    const members = await screen.findByTestId("assoc-members");
    const memberRows = await within(members).findAllByRole("row");
    // header, then the set's two variants by PIP
    expect(memberRows).toHaveLength(3);
    expect(memberRows[1]).toHaveTextContent("19:44908684:T:C");
    expect(memberRows[1]).toHaveTextContent("missense");
    expect(memberRows[1]).toHaveClass("coding");
    expect(memberRows[2]).toHaveTextContent("19:44907000:G:A");
    expect(memberRows[2]).not.toHaveClass("coding");
    expect(bodyRows()[0]).toHaveAttribute("aria-expanded", "true");

    await user.click(bodyRows()[0]);
    expect(screen.queryByTestId("assoc-members")).not.toBeInTheDocument();
  });

  it("narrows the table to the credible sets with a variant where the track is clicked", async () => {
    const user = userEvent.setup();
    renderTab("variant association");
    await loaded();
    expect(screen.queryByTestId("assoc-selection")).not.toBeInTheDocument();

    clickTrack(44908822);
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(within(bodyRows()[0]).getByText("LDL cholesterol")).toBeInTheDocument();
    expect(screen.getByTestId("assoc-selection")).toHaveTextContent(/^chr19:44,908,8\d\d–44,908,8\d\d/);

    // a click on the selection puts it away
    clickTrack(44908822);
    await waitFor(() => expect(bodyRows()).toHaveLength(2));

    // the intronic variant is in a listed set, but is not a coding variant of the gene
    clickTrack(44907000);
    expect(await screen.findByTestId("assoc-empty")).toHaveTextContent(
      "no credible set with a coding variant of APOE has a variant in the selection; 1 other does"
    );
    await user.click(screen.getByRole("button", { name: "show it" }));
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(within(bodyRows()[0]).getByText("Alzheimer disease")).toBeInTheDocument();

    fireEvent.keyDown(tracks(), { key: "Escape" });
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
  });

  it("selects the region a shift-drag covers, and pans on a plain drag", async () => {
    renderTab("variant association");
    await loaded();

    pointer("down", { button: 0, clientX: xOf(44908600), shiftKey: true });
    pointer("move", { clientX: xOf(44908900) });
    pointer("up", { clientX: xOf(44908900) });
    await waitFor(() => expect(screen.getByTestId("assoc-selection")).toHaveTextContent("301 bp"));
    expect(bodyRows()).toHaveLength(2);

    fireEvent.keyDown(tracks(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("assoc-selection")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "reset zoom" })).toBeDisabled();
    pointer("down", { button: 0, clientX: 500 });
    pointer("move", { clientX: 300 });
    pointer("up", { clientX: 300 });
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
    const zoomOut = screen.getByRole("button", { name: "zoom out" });
    // 3.6 kb doubles nine times before it reaches the megabase loaded around the gene
    for (let i = 0; i < 9; i++) {
      expect(zoomOut).toBeEnabled();
      await user.click(zoomOut);
    }
    expect(zoomOut).toBeDisabled();
  });

  it("names what is under the pointer in the line below the tracks, without a tooltip", async () => {
    renderTab("variant association");
    await loaded();
    const readout = screen.getByTestId("assoc-readout");
    expect(readout).toHaveTextContent("ctrl/⌘ + scroll to zoom");

    // the missense variant's dot, at its PIP of 0.9 on the 110 px between the two PIP lines
    pointer("move", { clientX: xOf(44908684), clientY: 132 - 0.9 * 110 });
    expect(readout).toHaveTextContent(
      "19:44908684:T:C · missense · APOE · highest PIP 0.900 · in 1 credible set"
    );
    // the gene, on the forward strand's lane
    pointer("move", { clientX: 500, clientY: 168 });
    expect(readout).toHaveTextContent(/^APOE · chr19:44,905,7\d\d–44,909,3\d\d · 3\.6 kb · 4 exons · forward strand$/);
    // React derives a leave from the pointer going out
    pointer("out");
    expect(readout).toHaveTextContent("ctrl/⌘ + scroll to zoom");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("filters by trait type, credible set kind, PIP and search, and remembers the radios", async () => {
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

    // the meta-analysis set's coding variant has PIP 0.2
    const minPip = screen.getByLabelText("min coding PIP");
    await user.clear(minPip);
    await user.type(minPip, "0.5");
    expect(await screen.findByTestId("assoc-empty")).toHaveTextContent(
      "no credible sets match these filters"
    );
    await user.clear(minPip);

    await user.type(screen.getByLabelText("search"), "alzheimer");
    expect(await screen.findByTestId("assoc-empty")).toBeInTheDocument();
  });

  it("says so when there is no GWAS credible set near the gene", async () => {
    useSummary([]);
    renderTab("variant association");
    expect(
      await screen.findByText("no GWAS credible sets within 500 kb of this gene")
    ).toBeInTheDocument();
  });
});
