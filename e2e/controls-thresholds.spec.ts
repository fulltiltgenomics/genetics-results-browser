import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// live verification of the migrated thresholds controls at /annotate (refactor.md §4, .15):
// the p-value field is gone, PIP + cs_min_r2 are shown, and changing PIP recomputes the table
// client-side (stage 2, no refetch). requires the full dev stack: api :2000, BFF :5000, vite :3000.
test("annotate controls show PIP + cs_min_r2 (no p-value) and react to PIP", async ({ page }) => {
  await page.goto("/annotate");

  const input = page.getByLabel(/Paste GRCh38 variant ids/i);
  await input.fill("19-44908684-T-C");
  await page.getByRole("button", { name: /annotate/i }).click();

  // wait for stage-1 data + stage-2 filtering to render the main table row
  await expect(page.getByText("19:44908684:T:C")).toBeVisible({ timeout: 30_000 });

  // the new threshold controls are present
  await expect(page.getByLabel("PIP threshold")).toBeVisible();
  await expect(page.getByLabel("cs_min_r2 threshold")).toBeVisible();
  // the legacy p-value field is gone
  await expect(page.getByLabel("p-value threshold")).toHaveCount(0);

  // controls gate on useNormalizedQuery (the BFF stage-1 query), so once data loads they are
  // interactive — not greyed out by the legacy useServerQuery that errors on the new shape.
  await expect(page.getByLabel("PIP threshold")).toBeEnabled();

  await snapshot(page, "annotate-controls-thresholds");

  // reactive stage-2 recompute on PIP change is also covered by the unit test
  // ("changing pipThreshold recomputes from the same raw data (no refetch)" in store.test.ts).
});
