import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// live verification of the three migrated summary tabs (.19/.20/.21) at /annotate.
// requires the full dev stack: genetics-results-api :2000, BFF :5000, vite :3000.
// submits a known variant, then clicks through Data type comparison, Phenotype summary, and Tissue
// summary tabs, asserting each renders real credible-set-derived data (not the migrating placeholder).
test("migrated summary tabs render credible-set data", async ({ page }) => {
  await page.goto("/annotate");

  const input = page.getByLabel(/Paste GRCh38 variant ids/i);
  await input.fill("19-44908684-T-C");
  await page.getByRole("button", { name: /annotate/i }).click();

  // wait for stage-1 + stage-2 to finish on the default tab
  await expect(page.getByText("19:44908684:T:C").first()).toBeVisible({ timeout: 30_000 });

  // no migrating placeholder should remain anywhere
  await expect(page.getByText(/being migrated/i)).toHaveCount(0);

  // ── .19 Data type comparison ───────────────────────────────────────────────
  await page.getByRole("tab", { name: /data type comparison/i }).click();
  await expect(page.getByText("GWAS CS")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("caQTL CS")).toBeVisible();
  await expect(page.getByText("total CS")).toBeVisible();
  // af column (mirrors the variant results table) — header is "<pop> AF" / "global AF"
  await expect(page.getByRole("columnheader", { name: /\bAF$/ })).toBeVisible();
  await expect(page.getByText("most severe gene")).toBeVisible();
  await snapshot(page, "tab-data-type-comparison");

  // ── .20 Phenotype summary ───────────────────────────────────────────────────
  await page.getByRole("tab", { name: /phenotype summary/i }).click();
  // wait for the summary table to populate (the "variants" count column header is part of this tab)
  await expect(page.getByText("variants", { exact: true })).toBeVisible({ timeout: 15_000 });
  // the per-row handoff buttons confirm trait rows derived from CS membership. their accessible name
  // is the tooltip title (aria-label), not the visible "search" text.
  await expect(page.getByRole("button", { name: /full summary-stat results/i }).first()).toBeVisible({
    timeout: 15_000,
  });
  await snapshot(page, "tab-phenotype-summary");

  // ── .21 Tissue & cell type summary, eQTL/caQTL local toggle ─────────────────
  await page.getByRole("tab", { name: /tissue and cell type summary/i }).click();
  // eQTL default toggle is present
  await expect(page.getByRole("button", { name: "eQTL" })).toBeVisible({ timeout: 15_000 });
  await snapshot(page, "tab-tissue-eqtl");
  // switch to caQTL and confirm the table changes (ATAC cell type + live peak->gene linked-genes)
  await page.getByRole("button", { name: "caQTL" }).click();
  await expect(page.getByText("linked genes")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("l1.PBMC")).toBeVisible({ timeout: 10_000 });
  // peak_to_genes enrichment resolves a known gene for this region's ATAC peaks
  await expect(page.getByText("NECTIN2", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  const file = await snapshot(page, "tab-tissue-caqtl");
  expect(file).toContain("tab-tissue-caqtl");
});
