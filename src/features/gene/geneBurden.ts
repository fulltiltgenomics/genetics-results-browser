import { GeneBurdenRow } from "@/types/types.normalized";
import { BurdenMaskMode, BurdenTraitType } from "@/store/store.geneEvidence";
import { datasetDisplayName, formatTraitName } from "../table/utils/tableutil";

/**
 * Row selection and plot geometry for the gene burden tab, kept pure so the table, the plot and the
 * download all show the same rows and the logic is tested without a canvas.
 */

// burden significance cut, as -log10(p): the threshold genebass is pre-filtered at upstream
export const BURDEN_MLOG10P_MIN = 4;

// no burden dataset reports a control count for a quantitative trait, and none carries an explicit
// trait type on the row; a binary trait served without n_controls would be misread here
export const isQuantitativeTrait = (r: GeneBurdenRow): boolean => r.nControls == null;

// trait names repeat across datasets, and within genebass across codings of one field
const traitKey = (r: GeneBurdenRow): string => `${r.dataset}|${r.traitOriginal}`;

const mlog10p = (r: GeneBurdenRow): number => r.mlog10pBurden ?? -Infinity;

export interface BurdenFilters {
  traitType: BurdenTraitType;
  maskMode: BurdenMaskMode;
  search: string;
}

// matched against what the table shows as well as the raw ids, so "ibd exome" and "ibd_exome" both hit
const searchText = (r: GeneBurdenRow): string =>
  [r.trait, formatTraitName(r.trait), r.dataset, datasetDisplayName(r.dataset), r.annotation]
    .join("\n")
    .toLowerCase();

/**
 * The search runs before the top mask is picked, so "pLoF" with top-mask-only gives each trait's
 * best pLoF mask rather than dropping every trait whose overall best mask is another one.
 */
export const filterBurdenRows = (
  rows: GeneBurdenRow[],
  { traitType, maskMode, search }: BurdenFilters
): GeneBurdenRow[] => {
  const needle = search.trim().toLowerCase();
  const kept = rows.filter(
    (r) =>
      mlog10p(r) > BURDEN_MLOG10P_MIN &&
      (traitType === "all" || (traitType === "quantitative") === isQuantitativeTrait(r)) &&
      (needle === "" || searchText(r).includes(needle))
  );
  if (maskMode === "all") {
    return kept;
  }
  // compared on -log10(p), not p, which underflows to 0 and would tie the strongest masks
  const top = new Map<string, GeneBurdenRow>();
  for (const r of kept) {
    const best = top.get(traitKey(r));
    if (!best || mlog10p(r) > mlog10p(best)) {
      top.set(traitKey(r), r);
    }
  }
  return kept.filter((r) => top.get(traitKey(r)) === r);
};

const STOPWORDS = new Set(
  "the and for with without not other from into than that this both sexes self reported first code custom type non per due date age mean median weighted left right main secondary".split(
    " "
  )
);

/** The word most traits share, as a search example; null when no word is shared by two traits. */
export const mostCommonTraitWord = (rows: GeneBurdenRow[]): string | null => {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(traitKey(r))) {
      continue;
    }
    seen.add(traitKey(r));
    const words = formatTraitName(r.trait).toLowerCase().match(/[a-z]{4,}/g) ?? [];
    for (const w of new Set(words)) {
      if (!STOPWORDS.has(w)) {
        counts.set(w, (counts.get(w) ?? 0) + 1);
      }
    }
  }
  let best: string | null = null;
  for (const [w, n] of counts) {
    if (n > 1 && n > (best ? counts.get(best)! : 0)) {
      best = w;
    }
  }
  return best;
};

/**
 * Datasets in plot order: fewest traits tested first, so a single-disease study is not lost behind
 * a biobank-wide one. A dataset of unknown size goes last.
 */
export const orderBurdenDatasets = (
  rows: GeneBurdenRow[],
  sizes: Record<string, number> | undefined
): string[] => {
  const resourceOf = new Map(rows.map((r) => [r.dataset, r.resource]));
  const size = (dataset: string) => sizes?.[resourceOf.get(dataset) ?? ""] ?? Infinity;
  return [...resourceOf.keys()].sort((a, b) =>
    size(a) === size(b) ? a.localeCompare(b) : size(a) - size(b)
  );
};

// largest |beta| first in a descending sort, missing betas last
export const absBetaSort = (
  a: { original: GeneBurdenRow },
  b: { original: GeneBurdenRow }
): number => {
  const abs = (r: GeneBurdenRow) =>
    r.beta == null || Number.isNaN(r.beta) ? -Infinity : Math.abs(r.beta);
  const [x, y] = [abs(a.original), abs(b.original)];
  return x === y ? 0 : x - y;
};

export interface BurdenPoint {
  x: number;
  y: number;
  row: GeneBurdenRow;
  radius: number;
  // null when the row has no beta; drawn as a circle
  direction: "up" | "down" | null;
}

export type BurdenScale = "binary" | "quantitative";

// one stretch of the x axis: the binary or the quantitative traits of one dataset
export interface BurdenBand {
  dataset: string;
  scale: BurdenScale;
  start: number;
  end: number;
}

export const BURDEN_MIN_RADIUS = 4;
export const BURDEN_MAX_RADIUS = 13;

const scaleOf = (r: GeneBurdenRow): BurdenScale =>
  isQuantitativeTrait(r) ? "quantitative" : "binary";

/**
 * PheWAS-style layout: per dataset a band of binary traits then one of quantitative traits, the
 * traits inside a band ordered strongest first, the masks of one trait stacked at the same x.
 *
 * `datasets` is the gene's full dataset list rather than the filtered rows' so a dataset keeps its
 * position (and its colour) when a filter empties another one.
 */
export const buildBurdenPoints = (
  rows: GeneBurdenRow[],
  datasets: string[]
): { points: BurdenPoint[]; bands: BurdenBand[] } => {
  // betas of binary (log odds) and quantitative traits are on different scales, so each is sized
  // against its own maximum; otherwise every quantitative triangle collapses to the minimum
  const maxAbsBeta = { binary: 0, quantitative: 0 };
  for (const r of rows) {
    if (r.beta != null) {
      maxAbsBeta[scaleOf(r)] = Math.max(maxAbsBeta[scaleOf(r)], Math.abs(r.beta));
    }
  }

  const traitsByBand = new Map<string, Map<string, GeneBurdenRow[]>>();
  const bandKey = (dataset: string, scale: BurdenScale) => `${dataset}|${scale}`;
  for (const r of rows) {
    const key = bandKey(r.dataset, scaleOf(r));
    const traits = traitsByBand.get(key) ?? new Map<string, GeneBurdenRow[]>();
    traitsByBand.set(key, traits);
    traits.set(traitKey(r), [...(traits.get(traitKey(r)) ?? []), r]);
  }

  // a band is never narrower than this, or a one-trait band has no room for its axis label
  const nTraits = [...traitsByBand.values()].reduce((n, t) => n + t.size, 0);
  const minBand = Math.max(3, nTraits * 0.08);
  const strongest = (traitRows: GeneBurdenRow[]) => Math.max(...traitRows.map(mlog10p));

  const points: BurdenPoint[] = [];
  const bands: BurdenBand[] = [];
  let start = 0;
  for (const dataset of datasets) {
    for (const scale of ["binary", "quantitative"] as const) {
      const traits = [...(traitsByBand.get(bandKey(dataset, scale))?.values() ?? [])].sort(
        (a, b) => strongest(b) - strongest(a)
      );
      if (traits.length === 0) {
        continue;
      }
      const width = Math.max(traits.length, minBand);
      traits.forEach((traitRows, i) => {
        const x = start + ((i + 0.5) * width) / traits.length;
        for (const row of traitRows) {
          const max = maxAbsBeta[scale];
          // area, not radius, proportional to |beta|; floored so a small effect stays hoverable
          const radius =
            row.beta == null || max === 0
              ? BURDEN_MIN_RADIUS
              : Math.max(
                  BURDEN_MIN_RADIUS,
                  BURDEN_MAX_RADIUS * Math.sqrt(Math.abs(row.beta) / max)
                );
          points.push({
            x,
            y: row.mlog10pBurden!,
            row,
            radius,
            direction: row.beta == null ? null : row.beta >= 0 ? "up" : "down",
          });
        }
      });
      bands.push({ dataset, scale, start, end: start + width });
      start += width;
    }
  }
  return { points, bands };
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Greedy label placement, strongest candidate first: a label goes to the right of its point, else
 * to the left, and is dropped when both spots leave the plot or cover a point or an earlier label.
 */
export const placeLabels = <T extends { x: number; y: number; radius: number; w: number }>(
  candidates: T[],
  obstacles: Rect[],
  area: Rect,
  height: number
): { candidate: T; rect: Rect }[] => {
  const taken = [...obstacles];
  const placed: { candidate: T; rect: Rect }[] = [];
  for (const c of candidates) {
    const y = c.y - height / 2;
    const spots = [c.x + c.radius + 3, c.x - c.radius - 3 - c.w].map((x) => ({
      x,
      y,
      w: c.w,
      h: height,
    }));
    const rect = spots.find(
      (s) =>
        s.x >= area.x &&
        s.x + s.w <= area.x + area.w &&
        s.y >= area.y &&
        s.y + s.h <= area.y + area.h &&
        !taken.some((t) => overlaps(s, t))
    );
    if (rect) {
      taken.push(rect);
      placed.push({ candidate: c, rect });
    }
  }
  return placed;
};
