import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// live verification of the new Gene evidence tab (refactor.md §6): navigate to /gene/APOE, switch to
// the second tab, and confirm the gene burden, expression, mendelian and annotation sub-tabs render real data
// from the new genetics-results-api via the BFF.
test("gene evidence tab shows burden, expression, gene-disease and annotation for APOE", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/gene/APOE");

  // wait for the CS view (first tab) to finish loading so the tab strip is present
  await expect(page.getByText("Loading...")).toBeHidden({ timeout: 90000 });

  await page.getByRole("tab", { name: "Gene evidence" }).click();

  // the evidence sub-tab is remembered per browser; a fresh context opens on gene burden. scope to a
  // table CELL via role: the Credible sets tab stays mounted (display:none) and its DOM holds an
  // "Apolipoprotein" gene tooltip, so a plain getByText would match that hidden copy. display:none
  // cells are out of the a11y tree, so getByRole("cell") only resolves the visible evidence tables.
  await expect(page.getByRole("tab", { name: "gene burden" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.getByRole("cell", { name: /Apolipoprotein/i }).first()).toBeVisible({
    timeout: 90000,
  });
  await page.getByRole("button", { name: "plot", exact: true }).click();
  await expect(page.getByTestId("gene-burden-plot").locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "table", exact: true }).click();

  // expression: GTEx renders as the bar plot by default, and switching to the table shows the top
  // GTEx tissue for APOE (Adrenal Gland) sorted first
  await page.getByRole("tab", { name: "expression" }).click();
  await expect(page.getByRole("heading", { name: /Expression \(GTEx/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Expression (Human Protein Atlas)" })
  ).toBeVisible();
  await expect(page.getByTestId("gtex-expression-plot").locator("canvas")).toBeVisible({
    timeout: 90000,
  });
  await page.getByRole("button", { name: "table", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Adrenal Gland" }).first()).toBeVisible({
    timeout: 90000,
  });
  await page.getByRole("button", { name: "plot", exact: true }).click();

  // mendelian: a gene-disease title (e.g. hyperlipoproteinemia)
  await page.getByRole("tab", { name: "mendelian" }).click();
  await expect(page.getByRole("cell", { name: /hyperlipoproteinemia/i }).first()).toBeVisible({
    timeout: 90000,
  });

  // annotation: the canonical transcript, the mygene.info summary and the outbound links
  await page.getByRole("tab", { name: "annotation" }).click();
  await expect(page.getByTestId("gene-model")).toContainText("4 exons", { timeout: 90000 });
  await expect(page.getByText("Gene ontology", { exact: true })).toBeVisible({ timeout: 90000 });
  await expect(page.getByText("LOEUF")).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole("link", { name: "ClinGen" })).toHaveAttribute(
    "href",
    "https://search.clinicalgenome.org/kb/genes/HGNC:613"
  );
  await expect(page.getByRole("link", { name: "UniProt" })).toHaveAttribute(
    "href",
    "https://www.uniprot.org/uniprotkb/P02649/entry"
  );

  // variant association: APOE's missense variants sit in many GWAS credible sets. the table opens
  // on the sets with a variant in the gene, under a track of every credible-set variant of the locus
  await page.getByRole("tab", { name: "variant association" }).click();
  const rows = page.getByTestId("assoc-row");
  await expect(rows.first()).toContainText("missense", { timeout: 90000 });
  const tracks = page.getByTestId("assoc-tracks");
  const rowCount = page.getByTestId("assoc-row-count");
  // the padded region has replaced the gene body once the note about it has gone
  await expect(page.getByText("loading the surroundings")).toHaveCount(0, { timeout: 90000 });
  const inGene = await rowCount.textContent();

  // a row opens to every variant of its credible set. the strongest sets are of one variant and
  // have nothing to open, so the largest come first for this
  await page.getByRole("columnheader", { name: /^variants/ }).click();
  const opening = page.locator('[data-testid="assoc-row"]:not(.single)').first();
  await opening.click();
  await expect(page.getByTestId("assoc-members")).toContainText(
    /\d+ (coding |non-coding )?variants? in this credible set/
  );
  // after the heading and the column names
  await expect(page.getByTestId("assoc-members").getByRole("row").nth(2)).toContainText("19:4");
  await opening.click();
  await expect(page.getByTestId("assoc-members")).toHaveCount(0);

  // the pointer is described in the fixed line below the tracks, never in a tooltip
  // a point of the tracks, read each time: anything that scrolls the page moves them
  const at = async (share: number, y: number): Promise<[number, number]> => {
    const box = (await tracks.boundingBox())!;
    return [box.x + box.width * share, box.y + y];
  };
  await page.mouse.move(...(await at(0.5, 168)));
  await expect(page.getByTestId("assoc-readout")).toContainText("APOE · chr19:");
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  // asking for a kind of variant leaves the sets that have one, and takes nothing off the track
  const viewCount = page.getByTestId("assoc-view-count");
  await expect(viewCount).toHaveText(/^[\d,]+ variants in view$/);
  await page.getByRole("radio", { name: /with a LoF variant PIP/ }).click();
  await expect(rowCount).not.toHaveText(inGene!);
  await expect(viewCount).toContainText("in credible sets that pass the filters");
  await page.getByRole("radio", { name: "credible sets with any variant" }).click();
  await expect(rowCount).toHaveText(inGene!);

  // a drag selects a region, and the table lists the credible sets with a variant in it
  await page.mouse.move(...(await at(0.2, 60)));
  await page.mouse.down();
  await page.mouse.move(...(await at(0.25, 60)), { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId("assoc-selection")).toContainText("chr19:");
  await expect(rowCount).not.toHaveText(inGene!);
  await page.getByTestId("assoc-selection").getByTestId("CancelIcon").click();
  await expect(rowCount).toHaveText(inGene!);

  // ctrl + wheel zooms the tracks, and the table follows the view; a plain wheel is left to the page
  await page.mouse.wheel(0, 100);
  await expect(page.getByRole("button", { name: "reset zoom" })).toBeDisabled();
  await page.mouse.move(...(await at(0.5, 60)));
  await page.keyboard.down("Control");
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 100);
  }
  await page.keyboard.up("Control");
  await expect(page.getByRole("button", { name: "reset zoom" })).toBeEnabled();
  await expect(rowCount).not.toHaveText(inGene!);

  await page.getByRole("radio", { name: "only pseudo credible sets" }).click();
  await expect(rows.first()).toContainText("pseudo");
  await expect(page.getByRole("cell", { name: "SuSiE" })).toHaveCount(0);

  const file = await snapshot(page, "gene-APOE-evidence");
  expect(file).toContain("gene-APOE-evidence");

  expect(pageErrors).toEqual([]);
});
