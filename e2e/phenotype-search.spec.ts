import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// live verification of the phenotype-search view (.24) at /annotate/phenotype-search.
// requires the full dev stack: genetics-results-api :2000, BFF :5000, vite :3000.
//
// (a) handoff path: from /annotate, submit a variant, open the Phenotype summary tab, click a trait's
//     search-handoff button, confirm it lands on /annotate/phenotype-search with that phenotype
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

  // landed on the new route with a phenotype preselected and run
  await expect(page).toHaveURL(/\/annotate\/phenotype-search\?resource=.+&trait=.+/, {
    timeout: 15_000,
  });
  await expect(page.getByText(/Showing/i)).toBeVisible({ timeout: 15_000 });
  // the per-variant summary-stats table populated for the input variant
  await expect(page.getByText("19:44908684:T:C").first()).toBeVisible({ timeout: 20_000 });
  // the inCredibleSet flag column is present (yes/PIP chip per variant)
  await expect(page.getByText("in credible set")).toBeVisible();
  await snapshot(page, "phenotype-search-handoff");
});

test("phenotype-search: in-view search box (alzheimer -> AD_LO_EXMORE)", async ({ page }) => {
  // the store is in-memory: a hard navigation to /annotate/phenotype-search loses the input variants
  // (the view then shows its graceful "start from /annotate" fallback — verified separately). reach
  // the view via the client-side handoff so the input variants survive, then drive the search box.
  await page.goto("/annotate");
  await page.getByLabel(/Paste GRCh38 variant ids/i).fill("19-44908684-T-C");
  await page.getByRole("button", { name: /annotate/i }).click();
  await expect(page.getByText("19:44908684:T:C").first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: /phenotype summary/i }).click();
  const handoff = page.getByRole("button", { name: /full summary-stat results/i }).first();
  await expect(handoff).toBeVisible({ timeout: 15_000 });
  await handoff.click();

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
