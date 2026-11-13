import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { ORIGIN, serve, type ApiMock, type Harness } from "./helpers/structureHarness";

/**
 * The gene page's protein section against the PRODUCTION bundle under the production policy
 * (helpers/structureHarness.ts), for the same reason as structure-view.spec.ts: the section
 * drives Mol*, and only the built bundle under that policy shows what a cluster would.
 *
 *   npx vite build --mode prod && npx playwright test e2e/protein-section.spec.ts
 *
 * fixtures/protein-section holds real results-api responses for APOC3 from one protein
 * structure release. The credible-set response is cut down to the gene's own rows (its
 * missense variant and six others); the rest are whole.
 */

const GENE = "APOC3";
const MODEL_FILE_ID = "AF-P02656-F1-model_v6";
const FIXTURES = path.join(__dirname, "fixtures");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, "protein-section", name), "utf8");
// real AlphaFold DB bytes; see the ATTRIBUTION file beside it
const MODELS = { [MODEL_FILE_ID]: gunzipSync(readFileSync(path.join(FIXTURES, `${MODEL_FILE_ID}.pdb.gz`))) };

const TSV = "text/tab-separated-values";
const JSON_TYPE = "application/json";
const RELEASE = { "x-dataset-version": "2026-11-12-175342" };

const served = (posted: string[][]): ApiMock => (pathname, request) => {
  switch (pathname) {
    case `/api/v1/protein_structure/models/${GENE}`:
      return { contentType: JSON_TYPE, body: fixture(`models.${GENE}.json`), headers: RELEASE };
    case `/api/v1/protein_structure/residues/${GENE}`:
      return { contentType: TSV, body: fixture(`residues.${GENE}.tsv`), headers: RELEASE };
    case `/api/v1/protein_structure/features/${GENE}`:
      return { contentType: TSV, body: fixture(`features.${GENE}.tsv`), headers: RELEASE };
    case `/api/v1/credible_sets_by_gene/${GENE}`:
      return { contentType: JSON_TYPE, body: fixture(`credible_sets_by_gene.${GENE}.json`) };
    case `/api/v1/exome_results_by_gene/${GENE}`:
      return { contentType: TSV, body: fixture(`exome_results_by_gene.${GENE}.tsv`) };
    case "/api/v1/variant_annotation/protein":
      posted.push((request.postDataJSON() as { variants: string[] }).variants);
      return { contentType: JSON_TYPE, body: fixture(`variant_annotation_protein.${GENE}.json`) };
    default:
      return undefined;
  }
};

test.use({ viewport: { width: 1280, height: 1400 } });

const openEvidence = async (page: Page, api: ApiMock): Promise<Harness> => {
  const harness = await serve(page, {}, MODELS, api);
  await page.goto(`${ORIGIN}/gene/${GENE}`);
  await page.getByRole("tab", { name: "Gene evidence" }).click();
  return harness;
};

test("the protein track draws and a selected variant is highlighted in the structure", async ({ page }) => {
  const posted: string[][] = [];
  const harness = await openEvidence(page, served(posted));

  const section = page.getByTestId("protein-section");
  await expect(section).toBeVisible({ timeout: 30_000 });
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByTestId("protein-identity")).toContainText("UniProt P02656 · 99 residues");
  await expect(section).toContainText("release 2026-11-12-175342");

  const track = section.getByTestId("protein-track");
  await expect(track).toBeVisible();
  await expect(track.getByTestId("protein-track-plddt").locator("rect").first()).toBeVisible();
  expect(await track.getByTestId("protein-track-features").count()).toBeGreaterThan(1);
  await expect(track).toContainText("TED · TED domain");

  // the page's five missense calls go to the map, which places four: the fifth is an insertion
  await expect(section.getByTestId("protein-variant-note")).toContainText(
    "4 missense variants placed by residue. 1 of 5 variants have no served protein row.",
  );
  await section.getByTestId("protein-no-row").hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "not a missense change on the canonical UniProt isoform under the release's annotation, or it is on a protein this deployment does not serve",
  );
  await expect(section.getByTestId("protein-set-filters")).toContainText("whatever that tab's resource switches say");
  // 99 residues on a track this wide: one strip cell per residue, so no binning to mention
  await expect(section.getByTestId("protein-track-legend")).toContainText(/model confidence \(pLDDT\)very low/);
  expect(posted).toHaveLength(1);
  expect(posted[0]).toHaveLength(5);
  // p.A43T is in a credible set and in the exome results, so it is drawn on both rows
  await expect(track.getByTestId("protein-track-variants-cs").getByTestId("protein-variant")).toHaveCount(1);
  await expect(track.getByTestId("protein-track-variants-exome").getByTestId("protein-variant")).toHaveCount(4);

  const canvas = section.getByTestId("structure-canvas");
  await canvas.scrollIntoViewIfNeeded();
  // software GL in headless chromium is slow to compile Mol*'s shaders
  await expect(canvas).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  await expect(canvas).toHaveAttribute("data-colour-theme", "plddt-confidence");
  await expect(canvas).toHaveAttribute("data-live", "");

  await track
    .getByTestId("protein-track-variants-cs")
    .getByRole("button", { name: "p.A43T 11:116830844:G:A" })
    .click();
  // read back from Mol*'s state tree: the residues the selection component holds
  await expect(canvas).toHaveAttribute("data-live", "43");
  await expect(canvas).toHaveAttribute("data-live-drawn", "atoms");
  await expect(canvas).toHaveAttribute("data-state", "ready");
  await expect(section.getByTestId("protein-selection")).toContainText("selected p.A43T (11:116830844:G:A)");
  await expect(track.getByTestId("protein-track-selection")).toHaveAttribute("data-start", "43");
  expect(harness.molstarChunks()).toHaveLength(1);

  // a brushed region replaces the selection in the same scene. A short one is drawn as atoms
  // and read back residue by residue
  const brush = (await track.getByTestId("protein-track-brush").boundingBox())!;
  const y = brush.y + brush.height - 3;
  const drag = async (from: number, to: number) => {
    await page.mouse.move(brush.x + brush.width * from, y);
    await page.mouse.down();
    await page.mouse.move(brush.x + brush.width * to, y, { steps: 4 });
    await page.mouse.up();
    const selection = track.getByTestId("protein-track-selection");
    return {
      start: Number(await selection.getAttribute("data-start")),
      end: Number(await selection.getAttribute("data-end")),
    };
  };
  const short = await drag(0.1, 0.2);
  expect(short.end - short.start).toBeGreaterThan(5);
  await expect(canvas).toHaveAttribute(
    "data-live",
    Array.from({ length: short.end - short.start + 1 }, (_, i) => short.start + i).join(","),
  );
  await expect(canvas).toHaveAttribute("data-live-drawn", "atoms");

  // past the cap it colours the cartoon over the range instead, and reports a count and range
  const long = await drag(0.1, 0.8);
  const n = long.end - long.start + 1;
  expect(n).toBeGreaterThan(50);
  await expect(canvas).toHaveAttribute("data-live", `${n} residues ${long.start}-${long.end}`);
  await expect(canvas).toHaveAttribute("data-live-drawn", "cartoon");
  await expect(section.getByTestId("structure-legend")).toContainText(
    `the ${n} selected residues are shown by colouring the cartoon; a selection of up to 50 residues is drawn as atoms`,
  );
  await page.waitForTimeout(1500);
  await canvas.screenshot({ path: path.join("e2e", ".output", "screenshots", "protein-section-range.png") });
  expect(harness.molstarChunks()).toHaveLength(1);

  await track
    .getByTestId("protein-track-variants-cs")
    .getByRole("button", { name: "p.A43T 11:116830844:G:A" })
    .click();
  await expect(canvas).toHaveAttribute("data-live", "43");
  // let the camera finish moving to the residue before the frame is saved
  await page.waitForTimeout(2000);
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: process.env.PROTEIN_SECTION_SCREENSHOT ?? path.join("e2e", ".output", "screenshots", "protein-section.png") });

  // and the other way: the camera has just centred on the selected residue, so a click in
  // the middle of the canvas lands on it or on a neighbour, and the track follows. A click is
  // picked synchronously, where a hover waits on an asynchronous pick that software GL is slow at
  const box = (await canvas.boundingBox())!;
  const picked = section.getByTestId("protein-selection");
  for (const [dx, dy] of [[0, 0], [-12, -8], [12, 8], [0, -20], [0, 20]]) {
    await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    await page.waitForTimeout(500);
    if (/selected residue /.test((await picked.textContent()) ?? "")) break;
  }
  await expect(picked).toHaveText(/^selected residue [A-Z]\d+$/);
  const residue = (await picked.textContent())!.match(/\d+$/)![0];
  await expect(track.getByTestId("protein-track-selection")).toHaveAttribute("data-start", residue);
  await expect(canvas).toHaveAttribute("data-live", residue);
  expect(harness.molstarChunks()).toHaveLength(1);

  expect(await harness.violations()).toEqual([]);
  expect(harness.consoleViolations).toEqual([]);
});

test("a section below the fold asks only for the models until it is scrolled to", async ({ page }) => {
  // the other sections of the tab are unmocked and short here, so the section is pushed down
  // to where a page with data would have it
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = '[data-testid="protein-section"]{margin-top:4000px}';
      document.head.appendChild(style);
    });
  });
  const harness = await openEvidence(page, served([]));
  const section = page.getByTestId("protein-section");
  await expect(section.getByTestId("protein-deferred")).toBeAttached({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  const asked = () =>
    harness.requested.filter((p) => /protein_structure|exome_results|variant_annotation|StructureViewer|molstarScene/.test(p));
  expect(asked()).toEqual([`/api/v1/protein_structure/models/${GENE}`]);

  await section.scrollIntoViewIfNeeded();
  await expect(section.getByTestId("protein-track")).toBeVisible();
  expect(asked()).toEqual(
    expect.arrayContaining([
      `/api/v1/protein_structure/residues/${GENE}`,
      `/api/v1/protein_structure/features/${GENE}`,
      `/api/v1/exome_results_by_gene/${GENE}`,
    ]),
  );
});

test("the section is absent where results-api serves no protein-structure routes", async ({ page }) => {
  // FastAPI's own answer for a route that is not registered
  const harness = await openEvidence(page, (pathname) =>
    pathname.startsWith("/api/v1/protein_structure/")
      ? { status: 404, contentType: JSON_TYPE, body: JSON.stringify({ detail: "Not Found" }) }
      : undefined,
  );
  await expect(page.getByText("Gene-disease (Mendelian)")).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => harness.requested.filter((p) => p === `/api/v1/protein_structure/models/${GENE}`).length)
    .toBeGreaterThan(0);
  await expect(page.getByText("Gene burden")).toBeVisible();
  await expect(page.getByTestId("protein-section")).toHaveCount(0);
  await expect(page.getByText("Protein structure and variants")).toHaveCount(0);
  // the probe's answer is the end of it: nothing the section would have gone on to ask for
  await page.waitForTimeout(2000);
  expect(
    harness.requested.filter((p) =>
      /protein_structure\/(residues|features|structure)|exome_results_by_gene|variant_annotation|StructureViewer|molstarScene/.test(p),
    ),
  ).toEqual([]);
  expect(harness.molstarChunks()).toHaveLength(0);
  expect(await harness.violations()).toEqual([]);
  expect(harness.consoleViolations).toEqual([]);
});
