// client-side mirror of genetics-mcp-server analysis_timeseries.build_all_series.
// the rolling centered-window math must stay byte-for-byte equivalent to the
// backend so the PNG plots and these JS plots cannot drift. keep this pure and
// dependency-free (no chart.js imports) so it stays unit-testable.

import type { QualityRow } from "./adminApi";

export const SCORES = [1, 2, 3, 4, 5] as const;

// every success_label bucket (quality labels + non-quality disposition buckets +
// unknown), plotted together as a share of all conversations. mirrors
// analysis_timeseries.DISPOSITION_LABELS.
export const DISPOSITION_LABELS = [
  "successful",
  "neutral",
  "unsuccessful",
  "technical_failure",
  "out_of_scope",
  "unfinished",
  "weird_or_unclear",
  "unknown",
] as const;

// fixed issue taxonomy, mirrors conversation_prompts.ISSUE_CATEGORIES (category
// names only). keep in sync with the backend taxonomy.
export const ISSUE_CATEGORY_NAMES = [
  "incomplete_answer",
  "missed_data_source",
  "inaccurate_claim",
  "fabrication",
  "inefficient_tool_use",
  "tool_failure_handling",
  "misunderstood_question",
  "no_conclusion",
  "missing_interpretation",
  "formatting_readability",
  "overcautious",
  "other",
] as const;

// dispositions that are not agent-quality failures; excluded from the score
// trend so out-of-scope / unfinished / weird / technical conversations don't
// skew it. empty disposition (pre-disposition records) is kept.
const NON_QUALITY_DISPOSITIONS = new Set([
  "technical_failure",
  "out_of_scope",
  "unfinished",
  "weird_or_unclear",
]);

export interface SeriesPanel {
  dates: string[];
  series: Record<string, (number | null)[]>;
}

export interface MeanAndVolumePanel extends SeriesPanel {
  ciLow: (number | null)[];
  ciHigh: (number | null)[];
  volume: number[];
}

export interface QualitySeriesMeta {
  empty: boolean;
  skippedNoDate: number;
  total: number;
  scored: number;
  dateMin: string | null;
  dateMax: string | null;
  window: number;
  minN: number;
}

export interface AllSeries {
  scoreShare: SeriesPanel;
  meanAndVolume: MeanAndVolumePanel;
  dispositionMix: SeriesPanel;
  issueCategoryMix: SeriesPanel;
  meta: QualitySeriesMeta;
}

interface PreparedRow extends QualityRow {
  // days since epoch (UTC midnight) — integer day index for window math
  dayIndex: number;
  isoDate: string;
}

const MS_PER_DAY = 86_400_000;

// parse a created_at value into a UTC day index (days since epoch) + iso date.
// accepts "YYYY-MM-DD HH:MM:SS", ISO, or bare date. null if unparseable.
function parseDay(value: string | null | undefined): { dayIndex: number; iso: string } | null {
  if (!value) return null;
  const text = String(value).trim();
  // take just the leading YYYY-MM-DD so timezone/format noise can't shift the
  // day, matching the backend which buckets on calendar date.
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(ms)) return null;
  const iso = `${y}-${mo}-${d}`;
  return { dayIndex: Math.round(ms / MS_PER_DAY), iso };
}

function isoFromDayIndex(dayIndex: number): string {
  const date = new Date(dayIndex * MS_PER_DAY);
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function prepareRows(rows: QualityRow[]): { prepared: PreparedRow[]; skipped: number } {
  const prepared: PreparedRow[] = [];
  let skipped = 0;
  for (const r of rows) {
    const parsed = parseDay(r.createdAt);
    if (parsed === null) {
      skipped += 1;
      continue;
    }
    prepared.push({ ...r, dayIndex: parsed.dayIndex, isoDate: parsed.iso });
  }
  prepared.sort((a, b) => a.dayIndex - b.dayIndex);
  return { prepared, skipped };
}

// conversations that count toward the agent-quality score trend (integer score
// and a quality-relevant disposition). mirrors analysis_timeseries._scored.
function scored(rows: PreparedRow[]): PreparedRow[] {
  return rows.filter(
    (r) =>
      typeof r.llmQualityScore === "number" &&
      Number.isInteger(r.llmQualityScore) &&
      !NON_QUALITY_DISPOSITIONS.has(r.llmDisposition ?? "")
  );
}

// for each day in the inclusive grid, the records inside the centered window
// [day - w//2, day + w//2]. callback receives the window members per day.
function rollingWindows(
  rows: PreparedRow[],
  grid: number[],
  windowDays: number,
  fn: (members: PreparedRow[]) => void
): void {
  const half = Math.floor(windowDays / 2);
  for (const center of grid) {
    const members = rows.filter(
      (r) => r.dayIndex >= center - half && r.dayIndex <= center + half
    );
    fn(members);
  }
}

function scoreShareSeries(
  rows: PreparedRow[],
  grid: number[],
  window: number,
  minN: number
): SeriesPanel {
  const series: Record<string, (number | null)[]> = {};
  for (const s of SCORES) series[String(s)] = [];
  rollingWindows(rows, grid, window, (members) => {
    const sc = scored(members);
    const n = sc.length;
    if (n < minN) {
      for (const s of SCORES) series[String(s)].push(null);
      return;
    }
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of sc) {
      const v = r.llmQualityScore as number;
      if (v in counts) counts[v] += 1;
    }
    for (const s of SCORES) series[String(s)].push((100 * counts[s]) / n);
  });
  return { dates: grid.map(isoFromDayIndex), series };
}

function meanScoreAndVolumeSeries(
  rows: PreparedRow[],
  grid: number[],
  window: number,
  minN: number
): MeanAndVolumePanel {
  const means: (number | null)[] = [];
  const ciLow: (number | null)[] = [];
  const ciHigh: (number | null)[] = [];
  const volume: number[] = [];
  rollingWindows(rows, grid, window, (members) => {
    const sc = scored(members);
    volume.push(sc.length);
    if (sc.length < minN) {
      means.push(null);
      ciLow.push(null);
      ciHigh.push(null);
      return;
    }
    const vals = sc.map((r) => r.llmQualityScore as number);
    const n = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    let sem = 0;
    if (n > 1) {
      const variance = vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1);
      sem = Math.sqrt(variance) / Math.sqrt(n);
    }
    means.push(mean);
    ciLow.push(mean - 1.96 * sem);
    ciHigh.push(mean + 1.96 * sem);
  });
  return { dates: grid.map(isoFromDayIndex), series: { mean: means }, ciLow, ciHigh, volume };
}

function dispositionMixSeries(
  rows: PreparedRow[],
  grid: number[],
  window: number,
  minN: number
): SeriesPanel {
  const series: Record<string, (number | null)[]> = {};
  for (const lab of DISPOSITION_LABELS) series[lab] = [];
  rollingWindows(rows, grid, window, (members) => {
    const n = members.length;
    if (n < minN) {
      for (const lab of DISPOSITION_LABELS) series[lab].push(null);
      return;
    }
    const counts: Record<string, number> = {};
    for (const lab of DISPOSITION_LABELS) counts[lab] = 0;
    for (const r of members) {
      const lab = r.successLabel ?? "";
      if (lab in counts) counts[lab] += 1;
    }
    for (const lab of DISPOSITION_LABELS) series[lab].push((100 * counts[lab]) / n);
  });
  return { dates: grid.map(isoFromDayIndex), series };
}

function issueCategoryMixSeries(
  rows: PreparedRow[],
  grid: number[],
  window: number,
  minN: number
): SeriesPanel {
  const series: Record<string, (number | null)[]> = {};
  for (const c of ISSUE_CATEGORY_NAMES) series[c] = [];
  rollingWindows(rows, grid, window, (members) => {
    // dedup per conversation so one conversation counts a category once
    const instances: string[] = [];
    for (const r of members) {
      for (const c of new Set(r.issueCategories ?? [])) instances.push(c);
    }
    const total = instances.length;
    if (total < minN) {
      for (const c of ISSUE_CATEGORY_NAMES) series[c].push(null);
      return;
    }
    const counts: Record<string, number> = {};
    for (const c of ISSUE_CATEGORY_NAMES) counts[c] = 0;
    for (const c of instances) {
      if (c in counts) counts[c] += 1;
    }
    for (const c of ISSUE_CATEGORY_NAMES) series[c].push((100 * counts[c]) / total);
  });
  return { dates: grid.map(isoFromDayIndex), series };
}

// compute all four quality panels from raw rows in one call. mirrors
// analysis_timeseries.build_all_series: rows are date-parsed + sorted, the grid
// spans the full observed date range, windows below minN yield null gaps.
export function buildAllSeries(
  rows: QualityRow[],
  { window = 7, minN = 3 }: { window?: number; minN?: number } = {}
): AllSeries {
  const { prepared, skipped } = prepareRows(rows);
  if (prepared.length === 0) {
    const empty: SeriesPanel = { dates: [], series: {} };
    return {
      scoreShare: empty,
      meanAndVolume: { ...empty, ciLow: [], ciHigh: [], volume: [] },
      dispositionMix: { dates: [], series: {} },
      issueCategoryMix: { dates: [], series: {} },
      meta: {
        empty: true,
        skippedNoDate: skipped,
        total: 0,
        scored: 0,
        dateMin: null,
        dateMax: null,
        window,
        minN,
      },
    };
  }

  const minDay = prepared[0].dayIndex;
  const maxDay = prepared[prepared.length - 1].dayIndex;
  const grid: number[] = [];
  for (let d = minDay; d <= maxDay; d++) grid.push(d);

  return {
    scoreShare: scoreShareSeries(prepared, grid, window, minN),
    meanAndVolume: meanScoreAndVolumeSeries(prepared, grid, window, minN),
    dispositionMix: dispositionMixSeries(prepared, grid, window, minN),
    issueCategoryMix: issueCategoryMixSeries(prepared, grid, window, minN),
    meta: {
      empty: false,
      skippedNoDate: skipped,
      total: prepared.length,
      scored: scored(prepared).length,
      dateMin: isoFromDayIndex(minDay),
      dateMax: isoFromDayIndex(maxDay),
      window,
      minN,
    },
  };
}
