import { describe, it, expect } from "vitest";
import { formatPhenotypeCounts } from "./tableutil";

describe("formatPhenotypeCounts", () => {
  it("shows cases + controls when both are available", () => {
    expect(formatPhenotypeCounts({ sampleSize: 80000, nCases: 12345, nControls: 67890 })).toBe(
      "12,345 cases, 67,890 controls"
    );
  });

  it("falls back to samples when the control count is missing", () => {
    expect(formatPhenotypeCounts({ sampleSize: 100000, nCases: 5000, nControls: null })).toBe(
      "100,000 samples"
    );
    expect(formatPhenotypeCounts({ sampleSize: 100000, nCases: null, nControls: null })).toBe(
      "100,000 samples"
    );
  });

  it("returns empty string when no counts are available", () => {
    expect(formatPhenotypeCounts({ sampleSize: undefined, nCases: null, nControls: null })).toBe("");
  });
});
