import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// live verification of genetics-results-browser-qjl: finngen caQTL credible sets, previously dropped
// in geneCS.mapToDataName, must now surface in the gene-view plot under the new FinnGen_caQTL bucket
// — a caQTL toggle group with a non-zero count.
test("gene view surfaces finngen caQTL credible sets with their own toggle", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/gene/APOE");
  await expect(page.getByText("Loading...")).toBeHidden({ timeout: 30000 });

  // caQTL is now its own DatasetOptions group (driven by config.gene_view.resources)
  await expect(page.getByText("caQTL", { exact: true }).first()).toBeVisible({ timeout: 30000 });

  // the caQTL toggle is enabled (count > 0) — i.e. rows were grouped, not dropped. the label reads
  // "<count> FinnGen"; assert the switch under the caQTL group is enabled.
  const caqtlToggle = page.locator('input[name="FinnGen_caQTL"]');
  await expect(caqtlToggle).toBeEnabled({ timeout: 30000 });

  const file = await snapshot(page, "gene-APOE-caqtl");
  expect(file).toContain("gene-APOE-caqtl");

  console.log("PAGE ERRORS:", JSON.stringify(pageErrors, null, 2));
  expect(pageErrors).toEqual([]);
});
