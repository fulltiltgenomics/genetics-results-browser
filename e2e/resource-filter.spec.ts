import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// live verification of the lifted, dynamic resource filter in the main /annotate options
// (refactor.md §4, bd .16). requires the full dev stack: genetics-results-api :2000, BFF :5000,
// vite :3000. submits a multi-resource variant, asserts the filter lists several resources derived
// from the data, then toggles one OFF and asserts the main table's "credible sets" count reactively
// drops (stage-2 client-side refilter, no refetch).
test("resource filter lists dynamic resources and reactively refilters the table", async ({
  page,
}) => {
  await page.goto("/annotate");

  const input = page.getByLabel(/Paste GRCh38 variant ids/i);
  await input.fill("19-44908684-T-C");
  await page.getByRole("button", { name: /annotate/i }).click();

  // wait for the main table to render the variant row (stage-1 + stage-2 complete)
  await expect(page.getByText("19:44908684:T:C")).toBeVisible({ timeout: 30_000 });

  // the lifted resource filter shows multiple resources actually present in this variant's CS data.
  const resourceSwitch = (name: string) => page.getByRole("checkbox", { name, exact: true });
  await expect(resourceSwitch("finngen")).toBeVisible();
  await expect(resourceSwitch("eqtl_catalogue")).toBeVisible();
  await expect(resourceSwitch("ukbb")).toBeVisible();

  await snapshot(page, "resource-filter-controls");

  // the main table carries a "credible sets" count cell per variant; read it as the reactive signal.
  // we scan the row's numeric cells and take the largest (credible-sets count >= traits count).
  const csCount = async (): Promise<number> => {
    const cells = page.getByRole("cell");
    const n = await cells.count();
    // the cs_count column renders a plain integer; find the variant row's numeric cells and take the
    // larger one (credible sets >= traits). fallback to scanning all numeric cells.
    const nums: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = (await cells.nth(i).textContent())?.trim() ?? "";
      if (/^\d+$/.test(t)) nums.push(Number(t));
    }
    return nums.length ? Math.max(...nums) : 0;
  };

  const before = await csCount();
  expect(before).toBeGreaterThan(0);

  await resourceSwitch("eqtl_catalogue").click();
  await expect(resourceSwitch("eqtl_catalogue")).not.toBeChecked();
  await page.waitForTimeout(400); // let the reactive recompute land

  const after = await csCount();
  await snapshot(page, "resource-filter-after-toggle");

  // toggling a resource off must remove its credible sets reactively => strictly fewer.
  expect(after).toBeLessThan(before);
});
