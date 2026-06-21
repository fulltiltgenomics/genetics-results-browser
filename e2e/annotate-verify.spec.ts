import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// comprehensive verification walk of the fully migrated variant table at /annotate (bd .22,
// refactor.md §4). requires the full dev stack: genetics-results-api :2000, BFF :5000, vite :3000.
// this spec is a superset visual capture: it drives a single multi-resource variant through the
// whole flow (controls panel, main table, expanded credible-set detail, all 4 tabs, resource +
// quant-level toggles in effect), and separately drives a small multi-variant input WITH betas to
// exercise the consistent/opposite columns in the Phenotype summary. screenshots land in
// e2e/.output/screenshots for headless inspection on the no-GUI VM.

const SINGLE = "19-44908684-T-C"; // APOE rs429358 — multi-resource (finngen/ukbb/eqtl_catalogue), caQTL, leveled eQTL
// two variants with input betas (tab-separated variant\tbeta\tcategory), so hasBetas=true and the
// Phenotype summary derives consistent/opposite direction-agreement counts vs the input beta.
const MULTI_WITH_BETAS = "19-44908684-T-C\t0.5\tlipids\n19-45869791-ATT-A\t0.3\tlipids";

const fillInput = async (page: import("@playwright/test").Page, value: string): Promise<void> => {
  const input = page.getByLabel(/Paste GRCh38 variant ids/i);
  await input.fill(value);
  await page.getByRole("button", { name: /annotate/i }).click();
};

// this is a long sequential walk (10+ steps, each followed by a heavy full-page screenshot of a
// DOM holding ~1000 credible-set rows); under parallel CPU contention the default 30s test timeout
// is too tight, so give it room. it is a deliberate superset capture, not a focused assertion.
test("annotate full single-variant verification walk + screenshots", async ({ page }) => {
  test.setTimeout(120_000);
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  await page.goto("/annotate");
  await fillInput(page, SINGLE);

  // ── stage-1 BFF fetch + stage-2 client filter complete → main table row ──────
  await expect(page.getByText("19:44908684:T:C", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("rs429358")).toBeVisible();
  // no "Association results" / p-value vestiges anywhere; CS-only data (intended diff)
  await expect(page.getByText(/Association results/i)).toHaveCount(0);
  await expect(page.getByText(/being migrated/i)).toHaveCount(0);
  await snapshot(page, "verify-01-main-table");

  // ── controls panel: PIP + p-value thresholds, dynamic resource filter, gnomAD pop ───
  await expect(page.getByLabel("PIP threshold")).toBeVisible();
  await expect(page.getByLabel("p-value threshold")).toBeVisible();
  await expect(page.getByLabel("cs_min_r2 threshold")).toHaveCount(0);
  // dynamic resource filter lists resources actually present in this variant's CS data
  const resourceSwitch = (name: string) =>
    page.getByRole("checkbox", { name, exact: true });
  await expect(resourceSwitch("finngen")).toBeVisible();
  await expect(resourceSwitch("eqtl_catalogue")).toBeVisible();
  await expect(resourceSwitch("ukbb")).toBeVisible();
  // gnomAD population control is mounted
  await expect(page.getByLabel("AF gnomAD population")).toBeVisible();
  await snapshot(page, "verify-02-controls-panel");

  // ── expanded credible-set detail row (single per-variant detail table) ───────
  await page.getByLabel("Expand").first().click();
  await expect(page.getByText(/Credible sets \/ fine-mapping results/i)).toBeVisible({
    timeout: 15_000,
  });
  await snapshot(page, "verify-03-credible-set-detail");
  // collapse before tab navigation so tab content is unobstructed
  await page.getByLabel("Collapse").first().click();

  // ── quant-level toggle in effect (ge-only default vs all-levels) ─────────────
  await page.getByLabel("PIP threshold").fill("0"); // surface the low-PIP exon-level eQTL row
  const quantToggle = page.getByRole("checkbox", {
    name: /Show all eQTL Catalogue quantification levels/i,
  });
  await expect(quantToggle).toBeVisible();
  await expect(quantToggle).not.toBeChecked();
  await page.getByLabel("Expand").first().click();
  await expect(page.getByText(/Credible sets \/ fine-mapping results/i)).toBeVisible({
    timeout: 15_000,
  });
  const traitFilter = page.getByPlaceholder("trait").last();
  await traitFilter.fill("CLASRP");
  await page.waitForTimeout(400);
  const levelChips = page
    .locator(".MuiChip-root")
    .filter({ hasText: /^(exon|tx|txrev|leafcutter)$/ });
  expect(await levelChips.count()).toBe(0); // ge-only default hides the exon-level row
  await snapshot(page, "verify-04-quant-level-ge-only");
  await quantToggle.click();
  await expect(quantToggle).toBeChecked();
  await page.waitForTimeout(400);
  await expect(levelChips.first()).toBeVisible(); // level chip now shown alongside gene symbol
  await snapshot(page, "verify-05-quant-level-all-levels");
  // reset for the tab walk; restore PIP to the default so the main table is small + stable
  await quantToggle.click();
  await traitFilter.fill("");
  await page.getByLabel("Collapse").first().click();
  await page.getByLabel("PIP threshold").fill("0.05");
  await page.waitForTimeout(400);

  // ── resource filter reactively refilters the main table (stage-2, no refetch) ─
  // read all cell texts in one batch (allTextContents) rather than re-querying .nth(i) in a loop,
  // which is brittle while the table re-renders after a filter change.
  const csCount = async (): Promise<number> => {
    const texts = await page.getByRole("cell").allTextContents();
    const nums = texts
      .map((t) => t.trim())
      .filter((t) => /^\d+$/.test(t))
      .map(Number);
    return nums.length ? Math.max(...nums) : 0;
  };
  const before = await csCount();
  expect(before).toBeGreaterThan(0);
  await resourceSwitch("eqtl_catalogue").click();
  await expect(resourceSwitch("eqtl_catalogue")).not.toBeChecked();
  await page.waitForTimeout(400);
  const after = await csCount();
  expect(after).toBeLessThan(before);
  await snapshot(page, "verify-06-resource-filter-applied");
  // restore so the tabs show full data
  await resourceSwitch("eqtl_catalogue").click();
  await page.waitForTimeout(400);

  // ── tab 2: Data type comparison ──────────────────────────────────────────────
  await page.getByRole("tab", { name: /data type comparison/i }).click();
  await expect(page.getByText("total CS")).toBeVisible({ timeout: 15_000 });
  await snapshot(page, "verify-07-tab-data-type-comparison");

  // ── tab 3: Phenotype summary (CS-membership counts + handoff) ────────────────
  await page.getByRole("tab", { name: /phenotype summary/i }).click();
  await expect(
    page.getByRole("button", { name: /full summary-stat results/i }).first()
  ).toBeVisible({ timeout: 15_000 });
  await snapshot(page, "verify-08-tab-phenotype-summary");

  // ── tab 4: Tissue & cell type summary (local eQTL/caQTL toggle) ──────────────
  await page.getByRole("tab", { name: /tissue and cell type summary/i }).click();
  await expect(page.getByRole("button", { name: "eQTL" })).toBeVisible({ timeout: 15_000 });
  await snapshot(page, "verify-09-tab-tissue-eqtl");
  await page.getByRole("button", { name: "caQTL" }).click();
  await expect(page.getByText("linked genes")).toBeVisible({ timeout: 10_000 });
  await snapshot(page, "verify-10-tab-tissue-caqtl");

  // surface any console/page errors collected across the whole walk for the verdict.
  if (consoleErrors.length) {
    console.log(`[verify] console/page errors during single-variant walk:\n${consoleErrors.join("\n")}`);
  }
  // benign favicon/network 404s aside, there should be no app-level runtime errors. the chat
  // backend (:4000) is out of scope for this verification and not part of the dev stack here, so
  // its auth CORS/network errors are filtered out — they are unrelated to the /annotate tool.
  const appErrors = consoleErrors.filter(
    (e) =>
      !/favicon|net::ERR|Failed to load resource|Network Error/i.test(e) &&
      !/:4000\/chat|\/chat\/v1\/auth|Access-Control-Allow-Origin/i.test(e)
  );
  expect(appErrors, `unexpected app errors: ${appErrors.join(" | ")}`).toHaveLength(0);
});

test("annotate multi-variant with betas exercises consistent/opposite columns", async ({
  page,
}) => {
  await page.goto("/annotate");
  await fillInput(page, MULTI_WITH_BETAS);

  // variant 1 renders. variant 2 (19:45869791:ATT:A) has only a weak eQTL CS (p≈0.15) which the
  // default 0.05 p-value threshold filters out, so it is correctly absent from the main table; it is
  // still counted in the QueryVariantInfo "found" summary above.
  await expect(page.getByText("19:44908684:T:C", { exact: true })).toBeVisible({ timeout: 30_000 });
  // betas present → main table exposes the "my beta" column
  await expect(page.getByText("my beta", { exact: true })).toBeVisible();
  await snapshot(page, "verify-11-multivariant-main-with-betas");

  // Phenotype summary derives consistent/opposite direction-agreement counts vs the input beta.
  await page.getByRole("tab", { name: /phenotype summary/i }).click();
  await expect(page.getByText("consistent", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("opposite", { exact: true })).toBeVisible();
  await snapshot(page, "verify-12-multivariant-consistent-opposite");
});
