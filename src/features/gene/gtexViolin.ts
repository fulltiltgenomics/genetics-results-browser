/**
 * The numbers behind the GTEx violin plot: per tissue the quartiles, the whiskers and outliers of
 * a box plot, and a kernel density estimate for the violin's outline.
 */

export type ViolinScale = "log" | "linear";

// log10(TPM + 1), as on the GTEx portal: a sample at 0 TPM stays on the axis
export const toScale = (tpm: number, scale: ViolinScale): number =>
  scale === "log" ? Math.log10(tpm + 1) : tpm;

export interface TissueStats {
  tissue: string;
  n: number;
  // all in TPM
  median: number;
  q1: number;
  q3: number;
  // the furthest samples within 1.5 IQR of the box
  whiskerLow: number;
  whiskerHigh: number;
  outliers: number[];
}

export interface ViolinStats extends TissueStats {
  // the outline on the scale asked for: `at` from the lowest to the highest sample, `width` in
  // 0..1 of the tissue's own widest point
  density: { at: number; width: number }[];
}

// linear interpolation between the two nearest ranks, as R's default (type 7) and d3 do
export const quantile = (sorted: ArrayLike<number>, p: number): number => {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

const DENSITY_POINTS = 48;

// a gaussian kernel with Silverman's rule-of-thumb bandwidth, over the samples as scaled
const kernelDensity = (scaled: Float64Array): { at: number; width: number }[] => {
  const n = scaled.length;
  const lo = scaled[0];
  const hi = scaled[n - 1];
  if (hi === lo) {
    return [{ at: lo, width: 1 }];
  }
  let mean = 0;
  for (const v of scaled) mean += v / n;
  let variance = 0;
  for (const v of scaled) variance += (v - mean) ** 2 / Math.max(1, n - 1);
  const iqr = quantile(scaled, 0.75) - quantile(scaled, 0.25);
  const spread = Math.min(Math.sqrt(variance), iqr > 0 ? iqr / 1.34 : Infinity);
  // a floor of a hundredth of the range, for a tissue whose samples are nearly all one value
  const bandwidth = Math.max(0.9 * spread * n ** -0.2, (hi - lo) / 100);
  const out: { at: number; width: number }[] = [];
  let top = 0;
  for (let i = 0; i < DENSITY_POINTS; i++) {
    const at = lo + ((hi - lo) * i) / (DENSITY_POINTS - 1);
    let sum = 0;
    for (const v of scaled) {
      const z = (at - v) / bandwidth;
      sum += Math.exp(-0.5 * z * z);
    }
    top = Math.max(top, sum);
    out.push({ at, width: sum });
  }
  return out.map((d) => ({ at: d.at, width: d.width / top }));
};

const boxStats = (tissue: string, sorted: Float64Array): TissueStats => {
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const fence = 1.5 * (q3 - q1);
  const outliers: number[] = [];
  let whiskerLow = q1;
  let whiskerHigh = q3;
  for (const v of sorted) {
    if (v < q1 - fence || v > q3 + fence) {
      outliers.push(v);
    } else {
      whiskerLow = Math.min(whiskerLow, v);
      whiskerHigh = Math.max(whiskerHigh, v);
    }
  }
  return {
    tissue,
    n: sorted.length,
    median: quantile(sorted, 0.5),
    q1,
    q3,
    whiskerLow,
    whiskerHigh,
    outliers,
  };
};

/** The box-plot statistics of one tissue's samples (TPM); null when it has none. */
export const tissueStats = (tissue: string, values: number[]): TissueStats | null =>
  values.length === 0 ? null : boxStats(tissue, Float64Array.from(values).sort());

/** Those statistics and the violin's outline on a scale; null when the tissue has no samples. */
export const violinStats = (
  tissue: string,
  values: number[],
  scale: ViolinScale
): ViolinStats | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = Float64Array.from(values).sort();
  return {
    ...boxStats(tissue, sorted),
    // toScale is monotonic, so the scaled samples are still in order
    density: kernelDensity(sorted.map((v) => toScale(v, scale))),
  };
};

/** Round TPM values for the axis: 0, 1, 10, … on the log scale, and 1/2/5 steps on the linear. */
export const axisTicks = (maxTpm: number, scale: ViolinScale): number[] => {
  if (scale === "log") {
    const ticks = [0];
    for (let t = 1; t <= Math.max(1, maxTpm); t *= 10) {
      ticks.push(t);
    }
    return ticks;
  }
  if (maxTpm <= 0) {
    return [0, 1];
  }
  const rough = maxTpm / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough)!;
  const ticks: number[] = [];
  for (let i = 0; i * step <= maxTpm; i++) {
    // i * step and not a running sum, which drifts for a step such as 0.1
    ticks.push(Number((i * step).toPrecision(12)));
  }
  return ticks;
};
