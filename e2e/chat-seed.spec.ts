import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// verifies the annotation -> chat seeding hand-off (bd .27, refactor.md §9): an "Ask the assistant"
// affordance on the variant table and the gene view stashes a context-rich prompt and routes to
// /chat, where the input is PREFILLED (not auto-sent). requires the full dev stack
// (genetics-results-api :2000, BFF :5000, vite :3000).

const SINGLE = "19-44908684-T-C"; // APOE rs429358

const fillInput = async (page: import("@playwright/test").Page, value: string): Promise<void> => {
  const input = page.getByLabel(/Paste GRCh38 variant ids/i);
  await input.fill(value);
  await page.getByRole("button", { name: /annotate/i }).click();
};

test("variant table 'Ask the assistant' seeds and prefills the chat input", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/annotate");
  await fillInput(page, SINGLE);

  // wait for the main table row
  await expect(page.getByText("19:44908684:T:C")).toBeVisible({ timeout: 30_000 });

  // open the per-row actions menu (MRT renders a "more" icon button per row) and click the item
  await page.getByRole("button", { name: /row actions/i }).first().click();
  await page.getByRole("menuitem", { name: /ask the assistant/i }).click();

  // navigated to /chat with the variant-context prompt prefilled (review, not yet sent)
  await expect(page).toHaveURL(/\/chat/);
  const textbox = page.getByPlaceholder(/Ask about phenotypes/i);
  await expect(textbox).toBeVisible({ timeout: 30_000 });
  await expect(textbox).toHaveValue(/Explain variant 19:44908684:T:C/, { timeout: 15_000 });
  await expect(textbox).toHaveValue(/credible sets and colocalizations/);
  // no message bubbles yet — nothing was auto-sent
  await expect(page.getByText("You", { exact: true })).toHaveCount(0);
  await snapshot(page, "chat-seed-01-variant-prefilled");
});

test("gene view 'Ask the assistant' seeds and prefills the chat input", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/gene/APOE");

  const askBtn = page.getByRole("button", { name: /ask the assistant/i });
  await expect(askBtn).toBeVisible({ timeout: 30_000 });
  await askBtn.click();

  await expect(page).toHaveURL(/\/chat/);
  // ChatPage mounts LLMChat only after its (CORS-failing in e2e) session fetch settles, so allow time
  const textbox = page.getByPlaceholder(/Ask about phenotypes/i);
  await expect(textbox).toBeVisible({ timeout: 30_000 });
  await expect(textbox).toHaveValue(/Summarize the credible-set and functional evidence for APOE/, {
    timeout: 15_000,
  });
  await expect(page.getByText("You", { exact: true })).toHaveCount(0);
  await snapshot(page, "chat-seed-02-gene-prefilled");
});

// regression for the .27 review bug: ChatPage holds the consumed seed in a sticky state and shares
// one instance across /chat and /chat/:id, so starting a new/secret chat (which remounts LLMChat via
// chatKey) used to RE-PREFILL the stale seed into the unrelated chat. the fix clears seedInput in the
// chatKey-bumping handlers, so the next chat must open with an EMPTY input.
test("starting a new chat after a seeded hand-off does NOT re-prefill the stale seed", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/annotate");
  await fillInput(page, SINGLE);

  await expect(page.getByText("19:44908684:T:C")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /row actions/i }).first().click();
  await page.getByRole("menuitem", { name: /ask the assistant/i }).click();

  // seed lands in the chat input
  await expect(page).toHaveURL(/\/chat/);
  const textbox = page.getByPlaceholder(/Ask about phenotypes/i);
  await expect(textbox).toHaveValue(/Explain variant 19:44908684:T:C/, { timeout: 30_000 });

  // start a Secret Chat: handleNewSecretChat bumps chatKey (remounting LLMChat) and clears the seed.
  // secret chat needs no backend session, so this is robust even when session APIs CORS-fail in e2e.
  await page.getByRole("button", { name: /^secret chat$/i }).click();

  // the freshly mounted chat must be empty — the seed belonged to the previous chat only
  const newTextbox = page.getByPlaceholder(/Ask about phenotypes/i);
  await expect(newTextbox).toBeVisible({ timeout: 30_000 });
  await expect(newTextbox).toHaveValue("");
  await snapshot(page, "chat-seed-03-new-chat-empty");
});
