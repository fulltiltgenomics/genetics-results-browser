import { describe, it, expect } from "vitest";
import { buildAllSeries } from "./qualitySeries";
import type { QualityRow } from "./adminApi";

function row(partial: Partial<QualityRow> & { createdAt: string }): QualityRow {
  return {
    sessionId: Math.random().toString(36),
    llmQualityScore: null,
    llmDisposition: null,
    successLabel: null,
    issueCategories: [],
    ...partial,
  };
}

describe("buildAllSeries", () => {
  it("returns empty meta when no rows have parseable dates", () => {
    const res = buildAllSeries([row({ createdAt: "" }), row({ createdAt: "not-a-date" })]);
    expect(res.meta.empty).toBe(true);
    expect(res.meta.skippedNoDate).toBe(2);
    expect(res.scoreShare.dates).toEqual([]);
  });

  it("builds a daily grid spanning min..max date inclusive", () => {
    const rows = [
      row({ createdAt: "2026-01-01", llmQualityScore: 5, successLabel: "successful" }),
      row({ createdAt: "2026-01-03", llmQualityScore: 5, successLabel: "successful" }),
    ];
    const res = buildAllSeries(rows, { window: 1, minN: 1 });
    expect(res.scoreShare.dates).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(res.meta.dateMin).toBe("2026-01-01");
    expect(res.meta.dateMax).toBe("2026-01-03");
  });

  it("yields null gaps for windows below minN", () => {
    // single scored conversation on day 1, minN=3 -> all score-share entries null
    const rows = [row({ createdAt: "2026-01-01", llmQualityScore: 4, successLabel: "successful" })];
    const res = buildAllSeries(rows, { window: 1, minN: 3 });
    expect(res.scoreShare.series["4"]).toEqual([null]);
    // volume is always present even below minN
    expect(res.meanAndVolume.volume).toEqual([1]);
    expect(res.meanAndVolume.series.mean).toEqual([null]);
  });

  it("computes score-share percentages over scored conversations", () => {
    const rows = [
      row({ createdAt: "2026-01-01", llmQualityScore: 5, successLabel: "successful" }),
      row({ createdAt: "2026-01-01", llmQualityScore: 5, successLabel: "successful" }),
      row({ createdAt: "2026-01-01", llmQualityScore: 3, successLabel: "neutral" }),
      row({ createdAt: "2026-01-01", llmQualityScore: 1, successLabel: "unsuccessful" }),
    ];
    const res = buildAllSeries(rows, { window: 1, minN: 1 });
    expect(res.scoreShare.series["5"][0]).toBe(50);
    expect(res.scoreShare.series["3"][0]).toBe(25);
    expect(res.scoreShare.series["1"][0]).toBe(25);
    expect(res.scoreShare.series["2"][0]).toBe(0);
  });

  it("excludes non-quality dispositions from the score trend", () => {
    const rows = [
      row({ createdAt: "2026-01-01", llmQualityScore: 5, llmDisposition: "out_of_scope" }),
      row({ createdAt: "2026-01-01", llmQualityScore: 5, llmDisposition: "technical_failure" }),
      row({ createdAt: "2026-01-01", llmQualityScore: 4, successLabel: "successful" }),
    ];
    const res = buildAllSeries(rows, { window: 1, minN: 1 });
    // only the one quality-relevant conversation counts
    expect(res.meanAndVolume.volume[0]).toBe(1);
    expect(res.meanAndVolume.series.mean[0]).toBe(4);
    expect(res.scoreShare.series["4"][0]).toBe(100);
  });

  it("dedups issue categories per conversation", () => {
    const rows = [
      row({ createdAt: "2026-01-01", issueCategories: ["fabrication", "fabrication", "other"] }),
      row({ createdAt: "2026-01-01", issueCategories: ["other"] }),
    ];
    const res = buildAllSeries(rows, { window: 1, minN: 1 });
    // instances: {fabrication, other} from r1 + {other} from r2 = 3 total
    expect(res.issueCategoryMix.series["fabrication"][0]).toBeCloseTo((100 * 1) / 3);
    expect(res.issueCategoryMix.series["other"][0]).toBeCloseTo((100 * 2) / 3);
  });

  it("computes disposition mix over all conversations keyed on successLabel", () => {
    const rows = [
      row({ createdAt: "2026-01-01", successLabel: "successful" }),
      row({ createdAt: "2026-01-01", successLabel: "unsuccessful" }),
      row({ createdAt: "2026-01-01", successLabel: "unknown" }),
      row({ createdAt: "2026-01-01", successLabel: "successful" }),
    ];
    const res = buildAllSeries(rows, { window: 1, minN: 1 });
    expect(res.dispositionMix.series["successful"][0]).toBe(50);
    expect(res.dispositionMix.series["unsuccessful"][0]).toBe(25);
    expect(res.dispositionMix.series["unknown"][0]).toBe(25);
  });

  it("uses a centered window so neighbours are borrowed", () => {
    const rows = [
      row({ createdAt: "2026-01-01", llmQualityScore: 2, successLabel: "neutral" }),
      row({ createdAt: "2026-01-02", llmQualityScore: 4, successLabel: "successful" }),
      row({ createdAt: "2026-01-03", llmQualityScore: 4, successLabel: "successful" }),
    ];
    // window 3 centered on day 2 includes all three -> mean (2+4+4)/3
    const res = buildAllSeries(rows, { window: 3, minN: 1 });
    const idxDay2 = res.meanAndVolume.dates.indexOf("2026-01-02");
    expect(res.meanAndVolume.series.mean[idxDay2]).toBeCloseTo((2 + 4 + 4) / 3);
    expect(res.meanAndVolume.volume[idxDay2]).toBe(3);
  });
});
