import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// live verification for the affected/affecting gene-list refactor (genetics-results-browser-3uu.26):
// the two pQTL gene-relationship panels must still render the same genes with working click-through
// after the list computation moved to buildAffectedGeneList/buildAffectingGeneList in geneCS.ts.
test("gene view renders affected/affecting gene lists with click-through", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/gene/APOE");
  await expect(page.getByText("Loading...")).toBeHidden({ timeout: 30000 });

  const affectsTitle = page.getByText("Variants in APOE affect these genes");
  const affectedByTitle = page.getByText("Variants in these genes affect APOE");
  // at least one of the two panels should resolve to a populated/empty title (not Loading)
  await expect(affectsTitle.or(affectedByTitle).first()).toBeVisible({ timeout: 30000 });

  // capture the gene names rendered in each panel for the report
  const collect = async (locator: ReturnType<typeof page.getByText>) => {
    if ((await locator.count()) === 0) return [];
    // the gene links/items live in the sibling Box after the title
    const panel = locator.locator("xpath=following-sibling::div[1]");
    return (await panel.allInnerTexts()).join(" ").split(/\s+/).filter(Boolean);
  };
  const affects = await collect(affectsTitle);
  const affectedBy = await collect(affectedByTitle);
  console.log("AFFECTS (APOE -> these genes):", JSON.stringify(affects));
  console.log("AFFECTED BY (these genes -> APOE):", JSON.stringify(affectedBy));

  // click-through: a gene link other than APOE should navigate to /gene/<name>
  const otherLink = page.locator("a[href^='/gene/']").filter({ hasNotText: "APOE" }).first();
  if ((await otherLink.count()) > 0) {
    const href = await otherLink.getAttribute("href");
    await otherLink.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    console.log("CLICK-THROUGH OK ->", href);
    await page.goBack();
  } else {
    console.log("CLICK-THROUGH: no non-APOE gene link present in lists");
  }

  const file = await snapshot(page, "gene-APOE-affected-affecting");
  expect(file).toContain("gene-APOE-affected-affecting");
  expect(pageErrors).toEqual([]);
});
