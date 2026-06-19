import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// live verification of the phenotype-search TAB (refactor.md §5).
// requires the full dev stack: genetics-results-api :2000, BFF :5000, vite :3000.
//
// (a) handoff path: from /annotate, submit a variant, open the Phenotype summary tab, click a trait's
//     search-handoff button, confirm it switches to the Phenotype search tab with that phenotype
//     preselected and the summary-stats table populated for the input variant(s), incl. the
//     inCredibleSet flag.
// (b) in-view search box: type "alzheimer", pick AD_LO_EXMORE, see the per-variant sumstats table.

test("phenotype-search: handoff from Phenotype summary tab", async ({ page }) => {
  await page.goto("/annotate");

  const input = page.getByLabel(/Paste GRCh38 variant ids/i);
  await input.fill("19-44908684-T-C");
  await page.getByRole("button", { name: /annotate/i }).click();

  await expect(page.getByText("19:44908684:T:C").first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: /phenotype summary/i }).click();
  const handoff = page.getByRole("button", { name: /full summary-stat results/i }).first();
  await expect(handoff).toBeVisible({ timeout: 15_000 });
  await handoff.click();

  // switched to the Phenotype search tab with a phenotype preselected and run (no route change / 404)
  await expect(page.getByText(/Showing/i)).toBeVisible({ timeout: 15_000 });
  // the per-variant summary-stats table populated for the input variant
  await expect(page.getByText("19:44908684:T:C").first()).toBeVisible({ timeout: 20_000 });
  // the inCredibleSet flag column is present (yes/no chip per variant)
  await expect(page.getByText("in credible set")).toBeVisible();
  await snapshot(page, "phenotype-search-handoff");
});

test("phenotype-search: in-view search box (alzheimer -> AD_LO_EXMORE)", async ({ page }) => {
  await page.goto("/annotate");
  await page.getByLabel(/Paste GRCh38 variant ids/i).fill("19-44908684-T-C");
  await page.getByRole("button", { name: /annotate/i }).click();
  await expect(page.getByText("19:44908684:T:C").first()).toBeVisible({ timeout: 30_000 });

  // reach the Phenotype search tab directly (input variants live in the store, no route navigation)
  await page.getByRole("tab", { name: /phenotype search/i }).click();

  const search = page.getByLabel(/search phenotype/i);
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill("alzheimer");

  // pick the late-onset AD option from the autocomplete dropdown
  const option = page.getByRole("option", { name: /AD_LO_EXMORE/i }).first();
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();

  await expect(page.getByText(/Showing/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("19:44908684:T:C").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("in credible set")).toBeVisible();
  await snapshot(page, "phenotype-search-in-view");
});
