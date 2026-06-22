import { test, expect, Download, Page } from "@playwright/test";

/**
 * End-to-end verification of the re-instated TSV downloads for every annotation table, plus the
 * filter/sort behaviour reflected IN those downloads. Requires the full dev stack
 * (genetics-results-api :2000, BFF :5000, vite :3000) and drives real data.
 *
 * APOE rs429358 (19-44908684-T-C) is the single-variant fixture: multi-resource, multi-data-type
 * (GWAS/pQTL/eQTL/caQTL), so it exercises every column path. A two-variant WITH-betas input drives
 * the phenotype-summary direction columns + the beta grid.
 */

const SINGLE = "19-44908684-T-C";
const MULTI_WITH_BETAS = "19-44908684-T-C\t0.5\tlipids\n19-45869791-ATT-A\t0.3\tlipids";

const fillInput = async (page: Page, value: string): Promise<void> => {
  await page.getByLabel(/Paste GRCh38 variant ids/i).fill(value);
  await page.getByRole("button", { name: /annotate/i }).click();
};

const readDownload = async (download: Download): Promise<string> => {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
};

interface Tsv {
  filename: string;
  headers: string[];
  rows: string[][];
  // value at (rowIndex, columnName)
  cell: (row: number, col: string) => string;
}

const parseTsv = (filename: string, content: string): Tsv => {
  const lines = content.replace(/\r/g, "").replace(/\n+$/, "").split("\n");
  const headers = lines[0].split("\t");
  const rows = lines.slice(1).map((l) => l.split("\t"));
  return {
    filename,
    headers,
    rows,
    cell: (row, col) => rows[row][headers.indexOf(col)],
  };
};

// click a download button by its visible label, capture the file, and parse it as TSV.
const download = async (page: Page, buttonName: string): Promise<Tsv> => {
  const button = page.getByRole("button", { name: buttonName, exact: true });
  await expect(button, `download button "${buttonName}" should be enabled`).toBeEnabled({
    timeout: 20_000,
  });
  const downloadPromise = page.waitForEvent("download");
  await button.click();
  const dl = await downloadPromise;
  return parseTsv(dl.suggestedFilename(), await readDownload(dl));
};

const column = (tsv: Tsv, col: string): string[] => {
  const i = tsv.headers.indexOf(col);
  return tsv.rows.map((r) => r[i]);
};

test.describe("annotation table downloads", () => {
  test("single-variant: variant results, credible sets, data type, tissue, phenotype search", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.goto("/annotate");
    await fillInput(page, SINGLE);
    await expect(page.getByText("19:44908684:T:C", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("rs429358")).toBeVisible();

    // ── Variant results table ──────────────────────────────────────────────────
    const variants = await download(page, "download variants table");
    expect(variants.filename).toMatch(/^variant_annotation_1_variants_[0-9a-f]{7}\.txt$/);
    expect(variants.headers).toEqual([
      "variant",
      "rsid",
      "global_af",
      "most_severe",
      "most_severe_gene",
      "traits",
      "traits_up",
      "traits_down",
      "top_association",
      "p-value",
      "beta",
    ]);
    expect(variants.rows).toHaveLength(1);
    expect(variants.cell(0, "variant")).toBe("19-44908684-T-C");
    expect(variants.cell(0, "rsid")).toBe("rs429358");
    expect(variants.cell(0, "most_severe_gene")).toBe("APOE");
    // traits column is a positive integer; up + down <= total distinct traits
    expect(Number(variants.cell(0, "traits"))).toBeGreaterThan(0);
    expect(Number(variants.cell(0, "beta"))).not.toBeNaN();

    // ── Credible-set / fine-mapping results (flattened per membership) ──────────
    const cs = await download(page, "download credible-set results");
    expect(cs.headers).toEqual([
      "variant",
      "rsid",
      "global_af",
      "most_severe",
      "most_severe_gene",
      "type",
      "resource",
      "dataset",
      "trait",
      "trait_id",
      "cis_trans",
      "cell_type",
      "p-value",
      "beta",
      "pip",
      "cs_size",
      "cs_min_r2",
    ]);
    expect(cs.rows.length).toBeGreaterThan(0);
    // every row is for the queried variant, and the type is from the credible-set vocabulary
    expect(new Set(column(cs, "variant"))).toEqual(new Set(["19-44908684-T-C"]));
    const validTypes = new Set(["GWAS", "eQTL", "pQTL", "sQTL", "caQTL", "edQTL", "metaboQTL"]);
    for (const t of column(cs, "type")) expect(validTypes.has(t)).toBe(true);
    for (const p of column(cs, "pip")) if (p !== "NA") expect(Number(p)).not.toBeNaN();

    // ── Data type comparison: total must equal the sum of the per-type counts ───
    await page.getByRole("tab", { name: /data type comparison/i }).click();
    await expect(page.getByText("total CS")).toBeVisible({ timeout: 15_000 });
    const dt = await download(page, "download data type comparison");
    expect(dt.headers).toEqual([
      "variant",
      "rsid",
      "global_af",
      "most_severe",
      "most_severe_gene",
      "GWAS_CS",
      "eQTL_CS",
      "pQTL_CS",
      "sQTL_CS",
      "caQTL_CS",
      "total_CS",
    ]);
    expect(dt.rows.length).toBeGreaterThan(0);
    for (let i = 0; i < dt.rows.length; i++) {
      const sum =
        Number(dt.cell(i, "GWAS_CS")) +
        Number(dt.cell(i, "eQTL_CS")) +
        Number(dt.cell(i, "pQTL_CS")) +
        Number(dt.cell(i, "sQTL_CS")) +
        Number(dt.cell(i, "caQTL_CS"));
      expect(sum, `row ${i} total must equal sum of per-type counts`).toBe(
        Number(dt.cell(i, "total_CS"))
      );
    }

    // ── Tissue & cell type summary ──────────────────────────────────────────────
    // APOE's only eQTL CS is an exon-level, sub-threshold row, so the eQTL view is legitimately
    // empty (download disabled); its caQTL view has two cell types. validate caQTL fully and assert
    // the eQTL download is correctly disabled-when-empty.
    await page.getByRole("tab", { name: /tissue and cell type summary/i }).click();
    await expect(page.getByRole("button", { name: "eQTL" })).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: "download tissue summary table", exact: true })
    ).toBeDisabled();

    await page.getByRole("button", { name: "caQTL" }).click();
    await page.waitForTimeout(500);
    const tissueC = await download(page, "download tissue summary table");
    expect(tissueC.headers).toEqual(["tissue", "type", "variants"]);
    expect(tissueC.filename).toContain("caQTL");
    expect(tissueC.rows.length).toBeGreaterThan(0);
    expect(new Set(column(tissueC, "type"))).toEqual(new Set(["caQTL"]));

    const tissueCWith = await download(page, "download tissue table with variants");
    expect(tissueCWith.headers).toEqual([
      "tissue",
      "variant",
      "rsid",
      "global_af",
      "most_severe",
      "most_severe_gene",
      "type",
      "dataset",
      "trait",
      "p-value",
      "beta",
      "pip",
    ]);
    expect(tissueCWith.rows.length).toBeGreaterThan(0);
    expect(new Set(column(tissueCWith, "variant"))).toEqual(new Set(["19-44908684-T-C"]));

    // ── Phenotype search: pick Alzheimer's (finngen GWAS, sumstats-capable) ─────
    await page.getByRole("tab", { name: /phenotype search/i }).click();
    const search = page.getByLabel(/search phenotype/i);
    await search.click();
    await search.fill("alzheimer");
    // pick the first autocomplete option once the /search round-trip resolves
    const firstOption = page.getByRole("option").first();
    await expect(firstOption).toBeVisible({ timeout: 15_000 });
    await firstOption.click();
    const ps = await download(page, "download search results");
    expect(ps.headers).toEqual([
      "variant",
      "rsid",
      "af",
      "most_severe",
      "most_severe_gene",
      "p-value",
      "beta",
      "se",
      "in_credible_set",
      "pip",
    ]);
    expect(ps.rows.length).toBeGreaterThan(0);
    for (const v of column(ps, "in_credible_set")) expect(["yes", "no"]).toContain(v);
    // APOE is THE Alzheimer's variant -> its summary-stat row must be present
    expect(column(ps, "variant")).toContain("19-44908684-T-C");
  });

  test("filter reflected in download: PIP threshold shrinks the credible-set export", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/annotate");
    await fillInput(page, SINGLE);
    await expect(page.getByText("19:44908684:T:C", { exact: true })).toBeVisible({ timeout: 30_000 });

    const csDefault = await download(page, "download credible-set results");
    const defaultCount = csDefault.rows.length;
    expect(defaultCount).toBeGreaterThan(0);
    // every surviving membership must already satisfy the default 0.01 PIP threshold
    for (const p of column(csDefault, "pip")) if (p !== "NA") expect(Number(p)).toBeGreaterThanOrEqual(0.01);

    // raise PIP to 0.9: a strict subset survives (APOE has comparatively few high-PIP memberships)
    await page.getByLabel("PIP threshold").fill("0.9");
    await page.waitForTimeout(600);
    const csStrict = await download(page, "download credible-set results");
    expect(csStrict.rows.length).toBeLessThan(defaultCount);
    for (const p of column(csStrict, "pip")) if (p !== "NA") expect(Number(p)).toBeGreaterThanOrEqual(0.9);
  });

  test("multi-variant betas: phenotype summary table, beta grid, sorting + column filter in export", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/annotate");
    await fillInput(page, MULTI_WITH_BETAS);
    // variant 2's only CS has p=0.15 (> default 0.05 p-value threshold) so it is correctly filtered
    // out of the main table; it still appears as a beta-grid column (all NA) since the store keeps
    // every input variant. so we only wait on variant 1 here.
    await expect(page.getByText("19:44908684:T:C", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("tab", { name: /phenotype summary/i }).click();
    await expect(page.getByText("consistent", { exact: true })).toBeVisible({ timeout: 15_000 });

    // default sort is variantCount desc → the exported "variants" column is non-increasing
    const summary = await download(page, "download phenotype summary table");
    expect(summary.headers).toEqual([
      "type",
      "resource",
      "trait",
      "peak",
      "variants",
      "consistent",
      "opposite",
    ]);
    const counts = column(summary, "variants").map(Number);
    expect(counts.length).toBeGreaterThan(0);
    for (let i = 1; i < counts.length; i++)
      expect(counts[i], "default sort: variants non-increasing").toBeLessThanOrEqual(counts[i - 1]);
    // consistent/opposite are per-membership direction-agreement counts (a variant in several CSs
    // for one trait can contribute >1), so they are non-negative integers, not bounded by variants.
    for (let i = 0; i < summary.rows.length; i++) {
      const c = Number(summary.cell(i, "consistent"));
      const o = Number(summary.cell(i, "opposite"));
      expect(Number.isInteger(c) && c >= 0).toBe(true);
      expect(Number.isInteger(o) && o >= 0).toBe(true);
    }

    // re-sort ascending by the variants column header → exported order flips to non-decreasing.
    // click the header label text (sortDescFirst + initial desc → one click toggles to asc).
    await page.locator("thead").getByText("variants", { exact: true }).click();
    await page.waitForTimeout(600);
    const summaryAsc = await download(page, "download phenotype summary table");
    const ascCounts = column(summaryAsc, "variants").map(Number);
    for (let i = 1; i < ascCounts.length; i++)
      expect(ascCounts[i], "after asc sort: variants non-decreasing").toBeGreaterThanOrEqual(
        ascCounts[i - 1]
      );

    // column filter on "type" = GWAS → the export contains only GWAS rows
    await page.getByPlaceholder("type").first().fill("GWAS");
    await page.waitForTimeout(500);
    const summaryFiltered = await download(page, "download phenotype summary table");
    expect(summaryFiltered.rows.length).toBeGreaterThan(0);
    expect(new Set(column(summaryFiltered, "type"))).toEqual(new Set(["GWAS"]));

    // beta grid: one column per input variant, values are beta or NA
    const grid = await download(page, "download variant/phenotype beta grid");
    expect(grid.headers[0]).toBe("phenotype");
    expect(grid.headers).toContain("19-44908684-T-C");
    expect(grid.headers).toContain("19-45869791-ATT-A");
    expect(grid.rows.length).toBeGreaterThan(0);
    for (const v of column(grid, "19-44908684-T-C"))
      expect(v === "NA" || !Number.isNaN(Number(v))).toBe(true);
  });
});
