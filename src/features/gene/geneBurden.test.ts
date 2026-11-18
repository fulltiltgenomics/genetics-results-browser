import { describe, expect, it } from "vitest";
import { GeneBurdenRow } from "@/types/types.normalized";
import {
  BURDEN_MAX_RADIUS,
  BURDEN_MIN_RADIUS,
  buildBurdenPoints,
  filterBurdenRows,
  mostCommonTraitWord,
  orderBurdenDatasets,
  placeLabels,
} from "./geneBurden";

const row = (over: Partial<GeneBurdenRow> = {}): GeneBurdenRow => ({
  dataset: "genebass",
  trait: "LDL",
  gene: "PCSK9",
  geneId: "ENSG00000169174",
  annotation: "pLoF",
  mlog10pBurden: 10,
  beta: -0.5,
  se: 0.01,
  totalVariants: 10,
  totalVariantsPheno: 10,
  nCases: 1000,
  nControls: null,
  traitOriginal: over.trait ?? "LDL",
  flags: "NA",
  resource: (over.dataset ?? "genebass").toLowerCase(),
  ...over,
});

const all = { traitType: "all", maskMode: "all", search: "" } as const;

describe("filterBurdenRows", () => {
  it("drops rows at or below the significance cut and rows without a p-value", () => {
    const rows = [row(), row({ mlog10pBurden: 4 }), row({ mlog10pBurden: null })];
    expect(filterBurdenRows(rows, all)).toEqual([rows[0]]);
  });

  it("keeps the same trait name in two datasets, and two codings of one trait, apart", () => {
    const rows = [
      row({ dataset: "genebass", mlog10pBurden: 9 }),
      row({ dataset: "BRaVa", mlog10pBurden: 8 }),
      row({ trait: "medication", traitOriginal: "categorical_20003_1", mlog10pBurden: 7 }),
      row({ trait: "medication", traitOriginal: "categorical_20003_2", mlog10pBurden: 6 }),
    ];
    expect(filterBurdenRows(rows, { ...all, maskMode: "top" })).toEqual(rows);
  });

  it("separates masks whose p-values would both underflow to 0", () => {
    const rows = [row({ mlog10pBurden: 400 }), row({ annotation: "missense", mlog10pBurden: 900 })];
    expect(filterBurdenRows(rows, { ...all, maskMode: "top" })).toEqual([rows[1]]);
  });
});

describe("search", () => {
  const rows = [
    row({ trait: "LDL_cholesterol" }),
    row({ dataset: "IBD_exome", trait: "crohns", annotation: "missense" }),
  ];
  const found = (search: string) => filterBurdenRows(rows, { ...all, search });

  it("matches trait, dataset and mask, case-insensitively, as shown or as served", () => {
    expect(found("ldl chol")).toEqual([rows[0]]);
    expect(found("LDL_CHOL")).toEqual([rows[0]]);
    expect(found("ibd exome")).toEqual([rows[1]]);
    expect(found("plof")).toEqual([rows[0]]);
    expect(found("nothing")).toEqual([]);
  });

  it("does not match across two fields", () => {
    expect(found("cholesterolgenebass")).toEqual([]);
  });
});

describe("mostCommonTraitWord", () => {
  it("counts a word once per trait, ignoring filler words and the masks of one trait", () => {
    const rows = [
      row({ trait: "Mean left cholesterol code" }),
      row({ trait: "Mean left ventricle" }),
      row({ trait: "Mean left atrium" }),
      row({ trait: "LDL cholesterol" }),
      row({ trait: "Date of first statin code", annotation: "pLoF" }),
      row({ trait: "Date of first statin code", annotation: "missense" }),
    ];
    expect(mostCommonTraitWord(rows)).toBe("cholesterol");
  });

  it("is null when no word is shared", () => {
    expect(mostCommonTraitWord([row({ trait: "LDL cholesterol" })])).toBeNull();
  });
});

describe("orderBurdenDatasets", () => {
  const rows = [
    row({ dataset: "genebass", resource: "genebass" }),
    row({ dataset: "SCHEMA2", resource: "schema2" }),
    row({ dataset: "BRaVa", resource: "brava" }),
    row({ dataset: "Unknown", resource: "unknown" }),
  ];

  it("puts the dataset testing the fewest traits first and an unsized one last", () => {
    expect(orderBurdenDatasets(rows, { genebass: 4529, brava: 280, schema2: 1 })).toEqual([
      "SCHEMA2",
      "BRaVa",
      "genebass",
      "Unknown",
    ]);
  });

  it("falls back to alphabetical while the sizes are not loaded", () => {
    expect(orderBurdenDatasets(rows, undefined)).toEqual(["BRaVa", "genebass", "SCHEMA2", "Unknown"]);
  });
});

describe("buildBurdenPoints", () => {
  const rows = [
    row({ trait: "weak", beta: -0.5, mlog10pBurden: 5 }),
    row({ trait: "strong", beta: 0.125, mlog10pBurden: 6 }),
    row({ trait: "strong", annotation: "missense", beta: null, mlog10pBurden: 50 }),
    row({ dataset: "IBD_exome", trait: "crohns", beta: 2, nControls: 5000 }),
    row({ trait: "statin", beta: 1, nControls: 5000 }),
  ];
  const { points, bands } = buildBurdenPoints(rows, ["IBD_exome", "SCHEMA2", "genebass"]);
  const point = (r: GeneBurdenRow) => points.find((p) => p.row === r)!;

  it("lays out each dataset's binary traits, then its quantitative ones, in dataset order", () => {
    expect(bands.map((b) => [b.dataset, b.scale])).toEqual([
      ["IBD_exome", "binary"],
      ["genebass", "binary"],
      ["genebass", "quantitative"],
    ]);
    expect(bands[0].start).toBe(0);
    expect(bands[1].start).toBe(bands[0].end);
    expect(bands[2].start).toBe(bands[1].end);
    expect(point(rows[4]).x).toBeLessThan(bands[1].end);
    expect(point(rows[0]).x).toBeGreaterThan(bands[2].start);
  });

  it("orders traits inside a band by their strongest mask and stacks the masks of one trait", () => {
    expect(point(rows[1]).x).toBe(point(rows[2]).x);
    expect(point(rows[1]).x).toBeLessThan(point(rows[0]).x);
  });

  it("points up for a positive beta, down for a negative one, and marks a missing one", () => {
    expect(point(rows[0]).direction).toBe("down");
    expect(point(rows[1]).direction).toBe("up");
    expect(point(rows[2]).direction).toBeNull();
  });

  it("sizes area by |beta| within binary and quantitative traits separately", () => {
    // the binary beta of 2 does not shrink the quantitative maximum of 0.5
    expect(point(rows[0]).radius).toBe(BURDEN_MAX_RADIUS);
    expect(point(rows[3]).radius).toBe(BURDEN_MAX_RADIUS);
    // a quarter of the |beta| is a quarter of the area, so half the radius
    expect(point(rows[1]).radius).toBeCloseTo(BURDEN_MAX_RADIUS / 2);
    expect(point(rows[2]).radius).toBe(BURDEN_MIN_RADIUS);
  });
});

describe("placeLabels", () => {
  const area = { x: 0, y: 0, w: 200, h: 100 };
  const label = (x: number, y: number) => ({ x, y, radius: 5, w: 50 });

  it("puts a label right of its point, or left when the right side leaves the plot", () => {
    const placed = placeLabels([label(20, 50), label(180, 50)], [], area, 10);
    expect(placed.map((p) => p.rect.x)).toEqual([28, 122]);
  });

  it("drops a label that would cover an earlier label or a point", () => {
    const first = label(100, 50);
    expect(placeLabels([first, label(100, 52)], [], { ...area, x: 90 }, 10)).toHaveLength(1);
    const onPoint = [{ x: 110, y: 45, w: 10, h: 10 }];
    expect(placeLabels([first], onPoint, { ...area, x: 90 }, 10)).toEqual([]);
  });
});
