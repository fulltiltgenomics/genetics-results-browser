import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// live verification of the QTL trait display + eQTL quant-level toggle (refactor.md §4, bd .18).
// requires the full dev stack: genetics-results-api :2000, BFF :5000, vite :3000. submits a variant
// known to carry eQTL Catalogue multi-level data (19-44908684-T-C has a CLASRP exon-level row),
// expands the variant, and (filtering the detail table to the CLASRP gene so the relevant rows are
// on-screen rather than buried among ~1000 credible sets) asserts: default ge-only => CLASRP shows
// the bare gene symbol with NO level chip; after toggling "show all quant levels" ON => the exon
// level appears as a chip next to the gene symbol. stage-2 client refilter, no refetch.
test("eQTL quant-level toggle reveals non-ge levels with a level chip", async ({ page }) => {
  await page.goto("/annotate");

  const input = page.getByLabel(/Paste GRCh38 variant ids/i);
  await input.fill("19-44908684-T-C");
  await page.getByRole("button", { name: /annotate/i }).click();

  await expect(page.getByText("19:44908684:T:C")).toBeVisible({ timeout: 30_000 });

  // drop the PIP threshold to 0 so the low-PIP exon-level eQTL row (pip≈0.008 for this variant) is
  // not removed by the PIP gate — this isolates the quant-level toggle as the only thing hiding it.
  await page.getByLabel("PIP threshold").fill("0");

  // the quant-level toggle is only mounted when leveled eQTL Catalogue data is present.
  const toggle = page.getByRole("checkbox", {
    name: /Show all eQTL Catalogue quantification levels/i,
  });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();

  // expand the variant to reveal the per-variant credible-set detail.
  await page.getByLabel("Expand").first().click();
  await expect(page.getByText(/Credible sets \/ fine-mapping results/i)).toBeVisible({
    timeout: 15_000,
  });

  // the detail table carries column filters; narrow the trait column to the CLASRP gene so the
  // relevant eQTL rows are on the current page (the table holds ~1000 credible sets otherwise).
  const traitFilter = page.getByPlaceholder("trait").last();
  await traitFilter.fill("CLASRP");
  await page.waitForTimeout(400);

  // a level chip carries exactly one of the non-gene level tokens as its text.
  const levelChips = page.locator(".MuiChip-root").filter({
    hasText: /^(exon|tx|txrev|leafcutter)$/,
  });

  // default ge-only: this variant's only CLASRP eQTL row is exon-level, so it is hidden — no CLASRP
  // row and no level chip appear. (gene-level rows, when present, would show the bare symbol here.)
  expect(await levelChips.count()).toBe(0);
  await snapshot(page, "quant-level-default-ge-only");

  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.waitForTimeout(400); // let the reactive recompute + re-render land

  // turning the option on surfaces the exon-level CLASRP row with the gene symbol + a visible chip.
  await expect(page.getByText("CLASRP").first()).toBeVisible();
  await expect(levelChips.first()).toBeVisible();
  expect(await levelChips.count()).toBeGreaterThan(0);
  await snapshot(page, "quant-level-all-levels");
});
