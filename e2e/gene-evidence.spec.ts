import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// live verification of the new Gene evidence tab (refactor.md §6): navigate to /gene/APOE, switch to
// the second tab, and confirm the three evidence sections (gene burden, expression, gene-disease)
// render real data from the new genetics-results-api via the BFF.
test("gene evidence tab shows burden, expression and gene-disease for APOE", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/gene/APOE");

  // wait for the CS view (first tab) to finish loading so the tab strip is present
  await expect(page.getByText("Loading...")).toBeHidden({ timeout: 30000 });

  await page.getByRole("tab", { name: "Gene evidence" }).click();

  // section headers present
  await expect(page.getByRole("heading", { name: "Gene burden" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Expression" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gene-disease (Mendelian)" })).toBeVisible();

  // burden: a real APOE burden trait from gene_based. scope to a table CELL via role: the Credible
  // sets tab stays mounted (display:none) and its DOM holds an "Apolipoprotein" gene tooltip, so a
  // plain getByText would match that hidden copy. display:none cells are out of the a11y tree, so
  // getByRole("cell") only resolves the visible evidence tables.
  await expect(page.getByRole("cell", { name: /Apolipoprotein/i }).first()).toBeVisible({
    timeout: 30000,
  });
  // expression: the top GTEx tissue for APOE (adrenal_gland), sorted to the top of the table
  await expect(page.getByRole("cell", { name: "adrenal_gland" }).first()).toBeVisible({
    timeout: 30000,
  });
  // gene-disease: a Mendelian disease title (e.g. hyperlipoproteinemia)
  await expect(page.getByRole("cell", { name: /hyperlipoproteinemia/i }).first()).toBeVisible({
    timeout: 30000,
  });

  const file = await snapshot(page, "gene-APOE-evidence");
  expect(file).toContain("gene-APOE-evidence");

  expect(pageErrors).toEqual([]);
});
