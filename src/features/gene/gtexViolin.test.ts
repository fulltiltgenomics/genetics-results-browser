import { describe, expect, it } from "vitest";
import { axisTicks, quantile, toScale, violinStats } from "./gtexViolin";

describe("gtexViolin", () => {
  it("interpolates quantiles between ranks", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([7], 0.75)).toBe(7);
  });

  it("keeps a sample at 0 TPM on the log scale", () => {
    expect(toScale(0, "log")).toBe(0);
    expect(toScale(9, "log")).toBe(1);
    expect(toScale(9, "linear")).toBe(9);
  });

  it("gives the box, the whiskers within 1.5 IQR and the outliers beyond", () => {
    const stats = violinStats("Liver", [4, 1, 3, 2, 5, 100], "linear")!;
    expect(stats).toMatchObject({ n: 6, median: 3.5, q1: 2.25, q3: 4.75 });
    expect(stats.outliers).toEqual([100]);
    expect([stats.whiskerLow, stats.whiskerHigh]).toEqual([1, 5]);
  });

  it("outlines the violin from the lowest to the highest sample, widest at 1", () => {
    const values = [...Array(40).fill(1), ...Array(10).fill(50)];
    const { density } = violinStats("Liver", values, "linear")!;
    expect(density[0].at).toBe(1);
    expect(density[density.length - 1].at).toBe(50);
    expect(Math.max(...density.map((d) => d.width))).toBe(1);
    // most samples are at the low end, so that is where it is widest
    expect(density[0].width).toBeGreaterThan(density[density.length - 1].width);
    const middle = density[Math.floor(density.length / 2)].width;
    expect(middle).toBeLessThan(density[density.length - 1].width);
  });

  it("draws a tissue whose samples are all one value as a single point, and none as nothing", () => {
    expect(violinStats("Liver", [2, 2, 2], "log")!.density).toEqual([
      { at: Math.log10(3), width: 1 },
    ]);
    expect(violinStats("Liver", [], "log")).toBeNull();
  });

  it("picks round axis ticks", () => {
    expect(axisTicks(250, "log")).toEqual([0, 1, 10, 100]);
    expect(axisTicks(0.3, "log")).toEqual([0, 1]);
    expect(axisTicks(47, "linear")).toEqual([0, 10, 20, 30, 40]);
    expect(axisTicks(0.45, "linear")).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  });
});
