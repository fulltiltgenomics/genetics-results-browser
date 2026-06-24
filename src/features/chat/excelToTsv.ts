import * as XLSX from "xlsx";

/**
 * Convert an Excel workbook (.xlsx/.xls) to TSV text in the browser.
 *
 * Excel is a binary format, so it can't be read as text directly — doing so
 * yields garbage. We parse it client-side and emit TSV so the model receives
 * readable tabular data. With more than one sheet, each is prefixed with a
 * "# Sheet: <name>" header (matching the server-side `excel_to_tsv`).
 */
export async function excelFileToTsv(file: File): Promise<string> {
  const buf = await readAsArrayBuffer(file);
  const wb = XLSX.read(buf, { type: "array" });
  const multi = wb.SheetNames.length > 1;
  const parts = wb.SheetNames.map((name) => {
    const tsv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { FS: "\t" });
    return multi ? `# Sheet: ${name}\n${tsv}` : tsv;
  });
  return parts.join("\n");
}

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
