// Drives the variant association tab against live data and prints what it measures as JSON.
//
//   PERF_BASE_URL=http://localhost:3102 node e2e/perf/assoc-perf.mjs GCKR APOE PCSK9
//   PERF_CPU=4      CDP CPU throttling rate (default 1)
//   PERF_SHOTS=dir  also write screenshots there: default, mid and maximum zoom, light and dark
//
// Reads only the shared contract (data-testid assoc-tracks / assoc-table / assoc-row and
// window.__assocPerf), so the same script runs against any branch that implements it. Needs the
// app in dev mode (`vite --mode dev.public`), since __assocPerf exists only there.
import { chromium } from "@playwright/test";

const BASE = process.env.PERF_BASE_URL ?? "http://localhost:3000";
const CPU = Number(process.env.PERF_CPU ?? 1);
const SHOTS = process.env.PERF_SHOTS;
const genes = process.argv.slice(2);
if (genes.length === 0) {
  console.error("usage: assoc-perf.mjs GENE [GENE...]");
  process.exit(2);
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const frameStats = ({ frames, longTasks }) => {
  const sorted = [...frames].sort((a, b) => a - b);
  const round = (v) => (v == null ? null : Math.round(v * 10) / 10);
  return {
    frames: sorted.length,
    p50: round(quantile(sorted, 0.5)),
    p95: round(quantile(sorted, 0.95)),
    max: round(sorted[sorted.length - 1]),
    longTasks: longTasks.length,
    longTaskMs: Math.round(longTasks.reduce((a, b) => a + b, 0)),
  };
};

// records the time between animation frames and the long tasks while `action` runs
const withFrames = async (page, action) => {
  await page.evaluate(() => {
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
  const result = await action();
  const rec = await page.evaluate(() => {
    const rec = window.__rec;
    rec.on = false;
    rec.observer.disconnect();
    return { frames: rec.frames.slice(1), longTasks: rec.longTasks };
  });
  return { ...frameStats(rec), ...result };
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

const perf = (page) => page.evaluate(() => ({ ...window.__assocPerf }));
const span = (v) => v.end - v.start;

// resolves in the page with the ms from now until `predicate` holds and a frame has been presented
const latencyUntil = (page, predicate, arg) =>
  page.evaluate(
    ([source, arg]) =>
      new Promise((resolve) => {
        const test = new Function("arg", `return (${source})(arg)`);
        const t0 = performance.now();
        const poll = () => {
          if (test(arg)) {
            requestAnimationFrame(() => resolve(performance.now() - t0));
          } else if (performance.now() - t0 > 30000) {
            resolve(null);
          } else {
            requestAnimationFrame(poll);
          }
        };
        poll();
      }),
    [predicate.toString(), arg]
  );

const measureGene = async (browser, gene) => {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const requests = new Map();
  let apiBytes = 0;
  let apiRequests = 0;
  // only what is asked for after the tab is opened counts: the gene page's own requests can
  // still be in flight then
  let counting = false;
  const inFlight = new Set();
  cdp.on("Network.requestWillBeSent", (e) => {
    inFlight.add(e.requestId);
    if (counting) requests.set(e.requestId, e.request.url);
  });
  cdp.on("Network.loadingFailed", (e) => inFlight.delete(e.requestId));
  cdp.on("Network.loadingFinished", (e) => {
    inFlight.delete(e.requestId);
    if (/\/api\/v1\//.test(requests.get(e.requestId) ?? "")) {
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
  await page.waitForFunction(() => window.__assocPerf?.ready, null, { timeout: 120000 });
  const readyAt = await page.evaluate(() => performance.now());
  await page.getByTestId("assoc-row").first().waitFor({ timeout: 120000 });
  const tableAt = await page.evaluate(() => performance.now());
  await page.waitForLoadState("networkidle").catch(() => {});
  const loaded = await perf(page);
  const out = {
    gene,
    cpu: CPU,
    load: {
      apiRequests,
      apiKB: Math.round(apiBytes / 1024),
      // optional extra of a branch: its first paint with partial data
      firstPaintMs: loaded.firstPaintAt == null ? null : Math.round(loaded.firstPaintAt - clicked),
      readyMs: Math.round(readyAt - clicked),
      tableMs: Math.round(tableAt - clicked),
      tableRows: loaded.tableRows,
    },
  };

  const tracks = page.getByTestId("assoc-tracks");
  await tracks.scrollIntoViewIfNeeded();
  const box = await tracks.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const shot = async (name) => {
    if (!SHOTS) return;
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/${gene}-${name}-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: "light" });
  };
  await shot("default");

  // ctrl + wheel out to the limits and back in to the starting span
  const startSpan = span(loaded.view);
  const wheelUntil = async (delta, done) => {
    let steps = 0;
    for (; steps < 400 && !done(await perf(page)); steps++) {
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(16);
    }
    return steps;
  };
  await page.mouse.move(cx, cy);
  await page.keyboard.down("Control");
  const framesBefore = (await perf(page)).frames;
  out.zoom = await withFrames(page, async () => {
    const outSteps = await wheelUntil(12, (p) => span(p.view) >= span(p.limits) - 1);
    const inSteps = await wheelUntil(-12, (p) => span(p.view) <= startSpan);
    return { wheelEvents: outSteps + inSteps };
  });
  out.zoom.trackRedraws = (await perf(page)).frames - framesBefore;
  // plain wheel must scroll the page, not zoom
  await page.keyboard.up("Control");
  const before = await perf(page);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(100);
  out.plainWheelZooms = span((await perf(page)).view) !== span(before.view);
  await page.evaluate(() => window.scrollTo(0, 0));
  await tracks.scrollIntoViewIfNeeded();

  if (SHOTS) {
    await page.mouse.move(cx, cy);
    await page.keyboard.down("Control");
    await wheelUntil(40, (p) => span(p.view) >= Math.sqrt(startSpan * span(p.limits)));
    await page.keyboard.up("Control");
    await shot("mid");
  }

  // drag-pan with the view at half the widest span: at the limits themselves there is nowhere to go
  await page.mouse.move(cx, cy);
  await page.keyboard.down("Control");
  await wheelUntil(40, (p) => span(p.view) >= span(p.limits) - 1);
  await shot("max");
  await wheelUntil(-40, (p) => span(p.view) <= span(p.limits) / 2);
  await page.keyboard.up("Control");
  out.pan = await withFrames(page, async () => {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 0; i < 120; i++) {
      const phase = (i / 120) * 2 * Math.PI;
      await page.mouse.move(cx + Math.sin(phase) * box.width * 0.35, cy);
      await page.waitForTimeout(8);
    }
    await page.mouse.up();
    return {};
  });

  // back to the widest view for the click
  await page.mouse.move(cx, cy);
  await page.keyboard.down("Control");
  await wheelUntil(40, (p) => span(p.view) >= span(p.limits) - 1);
  await page.keyboard.up("Control");

  // a click in the track: until the table's row count has changed and a frame is out
  const rowsBefore = (await perf(page)).tableRows;
  // a click can keep every row, when all of them have a variant there: try a few places
  for (const dx of [3, -box.width * 0.2, box.width * 0.3]) {
    const settled = latencyUntil(
      page,
      ([n, t0]) => window.__assocPerf.tableRows !== n || performance.now() - t0 > 2000,
      [rowsBefore, await page.evaluate(() => performance.now())]
    );
    await page.mouse.click(cx + dx, cy - 40);
    const clickMs = await settled;
    const rowsAfter = (await perf(page)).tableRows;
    out.click = {
      ms: rowsAfter === rowsBefore ? null : Math.round(clickMs),
      rowsBefore,
      rowsAfter,
    };
    // put the selection away again: escape, then whatever else the branch offers
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    if ((await perf(page)).tableRows !== rowsBefore) {
      await page.mouse.click(cx + dx, cy - 40);
      await page.waitForTimeout(300);
    }
    if (out.click.ms != null) break;
  }

  // table scroll, top to wherever sixty wheel steps reach
  const table = page.getByTestId("assoc-table");
  await table.scrollIntoViewIfNeeded();
  const tbox = await table.boundingBox();
  await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + Math.min(tbox.height, 400) / 2);
  out.scroll = await withFrames(page, async () => {
    for (let i = 0; i < 60; i++) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(16);
    }
    return { scrollTop: await table.evaluate((el) => el.scrollTop) };
  });
  await table.evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(200);

  // opening a row: until the row's own content has grown, which is when its members are in
  const row = page.getByTestId("assoc-row").first();
  const grown = latencyUntil(
    page,
    (n) =>
      document.querySelector('[data-testid="assoc-table"]').querySelectorAll("tr, [role=row]")
        .length > n,
    await table.evaluate((el) => el.querySelectorAll("tr, [role=row]").length)
  );
  await row.click();
  const expandMs = await grown;
  out.expand = { ms: expandMs == null ? null : Math.round(expandMs) };

  await context.close();
  return out;
};

const browser = await chromium.launch();
const results = [];
for (const gene of genes) {
  try {
    results.push(await measureGene(browser, gene));
  } catch (err) {
    results.push({ gene, cpu: CPU, error: String(err).slice(0, 300) });
  }
  console.error(JSON.stringify(results[results.length - 1]));
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
