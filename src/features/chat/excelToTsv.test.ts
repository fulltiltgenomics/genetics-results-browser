import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { excelFileToTsv } from "./excelToTsv";

function makeXlsxFile(sheets: Record<string, unknown[][]>, name = "test.xlsx"): File {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([buf], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("excelFileToTsv", () => {
  it("converts a single sheet to tab-separated text without a sheet header", async () => {
    const file = makeXlsxFile({
      results: [
        ["gene", "trait"],
        ["BRCA1", "cancer"],
      ],
    });
    const tsv = await excelFileToTsv(file);
    expect(tsv).toContain("gene\ttrait");
    expect(tsv).toContain("BRCA1\tcancer");
    expect(tsv).not.toContain("# Sheet:");
  });

  it("prefixes each sheet with a header when there is more than one", async () => {
    const file = makeXlsxFile({
      genes: [["gene"], ["BRCA1"]],
      variants: [["rsid"], ["rs123"]],
    });
    const tsv = await excelFileToTsv(file);
    expect(tsv).toContain("# Sheet: genes");
    expect(tsv).toContain("# Sheet: variants");
  });
});
