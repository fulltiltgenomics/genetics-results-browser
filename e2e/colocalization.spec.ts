import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// per-credible-set colocalization in the expanded variant detail (bd .23, refactor.md §4).
// requires the full dev stack: genetics-results-api :2000, BFF :5000, vite :3000.
// flow: submit the APOE variant, expand the variant row, expand a GWAS credible-set detail row,
// open its lazy colocalization section, and assert real partner colocalizations render.
const SINGLE = "19-44908684-T-C"; // APOE rs429358 — sits in the AD/dementia GWAS credible sets

test("expanded credible set lazily loads its colocalizations", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/annotate");
  await page.getByLabel(/Paste GRCh38 variant ids/i).fill(SINGLE);
  await page.getByRole("button", { name: /annotate/i }).click();

  // main table row
  await expect(page.getByText("19:44908684:T:C", { exact: true })).toBeVisible({ timeout: 30_000 });

  // expand the variant row -> credible-set detail table
  await page.getByLabel("Expand").first().click();
  await expect(page.getByText(/Credible sets \/ fine-mapping results/i)).toBeVisible({
    timeout: 15_000,
  });

  // narrow the (large) inner detail table to the late-onset Alzheimer's APOE-region GWAS credible
  // set. the trait column shows the resolved phenostring (not the phenocode), so filter by the
  // human-readable substring "Late onset" (matches "Alzheimer's disease (Late onset) …").
  const innerTraitFilter = page.getByPlaceholder("trait").last();
  await innerTraitFilter.fill("Late onset");
  await page.waitForTimeout(500);

  // the inner detail table carries its own expand column (the coloc panel). after the outer row is
  // open its button reads "Collapse", so the remaining "Expand" buttons are inner CS rows. expand
  // the (now single) CS row to reveal its colocalization affordance.
  const innerExpand = page.getByRole("button", { name: "Expand" }).last();
  await innerExpand.click();

  // open the lazy coloc fetch for that credible set
  const showBtn = page.getByRole("button", { name: /show colocalization data/i }).first();
  await expect(showBtn).toBeVisible({ timeout: 15_000 });
  await showBtn.click();

  // partner colocalizations load from the live API: the section header, the loading spinner
  // resolving to a populated table (real PP.H4 values), and the "<n> colocalizations" count line.
  await expect(page.getByText(/What this signal colocalizes with/i).first()).toBeVisible();
  await expect(page.getByText(/loading colocalizations/i)).toHaveCount(0, { timeout: 20_000 });
  // count line ("<n> colocalizations") + the PP.H4 partner-table column header
  await expect(page.getByText(/\d+ colocalizations?/i).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("PP.H4").first()).toBeVisible();

  await snapshot(page, "verify-13-colocalization-loaded");
});
