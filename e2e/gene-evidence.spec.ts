import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// live verification of the new Gene evidence tab (refactor.md §6): navigate to /gene/APOE, switch to
// the second tab, and confirm the gene burden, expression, mendelian and annotation sub-tabs render real data
// from the new genetics-results-api via the BFF.
test("gene evidence tab shows burden, expression, gene-disease and annotation for APOE", async ({ page }) => {
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

  const file = await snapshot(page, "gene-APOE-evidence");
  expect(file).toContain("gene-APOE-evidence");

  expect(pageErrors).toEqual([]);
});
