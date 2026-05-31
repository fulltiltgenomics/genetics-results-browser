import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// live verification of the migrated variant-results tab at /annotate (refactor.md §4).
// requires the full dev stack: genetics-results-api :2000, BFF :5000, vite :3000. submits a known
// variant, waits for the credible-set main table, expands a row, and screenshots the CS detail.
test("annotate route renders credible-set data", async ({ page }) => {
  await page.goto("/annotate");

  // type a known variant (APOE rs429358) into the input and submit
  const input = page.getByLabel(/Paste GRCh38 variant ids/i);
  await input.fill("19-44908684-T-C");
  await page.getByRole("button", { name: /annotate/i }).click();

  // the main table renders the variant row once stage-1 BFF data + stage-2 filtering complete
  await expect(page.getByText("19:44908684:T:C")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("rs429358")).toBeVisible();

  await snapshot(page, "annotate-main-table");

  // expand the row to reveal the single credible-set detail table (no Association results)
  await page.getByLabel("Expand").first().click();
  await expect(page.getByText(/Credible sets \/ fine-mapping results/i)).toBeVisible({
    timeout: 15_000,
  });

  const file = await snapshot(page, "annotate-credible-set-detail");
  expect(file).toContain("annotate-credible-set-detail");
});
