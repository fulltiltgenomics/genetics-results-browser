import { describe, expect, it } from "vitest";
import { MAX_DATA_FILE_BYTES, dataFileSizeError } from "./chatHistoryApi";

describe("dataFileSizeError", () => {
  it("accepts a data file at the cap", () => {
    expect(dataFileSizeError("tsv", "edge.tsv", MAX_DATA_FILE_BYTES)).toBeNull();
  });

  it("refuses a data file over the cap and asks for an extract", () => {
    const msg = dataFileSizeError("tsv", "sumstats.tsv", MAX_DATA_FILE_BYTES + 1);
    expect(msg).toContain("sumstats.tsv");
    expect(msg).toContain("genome-wide-significant rows");
    expect(msg).not.toContain("as TSV");
  });

  it("says an Excel file was measured as TSV", () => {
    expect(dataFileSizeError("excel", "big.xlsx", MAX_DATA_FILE_BYTES + 1)).toContain("as TSV");
  });

  it("leaves images to their own limit", () => {
    expect(dataFileSizeError("image", "plot.png", MAX_DATA_FILE_BYTES * 2)).toBeNull();
  });
});
