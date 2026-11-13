import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { PropsWithChildren } from "react";
import { server } from "@/test/msw/server";

// the viewer needs WebGL; what the section hands it is what these tests are about
const viewer = vi.fn();
vi.mock("../structure/StructureViewer", () => ({
  StructureView: (props: Record<string, unknown>) => {
    viewer(props);
    return <div data-testid="structure-view-stub" />;
  },
}));

import ProteinSection from "./ProteinSection";

const wrapper = ({ children }: PropsWithChildren) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const modelRow = (over: Record<string, unknown>) => ({
  model_file_id: "AF-P1-F1-model_v6",
  accession: "P1",
  gene_name: "GENE1",
  source_label: "AlphaFold Protein Structure Database",
  window_index: 1,
  n_windows: 1,
  protein_start: 1,
  protein_end: 10,
  owned_start: 1,
  owned_end: 10,
  ...over,
});

const RESIDUE_HEADER = "accession\tmodel_file_id\tfile_position\tprotein_position\tresidue\tis_owner\tplddt";
const residueLine = (accession: string, file: string, filePos: number, pos: number, owner: boolean) =>
  [accession, file, filePos, pos, "A", owner, 80].join("\t");
const tsv = (lines: string[]) =>
  HttpResponse.text(lines.join("\n") + "\n", { headers: { "Content-Type": "text/tab-separated-values" } });

const csRow = (pos: number, mostSevere: string, over: Record<string, unknown> = {}) => ({
  resource: "finngen",
  version: "R13",
  dataset: "FinnGen_R13",
  data_type: "GWAS",
  trait: "T2D",
  trait_original: "T2D",
  cell_type: null,
  chr: 1,
  pos,
  ref: "G",
  alt: "A",
  mlog10p: 12,
  beta: 0.1,
  se: 0.01,
  pip: 0.5,
  cs_id: "chr1_1_G_A_1",
  cs_size: 2,
  cs_min_r2: 0.9,
  aaf: 0.1,
  most_severe: mostSevere,
  gene_most_severe: "GENE1",
  ...over,
});

interface Served {
  models: unknown[];
  residues: string[];
  mapRows?: Record<string, string>[];
  credibleSets?: unknown[];
}

const mapRow = (variant: string, aaPos: number, file = "AF-P1-F1-model_v6", filePos = aaPos, accession = "P1", gene = "GENE1") => ({
  variant,
  accession,
  gene_name: gene,
  aa_pos: String(aaPos),
  aa_ref: "A",
  aa_alt: "T",
  model_file_id: file,
  file_position: String(filePos),
});

const DEFAULT_SETS = [csRow(101, "missense_variant"), csRow(102, "intron_variant"), csRow(103, "missense_variant")];

const serve = ({ models, residues, mapRows = [], credibleSets = DEFAULT_SETS }: Served) => {
  const posted: string[][] = [];
  server.use(
    http.get("*/api/v1/protein_structure/models/:gene", () =>
      HttpResponse.json(models, { headers: { "X-Dataset-Version": "2026-11-12" } }),
    ),
    http.get("*/api/v1/protein_structure/residues/:gene", () => tsv([RESIDUE_HEADER, ...residues])),
    http.get("*/api/v1/protein_structure/features/:gene", () =>
      tsv([
        "accession\tsource\tfeature_type\tstart\tend\tdescription\tevidence_tier",
        "P1\tuniprot\tDomain\t2\t6\tEF-hand\tcurated",
        "P1\tted\tTED domain\t1\t9\tTED01\tpredicted",
      ]),
    ),
    http.get("*/api/v1/credible_sets_by_gene/:gene", () =>
      HttpResponse.json(credibleSets),
    ),
    http.get("*/api/v1/exome_results_by_gene/:gene", () =>
      tsv([
        "dataset\tchr\tpos\tref\talt\tgene\tannotation\tmlog10p\ttrait",
        "genebass\t1\t104\tC\tT\tGENE1\tmissense\t6.1\tHDL",
        "genebass\t1\t105\tC\tT\tGENE1\tpLoF\t9.0\tHDL",
      ]),
    ),
    http.post("*/api/v1/variant_annotation/protein", async ({ request }) => {
      posted.push(((await request.json()) as { variants: string[] }).variants);
      return HttpResponse.json(mapRows);
    }),
  );
  return posted;
};

const ONE_FILE: Served = {
  models: [modelRow({})],
  residues: Array.from({ length: 10 }, (_, i) => residueLine("P1", "AF-P1-F1-model_v6", i + 1, i + 1, true)),
  mapRows: [mapRow("1:101:G:A", 4), mapRow("1:104:C:T", 7)],
};

// two windows over ten residues: F1 holds 1-7 and owns 1-5, F2 holds 4-10 and owns 6-10
const TWO_FILES: Served = {
  models: [
    modelRow({ model_file_id: "F1", n_windows: 2, protein_end: 7, owned_end: 5 }),
    modelRow({ model_file_id: "F2", window_index: 2, n_windows: 2, protein_start: 4, owned_start: 6 }),
  ],
  residues: [
    ...[1, 2, 3, 4, 5, 6, 7].map((p) => residueLine("P1", "F1", p, p, p <= 5)),
    ...[4, 5, 6, 7, 8, 9, 10].map((p) => residueLine("P1", "F2", p - 3, p, p >= 6)),
  ],
  mapRows: [mapRow("1:101:G:A", 4, "F1", 4), mapRow("1:104:C:T", 8, "F2", 5)],
};

const lastProps = () => viewer.mock.lastCall?.[0] as {
  spec: { modelFileId: string; accession: string; gene: string };
  live: { positions: number[]; focus: boolean };
  onResidue: (kind: "hover" | "click", filePosition: number | null) => void;
};

describe("ProteinSection", () => {
  it("renders nothing where the deployment serves no protein-structure routes", async () => {
    // the default handler answers as FastAPI does for a route that is not registered
    const { container } = render(<ProteinSection geneName="GENE1" />, { wrapper });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("says the data is not yet available while no release is loaded", async () => {
    server.use(
      http.get("*/api/v1/protein_structure/models/:gene", () =>
        HttpResponse.json({ detail: "no release loaded" }, { status: 503 }),
      ),
    );
    render(<ProteinSection geneName="GENE1" />, { wrapper });
    expect(await screen.findByText("protein structure data is not yet available")).toBeInTheDocument();
    expect(screen.getByText("Protein structure and variants")).toBeInTheDocument();
  });

  it("says so when the release holds no model for the gene", async () => {
    server.use(
      http.get("*/api/v1/protein_structure/models/:gene", () =>
        HttpResponse.json({ detail: "No model file is listed under gene GENE1 in release r" }, { status: 404 }),
      ),
    );
    render(<ProteinSection geneName="GENE1" />, { wrapper });
    expect(await screen.findByText("no predicted structure for this gene")).toBeInTheDocument();
  });

  it("shows another failure as an error", async () => {
    server.use(http.get("*/api/v1/protein_structure/models/:gene", () => HttpResponse.json({}, { status: 500 })));
    render(<ProteinSection geneName="GENE1" />, { wrapper });
    // the hook retries a failure that is not one of the two deployment answers, with backoff
    expect(await screen.findByText(/failed to load/, {}, { timeout: 10_000 })).toBeInTheDocument();
  });

  it("draws the track, places variants by the map and says how many it has no row for", async () => {
    const posted = serve(ONE_FILE);
    render(<ProteinSection geneName="GENE1" />, { wrapper });

    const variants = await screen.findAllByTestId("protein-variant");
    // the page's own missense calls go to the map; the intron and pLoF variants never do
    expect(posted).toEqual([["1:101:G:A", "1:103:G:A", "1:104:C:T"]]);
    expect(variants.map((v) => v.getAttribute("aria-label"))).toEqual(["p.A4T 1:101:G:A", "p.A7T 1:104:C:T"]);
    expect(within(screen.getByTestId("protein-track-variants-cs")).getAllByTestId("protein-variant")).toHaveLength(1);
    expect(screen.getByTestId("protein-variant-note")).toHaveTextContent(
      "2 missense variants placed by residue. 1 of 3 variants have no served protein row.",
    );
    // the claim behind the short sentence, no stronger than the API's own
    await userEvent.hover(screen.getByTestId("protein-no-row"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Either the variant is not a missense change on the canonical UniProt isoform under the release's annotation, or it is on a protein this deployment does not serve.",
    );
    expect(screen.getByTestId("protein-set-filters")).toHaveTextContent(
      "lead p ≤ 1e-10, at most 50 variants, QTL sets only for GENE1 itself), from every resource whatever that tab's resource switches say",
    );
    // least confident first, as the viewer's legend has it; ten residues need no binning
    expect(screen.getByTestId("protein-track-legend")).toHaveTextContent(
      /model confidence \(pLDDT\)very low.*low.*confident.*very high/,
    );
    expect(screen.getByTestId("protein-identity")).toHaveTextContent("UniProt P1 · 10 residues");
    expect(screen.getByText("release 2026-11-12")).toBeInTheDocument();
    expect(screen.getAllByTestId("protein-track-features")).toHaveLength(2);
    expect(screen.getByTestId("protein-track-plddt").querySelectorAll("rect").length).toBeGreaterThan(0);
    // one model file: nothing to choose between
    expect(screen.queryByTestId("protein-window-control")).toBeNull();
    expect(lastProps().spec).toMatchObject({ modelFileId: "AF-P1-F1-model_v6", accession: "P1", gene: "GENE1" });
    expect(lastProps().live).toEqual({ positions: [], focus: false });
  });

  it("highlights a selected variant's residue on the structure and marks it on the track", async () => {
    serve(ONE_FILE);
    render(<ProteinSection geneName="GENE1" />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: "p.A7T 1:104:C:T" }));
    expect(lastProps().live).toEqual({ positions: [7], focus: true });
    expect(screen.getByTestId("protein-selection")).toHaveTextContent("selected p.A7T (1:104:C:T)");
    expect(screen.getByTestId("protein-track-selection")).toHaveAttribute("data-start", "7");

    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(lastProps().live).toEqual({ positions: [], focus: false });
  });

  it("marks a residue hovered on the structure and selects a clicked one without asking for the camera", async () => {
    serve(ONE_FILE);
    render(<ProteinSection geneName="GENE1" />, { wrapper });
    await screen.findAllByTestId("protein-variant");
    const spec = lastProps().spec;

    act(() => lastProps().onResidue("hover", 3));
    expect(await screen.findByTestId("protein-track-marker")).toHaveAttribute("data-position", "3");
    expect(screen.getByTestId("protein-structure-pointer")).toHaveTextContent("A3");
    act(() => lastProps().onResidue("hover", null));
    await waitFor(() => expect(screen.queryByTestId("protein-track-marker")).toBeNull());

    act(() => lastProps().onResidue("click", 9));
    await waitFor(() => expect(lastProps().live).toEqual({ positions: [9], focus: false }));
    expect(screen.getByTestId("protein-selection")).toHaveTextContent("selected residue A9");
    // the same spec object throughout: a new one would rebuild the scene
    expect(lastProps().spec).toBe(spec);
  });

  it("selects a brushed range", async () => {
    serve(ONE_FILE);
    render(<ProteinSection geneName="GENE1" />, { wrapper });
    await screen.findAllByTestId("protein-variant");
    // jsdom lays nothing out, so the track is at its default width with its left edge at 0:
    // 150 px of labels, then ten residues over 738 px
    const brush = screen.getByTestId("protein-track-brush");
    fireEvent.mouseDown(brush, { clientX: 150 + 73.8 * 2.5 });
    fireEvent.mouseMove(screen.getByTestId("protein-track"), { clientX: 150 + 73.8 * 5.5 });
    fireEvent.mouseUp(screen.getByTestId("protein-track"), { clientX: 150 + 73.8 * 5.5 });
    expect(screen.getByTestId("protein-selection")).toHaveTextContent("selected residues 3–6");
    expect(lastProps().live).toEqual({ positions: [3, 4, 5, 6], focus: true });

    fireEvent.click(screen.getByRole("button", { name: "zoom to selection" }));
    expect(screen.getByRole("button", { name: "show whole protein" })).toBeInTheDocument();
    // the variant at residue 7 is outside the zoomed stretch
    expect(screen.getAllByTestId("protein-variant").map((v) => v.getAttribute("data-variant"))).toEqual(["1:101:G:A"]);
  });

  it("merges variants at one residue into one marker that selects all of them", async () => {
    serve({ ...ONE_FILE, mapRows: [mapRow("1:101:G:A", 4), mapRow("1:103:G:A", 4), mapRow("1:104:C:T", 7)] });
    render(<ProteinSection geneName="GENE1" />, { wrapper });
    const merged = await screen.findByRole("button", {
      name: "2 variants at residue 4: p.A4T 1:101:G:A, p.A4T 1:103:G:A",
    });
    expect(within(screen.getByTestId("protein-track-variants-cs")).getAllByTestId("protein-variant")).toHaveLength(1);
    expect(merged).toHaveTextContent("2");
    fireEvent.click(merged);
    expect(merged).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("protein-selection")).toHaveTextContent(
      "selected p.A4T (1:101:G:A), p.A4T (1:103:G:A)",
    );
    expect(screen.getAllByTestId("protein-selected-notes")).toHaveLength(2);
    expect(lastProps().live).toEqual({ positions: [4], focus: true });
  });

  it("gives a variant row one tab stop and moves between its markers with the arrow keys", async () => {
    serve({
      ...ONE_FILE,
      credibleSets: [csRow(101, "missense_variant"), csRow(103, "missense_variant"), csRow(107, "missense_variant")],
      mapRows: [mapRow("1:101:G:A", 2), mapRow("1:103:G:A", 5), mapRow("1:107:G:A", 7)],
    });
    render(<ProteinSection geneName="GENE1" />, { wrapper });
    await screen.findAllByTestId("protein-variant");
    const row = within(screen.getByTestId("protein-track-variants-cs")).getAllByTestId("protein-variant");
    expect(row.map((m) => m.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);

    act(() => row[0].focus());
    fireEvent.keyDown(row[0], { key: "ArrowRight" });
    expect(row[1]).toHaveFocus();
    expect(row.map((m) => m.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    fireEvent.keyDown(row[1], { key: "End" });
    expect(row[2]).toHaveFocus();
    fireEvent.keyDown(row[2], { key: "ArrowRight" });
    expect(row[2]).toHaveFocus();
    fireEvent.keyDown(row[2], { key: "Home" });
    expect(row[0]).toHaveFocus();

    fireEvent.keyDown(row[0], { key: "Enter" });
    expect(screen.getByTestId("protein-selection")).toHaveTextContent("selected p.A2T (1:101:G:A)");
    // the marker itself stays the legend's circle: selection and focus are rings around it
    expect(row[0].querySelectorAll("circle")).toHaveLength(2);
    expect(row[0].style.outline).toBe("none");
  });

  it("drops the sets the credible-set tab would not show, and marks a pseudo credible set", async () => {
    const posted = serve({
      ...ONE_FILE,
      credibleSets: [
        // the FinnGen + MVP + UKBB + AoU meta-analysis has pseudo credible sets in the datasets fixture
        csRow(101, "missense_variant", { resource: "finngen_mvp_ukbb_aou", dataset: "FinnGen_R14_MVP_UKBB_AOU", cs_id: "meta_1" }),
        csRow(103, "missense_variant", { mlog10p: 4, cs_id: "weak_1" }),
        csRow(106, "missense_variant", { data_type: "eQTL", trait: "OTHER", resource: "eqtl_catalogue", dataset: "QTD1", trait_original: "x|ge", cs_id: "e_1" }),
      ],
    });
    render(<ProteinSection geneName="gene1" />, { wrapper });
    const marker = await screen.findByRole("button", { name: "p.A4T 1:101:G:A" });
    // the weak-lead set's and the other gene's eQTL set's variants are never candidates
    expect(posted).toEqual([["1:101:G:A", "1:104:C:T"]]);
    await waitFor(() => expect(marker).toHaveTextContent("*"));
    fireEvent.click(marker);
    const notes = screen.getByTestId("protein-selected-notes");
    expect(notes).toHaveTextContent("in 1 pseudo credible set*, highest PIP* 0.50");
    expect(screen.getByTestId("protein-track-legend")).toHaveTextContent("* pseudo credible set");
  });

  describe("before the section is scrolled to", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("asks only for the models, and for the rest once it is near the viewport", async () => {
      const seen: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
            seen.push(callback);
          }
          observe() {}
          disconnect() {}
        },
      );
      serve(ONE_FILE);
      const requested: string[] = [];
      const record = ({ request }: { request: Request }) => requested.push(new URL(request.url).pathname);
      server.events.on("request:start", record);
      try {
        viewer.mockClear();
        render(<ProteinSection geneName="GENE1" />, { wrapper });
        expect(await screen.findByTestId("protein-deferred")).toBeInTheDocument();
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(requested).toEqual(["/api/v1/protein_structure/models/GENE1"]);
        expect(viewer).not.toHaveBeenCalled();

        act(() => seen.forEach((callback) => callback([{ isIntersecting: true }])));
        await screen.findAllByTestId("protein-variant", {}, { timeout: 5000 });
        expect(requested).toEqual(
          expect.arrayContaining([
            "/api/v1/protein_structure/residues/GENE1",
            "/api/v1/protein_structure/features/GENE1",
            "/api/v1/exome_results_by_gene/GENE1",
            "/api/v1/variant_annotation/protein",
          ]),
        );
      } finally {
        server.events.removeListener("request:start", record);
      }
    });
  });

  describe("a protein split across model files", () => {
    it("shows the window that owns the selected residue, in that file's numbering", async () => {
      serve(TWO_FILES);
      render(<ProteinSection geneName="GENE1" />, { wrapper });
      await screen.findAllByTestId("protein-variant");
      expect(lastProps().spec.modelFileId).toBe("F1");
      const control = screen.getByTestId("protein-window-control");
      expect(control).toHaveTextContent("showing window 1 of 2: residues 1–7");
      expect(control).toHaveTextContent("Distances between residues in different windows are not defined");

      // protein position 8 is file position 5 of the second file
      fireEvent.click(screen.getByRole("button", { name: "p.A8T 1:104:C:T" }));
      expect(lastProps().spec.modelFileId).toBe("F2");
      expect(lastProps().live).toEqual({ positions: [5], focus: true });
      expect(control).toHaveTextContent("showing window 2 of 2: residues 4–10");

      // and back from the structure: file position 2 of the second file is protein position 5
      act(() => lastProps().onResidue("hover", 2));
      expect(await screen.findByTestId("protein-track-marker")).toHaveAttribute("data-position", "5");
    });

    it("says how much of a selection the shown window does not hold", async () => {
      serve(TWO_FILES);
      render(<ProteinSection geneName="GENE1" />, { wrapper });
      await screen.findAllByTestId("protein-variant");
      fireEvent.click(screen.getByRole("button", { name: "p.A8T 1:104:C:T" }));
      // choosing the first window by hand keeps the selection; residue 8 is not in that file
      fireEvent.click(within(screen.getByTestId("protein-window-control")).getByRole("button", { name: "1" }));
      expect(lastProps().spec.modelFileId).toBe("F1");
      expect(lastProps().live.positions).toEqual([]);
      expect(screen.getByTestId("protein-outside-note")).toHaveTextContent(
        "1 of the 1 selected residues are outside the model shown",
      );
    });
  });

  it("names the other genes an accession is the product of", async () => {
    serve({ ...ONE_FILE, models: [modelRow({ gene_name: "GENE2,GENE1" })] });
    render(<ProteinSection geneName="GENE1" />, { wrapper });
    expect(await screen.findByText(/P1 is the product of GENE1 and GENE2/)).toBeInTheDocument();
  });

  it("does not list the page's own gene as another gene when the cases differ", async () => {
    serve({ ...ONE_FILE, models: [modelRow({ gene_name: "GENE2,GENE1" })] });
    render(<ProteinSection geneName="gene1" />, { wrapper });
    expect(await screen.findByText(/P1 is the product of gene1 and GENE2:/)).toBeInTheDocument();
    // and the page's variants are still found under the differently cased name
    expect(await screen.findAllByTestId("protein-variant")).toHaveLength(2);
  });

  it("shows one accession at a time for a gene with several, and says which", async () => {
    serve({
      models: [modelRow({}), modelRow({ model_file_id: "AF-P2-F1-model_v6", accession: "P2", protein_end: 4, owned_end: 4 })],
      residues: [
        ...ONE_FILE.residues,
        ...[1, 2, 3, 4].map((p) => residueLine("P2", "AF-P2-F1-model_v6", p, p, true)),
      ],
      mapRows: [
        mapRow("1:101:G:A", 4),
        mapRow("1:104:C:T", 2, "AF-P2-F1-model_v6", 2, "P2"),
        // an accession the release does not list under GENE1
        mapRow("1:103:G:A", 9, "AF-Q9-F1-model_v6", 9, "Q9", "GENE9"),
      ],
    });
    render(<ProteinSection geneName="GENE1" />, { wrapper });
    await screen.findAllByTestId("protein-variant");
    expect(screen.getByText(/GENE1 has 2 UniProt accessions in this release/)).toBeInTheDocument();
    expect(screen.getByTestId("protein-identity")).toHaveTextContent("UniProt P1 · 10 residues");
    expect(screen.getByTestId("protein-variant-note")).toHaveTextContent(
      "1 missense variant placed by residue. 1 of 3 are placed on another accession of GENE1, not on P1. 1 of 3 are placed only on another gene's protein (GENE9).",
    );

    fireEvent.click(screen.getByRole("button", { name: "P2" }));
    expect(screen.getByTestId("protein-identity")).toHaveTextContent("UniProt P2 · 4 residues");
    expect(lastProps().spec.modelFileId).toBe("AF-P2-F1-model_v6");
    expect(screen.getAllByTestId("protein-variant").map((v) => v.getAttribute("aria-label"))).toEqual(["p.A2T 1:104:C:T"]);
  });
});
