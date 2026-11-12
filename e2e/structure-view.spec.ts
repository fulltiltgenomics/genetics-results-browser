import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { snapshot } from "./helpers/screenshot";
import { ORIGIN, STATIC, fileMarker, serve, type Harness } from "./helpers/structureHarness";

/**
 * The structure viewer in a chat transcript, against the PRODUCTION bundle under the
 * production policy (helpers/structureHarness.ts), so Mol* doing anything that policy forbids
 * fails here and not on a cluster. The vite dev server cannot show that — it serves unbundled
 * modules and sends no policy.
 *
 * Needs a build first, with the same-origin API and chat paths the deployments use:
 *
 *   npx vite build --mode prod && npx playwright test e2e/structure-view.spec.ts
 */

const MODEL_FILE_ID = "AF-P23297-F1-model_v6";
// real AlphaFold DB bytes; see the ATTRIBUTION file beside it
const PDB = gunzipSync(readFileSync(path.join(__dirname, "fixtures", `${MODEL_FILE_ID}.pdb.gz`)));
const MODELS = { [MODEL_FILE_ID]: PDB };

const VALID_SPEC = {
  version: 1,
  model_file_id: MODEL_FILE_ID,
  accession: "P23297",
  gene: "S100A1",
  residues: [
    { file_position: 20, label: "p.S20L", role: "case" },
    { file_position: 45, label: "p.F45L", role: "control" },
    { file_position: 70, label: "p.V70M", role: "both" },
    // no label: drawn as spheres, named on hover only
    { file_position: 85, colour: "#2ca02c" },
    // past the end of the 94-residue model: listed, and not drawn
    { file_position: 900, role: "case" },
  ],
  sphere: { centre: 20, radius: 8 },
};
const VIEW = fileMarker("s100a1.structure-view.json", JSON.stringify(VALID_SPEC));
const FILLER = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} of narration.`).join("\n\n");

const SESSIONS = {
  valid: `Here is the structure.\n\n${VIEW}\n\nThat is all.`,
  invalid: `Here.\n\n${fileMarker(
    "broken.structure-view.json",
    JSON.stringify({ ...VALID_SPEC, model_file_id: "../x" }),
  )}\n\nThat is all.`,
  // far from both ends of the transcript, so it is off screen wherever the chat opens
  buried: `${FILLER}\n\n${VIEW}\n\n${FILLER}`,
  many: Array.from({ length: 12 }, (_, i) => `Structure ${i}.\n\n${VIEW}`).join("\n\n"),
};

// tall enough that the chat's fixed input bar does not sit over the viewer in the screenshot
test.use({ viewport: { width: 1280, height: 1200 } });

const open = async (page: Page, id: keyof typeof SESSIONS): Promise<Harness> => {
  const harness = await serve(page, SESSIONS, MODELS);
  await page.goto(`${ORIGIN}/chat/${id}`);
  return harness;
};

// software GL in headless chromium is slow to compile Mol*'s shaders
const ready = (canvas: Locator) =>
  expect(canvas).toHaveAttribute("data-state", "ready", { timeout: 90_000 });

const noViolations = async (harness: Harness) => {
  expect(await harness.violations()).toEqual([]);
  expect(harness.consoleViolations).toEqual([]);
};

test("a structure-view artifact draws under the production CSP", async ({ page }) => {
  const harness = await open(page, "valid");

  const viewer = page.getByTestId("structure-viewer");
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  await expect(viewer).toContainText("S100A1 · P23297 · AF-P23297-F1-model_v6");

  const canvas = page.getByTestId("structure-canvas");
  await ready(canvas);
  await expect(canvas.locator("canvas")).toBeVisible();

  // read back from Mol*'s state tree, not echoed from the spec
  await expect(canvas).toHaveAttribute("data-highlighted", "20,45,70,85");
  await expect(canvas).toHaveAttribute("data-colour-theme", "plddt-confidence");
  await expect(canvas).toHaveAttribute("data-sphere", "true");
  // three residues carry a label; the fourth drawn one does not and gets none
  await expect(canvas).toHaveAttribute("data-labels", "3");

  const legend = page.getByTestId("structure-legend");
  await expect(legend).toContainText("very high (> 90)");
  await expect(legend).toContainText("very low (≤ 50)");
  await expect(legend).toContainText("case and control");
  await expect(legend).toContainText("within 8 Å of residue 20");
  await expect(legend).toContainText("1 of 5 listed residues are outside this model");

  const footer = page.getByTestId("structure-footer");
  await expect(footer).toContainText("Predicted structure from the AlphaFold Protein Structure Database");
  await expect(footer).toContainText("CC-BY 4.0");

  // the box takes the width it is allowed, with or without a legend to stretch it
  const widths = await viewer.evaluate((el) => {
    const parent = el.parentElement!;
    const style = getComputedStyle(parent);
    return {
      own: el.getBoundingClientRect().width,
      available: parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    };
  });
  expect(widths.own).toBeCloseTo(Math.min(760, widths.available), 0);
  expect(widths.own).toBeGreaterThan(500);

  // let the camera settle so the saved frame is the final one
  await page.waitForTimeout(1500);
  await viewer.scrollIntoViewIfNeeded();
  await snapshot(page, "structure-view-01-rendered");
  await viewer.screenshot({ path: path.join("e2e", ".output", "screenshots", "structure-view-02-viewer.png") });

  // hovering a residue names it: sweep the pointer over the canvas until it meets one
  const box = (await canvas.boundingBox())!;
  const hover = page.getByTestId("structure-hover");
  // picking is asynchronous and slow under software GL, so each stop waits for it
  sweep: for (const y of [0.5, 0.4, 0.6, 0.3, 0.7]) {
    for (let x = 0.3; x <= 0.7; x += 0.04) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 3 });
      await page.waitForTimeout(300);
      if (await hover.count()) break sweep;
    }
  }
  await expect(hover).toHaveText(/^[A-Z]{3} \d+( · p\.\w+)?$/);

  const download = page.waitForEvent("download");
  await footer.getByRole("button", { name: "Download the view spec" }).click();
  expect((await download).suggestedFilename()).toBe("s100a1.structure-view.json");

  const chunks = harness.molstarChunks();
  expect(chunks).toHaveLength(1);
  // Mol* is MIT: the notice has to be in the file that carries the code
  const chunk = readFileSync(path.join(STATIC, chunks[0]), "utf8");
  expect(chunk).toContain("Mol* contributors");
  expect(chunk).toContain("Permission is hereby granted, free of charge");
  await noViolations(harness);
});

test("an invalid view-spec shows a message and never fetches Mol*", async ({ page }) => {
  const harness = await open(page, "invalid");

  const message = page.getByTestId("structure-view-invalid");
  await expect(message).toBeVisible({ timeout: 30_000 });
  await expect(message).toContainText("broken.structure-view.json cannot be shown");
  await expect(message).toContainText("model_file_id");
  await expect(page.getByTestId("structure-canvas")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download the view spec" })).toBeVisible();
  await expect(page.getByText("That is all.")).toBeVisible();

  expect(harness.molstarChunks()).toHaveLength(0);
  expect(harness.requested.filter((p) => p.includes("/protein_structure/"))).toHaveLength(0);
  await noViolations(harness);
});

test.describe("in a transcript that scrolls", () => {
  // the transcript pane is what is left under the page header and above the input bar: at
  // this height it is taller than a viewer, so a whole canvas can be on screen
  test.use({ viewport: { width: 1280, height: 1000 } });

  // the nearest ancestor that actually scrolls, wherever the chat layout puts it
  const scrollTop = (el: Locator) =>
    el.evaluate((node) => {
      let p: HTMLElement | null = node.parentElement;
      while (p && !(p.scrollHeight > p.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(p).overflowY))) {
        p = p.parentElement;
      }
      return (p ?? document.scrollingElement!).scrollTop;
    });

  test("a viewer never scrolled to fetches neither the model nor Mol*", async ({ page }) => {
    const harness = await open(page, "buried");
    const viewer = page.getByTestId("structure-viewer");
    await expect(viewer).toBeAttached({ timeout: 30_000 });
    await expect(page.getByText("Paragraph 59 of narration.").first()).toBeAttached();
    await page.waitForTimeout(2000);
    expect(harness.molstarChunks()).toHaveLength(0);
    expect(harness.requested.filter((p) => p.includes("/protein_structure/"))).toHaveLength(0);

    await viewer.scrollIntoViewIfNeeded();
    await ready(page.getByTestId("structure-canvas"));
    expect(harness.molstarChunks()).toHaveLength(1);
  });

  test("the wheel scrolls the page, and zooms only with Ctrl held", async ({ page }) => {
    const harness = await open(page, "buried");
    const viewer = page.getByTestId("structure-viewer");
    await expect(viewer).toBeAttached({ timeout: 30_000 });
    await viewer.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const canvas = page.getByTestId("structure-canvas");
    await ready(canvas);
    await expect(page.getByTestId("structure-hint")).toHaveText(/Ctrl or ⌘ \+ scroll to zoom/);
    await page.waitForTimeout(1000);

    // every wheel event, seen before anything can stop it, and whether it ended up cancelled
    await page.evaluate(() => {
      const log: WheelEvent[] = [];
      (window as unknown as { __wheel: WheelEvent[] }).__wheel = log;
      window.addEventListener("wheel", (e) => log.push(e), { capture: true });
    });
    const wheelLog = () =>
      page.evaluate(() =>
        (window as unknown as { __wheel: WheelEvent[] }).__wheel.map((e) => ({
          onCanvas: e.target instanceof HTMLCanvasElement,
          cancelled: e.defaultPrevented,
        })),
      );

    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const top = await scrollTop(viewer);

    await page.mouse.wheel(0, 60);
    await expect.poll(() => scrollTop(viewer)).toBeGreaterThan(top);
    expect(await wheelLog()).toEqual([{ onCanvas: true, cancelled: false }]);

    // the pointer stays put from here on, so the only thing that can change the frame is the
    // camera. The frame is taken before the position is read: a screenshot scrolls its element
    // fully into view first
    await page.waitForTimeout(1000);
    const frame = await canvas.screenshot();
    await page.waitForTimeout(500);
    const before = { top: await scrollTop(viewer), frame };
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 240);
    await page.keyboard.up("Control");
    await page.waitForTimeout(1000);
    expect((await wheelLog()).at(-1)).toEqual({ onCanvas: true, cancelled: true });
    expect(await scrollTop(viewer)).toBe(before.top);
    expect((await canvas.screenshot()).equals(before.frame)).toBe(false);
    await noViolations(harness);
  });

  test("many viewers hold WebGL contexts only near the viewport, and say so when one is lost", async ({ page }) => {
    const harness = await open(page, "many");
    const viewers = page.getByTestId("structure-viewer");
    await expect(viewers).toHaveCount(12, { timeout: 30_000 });
    const live = page.locator('[data-testid="structure-canvas"] canvas');
    await expect.poll(() => live.count(), { timeout: 90_000 }).toBeGreaterThan(0);
    // several build at once under software GL; wait for all of them to finish
    await expect(page.locator('[data-testid="structure-canvas"][data-state="rendering"]')).toHaveCount(0, {
      timeout: 120_000,
    });
    expect(await live.count()).toBeLessThan(12);

    // the viewer furthest from wherever the chat opened has never been built
    const states = await viewers.evaluateAll((els) =>
      els.map((el) => el.querySelector('[data-testid="structure-canvas"]')?.getAttribute("data-state") ?? "unseen"),
    );
    const far = states[0] === "ready" ? 11 : 0;
    expect(["unseen", "parked"]).toContain(states[far]);
    await viewers.nth(far).evaluate((el) => el.scrollIntoView({ block: "center" }));
    const canvas = viewers.nth(far).getByTestId("structure-canvas");
    await ready(canvas);
    // and the one at the other end has given its context back
    await expect(viewers.nth(11 - far).getByTestId("structure-canvas")).toHaveAttribute("data-state", "parked");
    expect(await live.count()).toBeLessThan(12);

    await canvas.locator("canvas").evaluate((el) => {
      const gl = (el as HTMLCanvasElement).getContext("webgl2") ?? (el as HTMLCanvasElement).getContext("webgl");
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    });
    await expect(viewers.nth(far).getByText(/released this structure's 3D drawing context/)).toBeVisible();
    await expect(viewers.nth(far).getByRole("button", { name: "Download the view spec" })).toBeVisible();
    await viewers.nth(far).getByRole("button", { name: "Show again" }).click();
    await ready(canvas);
    await noViolations(harness);
  });
});
