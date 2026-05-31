import path from "node:path";
import type { Page } from "@playwright/test";

// reusable visual-verification helper: snapshot a page to a named file under the
// gitignored e2e/.output/screenshots dir. other specs call this to capture UI state
// for an agent to inspect headlessly on the no-GUI VM.
export async function snapshot(page: Page, name: string): Promise<string> {
  const file = path.join("e2e", ".output", "screenshots", `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
