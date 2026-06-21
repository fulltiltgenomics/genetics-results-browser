import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// verifies the enriched colocalization partner display (bd genetics-results-browser-002):
//   - QTL partners show gene symbol + a quant-level chip (non-ge eQTL) + tissue/cell
//   - GWAS partners show resolved phenostrings (from /v1/trait_name_mapping), not bare phenocodes
// requires the full dev stack: genetics-results-api :2000, BFF :5000, vite :3000.
// the late-onset Alzheimer's (AD_LO_EXMORE) APOE-region credible set has a rich partner mix: eQTL
// CLASRP (|exon, brain_(DLPFC)), pQTL/metaboQTL, and many GWAS partners.
const SINGLE = "19-44908684-T-C"; // APOE rs429358

test("enriched coloc rows show quant level, tissue, and GWAS phenostrings", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/annotate");
  await page.getByLabel(/Paste GRCh38 variant ids/i).fill(SINGLE);
  await page.getByRole("button", { name: /annotate/i }).click();

  await expect(page.getByText("19:44908684:T:C", { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("Expand").first().click();
  await expect(page.getByText(/Credible sets \/ fine-mapping results/i)).toBeVisible({
    timeout: 15_000,
  });

  // narrow the inner detail table to the GWAS credible set with the rich partner mix. the trait
  // column shows the resolved phenostring, so filter by the human-readable substring "Late onset".
  const innerTraitFilter = page.getByPlaceholder("trait").last();
  await innerTraitFilter.fill("Late onset");
  await page.waitForTimeout(500);

  const innerExpand = page.getByRole("button", { name: "Expand" }).last();
  await innerExpand.click();

  const showBtn = page.getByRole("button", { name: /show colocalization data/i }).first();
  await expect(showBtn).toBeVisible({ timeout: 15_000 });
  await showBtn.click();

  await expect(page.getByText(/loading colocalizations/i)).toHaveCount(0, { timeout: 25_000 });
  await expect(page.getByText(/\d+ colocalizations?/i).first()).toBeVisible({
    timeout: 15_000,
  });

  // eQTL partner CLASRP carries a non-ge quant level -> gene symbol + "exon" chip + tissue.
  await expect(page.getByText("CLASRP").first()).toBeVisible();
  await expect(page.getByText("exon", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/brain_\(DLPFC\)/i).first()).toBeVisible();

  // a GWAS partner phenocode should resolve to a human phenostring (Alzheimer's, dementia, etc.).
  // at least one resolved name (lowercased "disease"/"dementia") proves the mapping lookup worked.
  await expect(page.getByText(/disease|dementia|heart/i).first()).toBeVisible({ timeout: 10_000 });

  await snapshot(page, "verify-coloc-enriched");
});
