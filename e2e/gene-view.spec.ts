import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// live verification of the migrated gene view: /gene/APOE must render the cis/trans credible-set
// plot (canvas) on the new genetics-results-api, with the gene track visible and no page errors.
test("gene view renders cis credible-set plot on the new API", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/gene/APOE");

  // the loading guard clears once geneInfo + cis + trans + gene track resolve
  await expect(page.getByText("Loading...")).toBeHidden({ timeout: 30000 });

  // CSPlot renders two stacked canvases (gene track + credible-set area)
  const canvases = page.locator("canvas");
  await expect(canvases.first()).toBeVisible({ timeout: 30000 });
  const count = await canvases.count();
  expect(count).toBeGreaterThanOrEqual(2);

  // the resource toggles (DatasetOptions) prove cis rows grouped and mapped to config dataNames
  await expect(page.getByText("GWAS").first()).toBeVisible();

  const file = await snapshot(page, "gene-APOE");
  expect(file).toContain("gene-APOE");

  console.log("CONSOLE ERRORS:", JSON.stringify(consoleErrors, null, 2));
  console.log("PAGE ERRORS:", JSON.stringify(pageErrors, null, 2));
  expect(pageErrors).toEqual([]);
});
