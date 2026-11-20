// The same user actions timed on any version of the variant association tab, including the one
// built on material-react-table that has none of the shared test ids: time and bytes to the first
// table row, a column sort, typing in the search box, sweeping the pointer down the rows, and
// dragging the gene track.
//
//   PERF_BASE_URL=http://localhost:3000 node e2e/perf/table-ops.mjs GCKR APOE
//   PERF_CPU=4   CDP CPU throttling rate (default 1)
import { chromium } from "@playwright/test";

const BASE = process.env.PERF_BASE_URL ?? "http://localhost:3000";
const CPU = Number(process.env.PERF_CPU ?? 1);
const genes = process.argv.slice(2);

const startRecording = (page) =>
  page.evaluate(() => {
    const rec = (window.__rec = { frames: [], longTasks: [], on: true });
    let last = performance.now();
    const tick = (now) => {
      if (!rec.on) return;
      rec.frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    rec.observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) rec.longTasks.push(e.duration);
    });
    rec.observer.observe({ entryTypes: ["longtask"] });
  });

const stopRecording = async (page) => {
  const rec = await page.evaluate(() => {
    window.__rec.on = false;
    window.__rec.observer.disconnect();
    return { frames: window.__rec.frames.slice(1), longTasks: window.__rec.longTasks };
  });
  const sorted = [...rec.frames].sort((a, b) => a - b);
  const at = (q) =>
    Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 10) / 10;
  return {
    p50: at(0.5),
    p95: at(0.95),
    max: at(1),
    longTasks: rec.longTasks.length,
    longTaskMs: Math.round(rec.longTasks.reduce((a, b) => a + b, 0)),
  };
};

// ms from a click on `locator` until the frame after its handlers have run is presented
const clickLatency = async (page, locator) => {
  const handle = await locator.elementHandle();
  return Math.round(
    await page.evaluate(
      (el) =>
        new Promise((resolve) => {
          const t0 = performance.now();
          el.click();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)));
        }),
      handle
    )
  );
};

// The gene page opens on its credible-sets tab, whose request for every credible set of the locus
// keeps the API busy, then the main thread, and then asks for more. Nothing is timed until the
// page has had three seconds with no request in flight and a main thread that answers at once.
const untilQuiet = async (page, inFlight) => {
  let quietSince = Date.now();
  const deadline = Date.now() + 300000;
  while (Date.now() - quietSince < 3000 && Date.now() < deadline) {
    await page.waitForTimeout(200);
    const asked = Date.now();
    await page.evaluate(() => 0);
    if (inFlight.size > 0 || Date.now() - asked > 150) quietSince = Date.now();
  }
};

const measure = async (browser, gene) => {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  let counting = false;
  let apiBytes = 0;
  let apiRequests = 0;
  const counted = new Set();
  const inFlight = new Set();
  cdp.on("Network.loadingFailed", (e) => inFlight.delete(e.requestId));
  cdp.on("Network.requestWillBeSent", (e) => {
    inFlight.add(e.requestId);
    if (counting && /\/api\/v1\//.test(e.request.url)) counted.add(e.requestId);
  });
  cdp.on("Network.loadingFinished", (e) => {
    inFlight.delete(e.requestId);
    if (counted.has(e.requestId)) {
      apiBytes += e.encodedDataLength;
      apiRequests++;
    }
  });

  await page.goto(`${BASE}/gene/${gene}`);
  await page.getByRole("tab", { name: "Gene evidence" }).click();
  await untilQuiet(page, inFlight);
  counting = true;
  const clicked = await page.evaluate(() => performance.now());
  await page.getByRole("tab", { name: "variant association" }).click();
  const shared = page.getByTestId("assoc-row");
  const rows = (await page
    .getByTestId("assoc-tracks")
    .count()
    .catch(() => 0))
    ? shared
    : page.locator("tbody tr:visible");
  await page.waitForFunction(
    () => document.querySelector('[data-testid="assoc-row"], tbody tr td') !== null,
    null,
    { timeout: 180000 }
  );
  const firstRowMs = Math.round((await page.evaluate(() => performance.now())) - clicked);
  await page.waitForLoadState("networkidle", { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const usesShared = (await shared.count()) > 0;
  const rowLocator = usesShared ? shared : rows;
  const out = {
    gene,
    cpu: CPU,
    table: usesShared ? "virtualized" : "material-react-table",
    firstRowMs,
    settledMs: Math.round((await page.evaluate(() => performance.now())) - clicked - 2000),
    apiRequests,
    apiKB: Math.round(apiBytes / 1024),
    rowsInDom: await rowLocator.count(),
    domNodes: await page.evaluate(() => document.querySelectorAll("*").length),
  };

  const header = page.getByRole("columnheader", { name: /^PIP/ }).first();
  const sortTarget = usesShared
    ? header
    : header.locator(".Mui-TableHeadCell-Content-Labels").first();
  out.sortMs = [];
  for (let i = 0; i < 4; i++) {
    out.sortMs.push(await clickLatency(page, sortTarget));
    await page.waitForTimeout(300);
  }

  const search = page.getByLabel("search");
  await search.click();
  await startRecording(page);
  await page.keyboard.type("triglycer", { delay: 60 });
  await page.waitForTimeout(400);
  out.typing = await stopRecording(page);
  await search.fill("");
  await page.waitForTimeout(500);

  // the pointer down the first rows: the older view redraws the gene model for each row passed
  const first = await rowLocator.first().boundingBox();
  await startRecording(page);
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(first.x + 300, first.y + 10 + ((i * 7) % 240));
    await page.waitForTimeout(16);
  }
  out.rowSweep = await stopRecording(page);

  const track = usesShared
    ? page.getByTestId("assoc-tracks")
    : page.getByTestId("gene-model").locator("svg").first();
  await track.scrollIntoViewIfNeeded();
  // out twice, so there is room to pan
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "zoom out" }).click();
  const box = await track.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height - 30;
  await startRecording(page);
  await page.mouse.move(cx, cy);
  // the canvas tracks pan only with the key held; the older SVG model pans on a plain drag
  if (usesShared) await page.keyboard.down("Control");
  await page.mouse.down();
  for (let i = 0; i < 120; i++) {
    await page.mouse.move(cx + Math.sin((i / 120) * 2 * Math.PI) * box.width * 0.3, cy);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  if (usesShared) await page.keyboard.up("Control");
  out.pan = await stopRecording(page);

  await context.close();
  return out;
};

const browser = await chromium.launch();
const results = [];
for (const gene of genes) {
  try {
    results.push(await measure(browser, gene));
  } catch (err) {
    results.push({ gene, cpu: CPU, error: String(err).slice(0, 300) });
  }
  console.error(JSON.stringify(results[results.length - 1]));
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
