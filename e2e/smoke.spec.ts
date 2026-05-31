import { test, expect } from "@playwright/test";
import { snapshot } from "./helpers/screenshot";

// smoke test: load the app shell and capture a screenshot. asserts only on
// elements that render WITHOUT backend data (header + chat disclaimer), so it
// passes deterministically even when the API/BFF are down on the VM.
test("app shell renders and screenshots", async ({ page }) => {
  await page.goto("/");

  // theme toggle lives in the Header on every route, independent of data/auth
  await expect(page.getByRole("button", { name: "toggle theme" })).toBeVisible();

  // the FinnGenie disclaimer caption always renders on the landing (chat) page
  await expect(page.getByText(/FinnGenie is an AI tool/i)).toBeVisible();

  const file = await snapshot(page, "smoke-home");
  expect(file).toContain("smoke-home");
});
