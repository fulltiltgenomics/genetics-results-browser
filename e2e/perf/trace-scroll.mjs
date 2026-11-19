// Where the time goes while the table scrolls: total ms per timeline event name.
//   PERF_BASE_URL=http://localhost:3102 node e2e/perf/trace-scroll.mjs GCKR
import { chromium } from "@playwright/test";

const BASE = process.env.PERF_BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.goto(`${BASE}/gene/${process.argv[2] ?? "GCKR"}`);
await page.getByRole("tab", { name: "Gene evidence" }).click();
await page.getByRole("tab", { name: "variant association" }).click();
await page.getByTestId("assoc-row").first().waitFor({ timeout: 120000 });
// the padded region replaces the gene body a moment later
await page.waitForLoadState("networkidle").catch(() => {});
const table = page.getByTestId("assoc-table");
await table.scrollIntoViewIfNeeded();
const box = await table.boundingBox();
await page.mouse.move(box.x + 300, box.y + 100);
await browser.startTracing(page, { categories: ["devtools.timeline"] });
for (let i = 0; i < 40; i++) {
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(16);
}
const trace = JSON.parse((await browser.stopTracing()).toString());
const total = new Map();
for (const e of trace.traceEvents) {
  if (e.ph === "X" && e.dur) {
    const t = total.get(e.name) ?? { ms: 0, n: 0, max: 0 };
    t.ms += e.dur / 1000;
    t.n++;
    t.max = Math.max(t.max, e.dur / 1000);
    total.set(e.name, t);
  }
}
for (const [name, t] of [...total.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 14)) {
  console.log(
    `${t.ms.toFixed(0).padStart(6)} ms  n=${String(t.n).padStart(5)}  max=${t.max.toFixed(1).padStart(6)}  ${name}`
  );
}
await browser.close();
