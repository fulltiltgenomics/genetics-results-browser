/**
 * A rendered markdown table as CSV.
 *
 * `rowsToCsv` is pure so the quoting is unit tested without a browser download, in the same
 * shape as the variant-table exports.
 */

/** RFC 4180: a field holding a comma, a quote or a line break is quoted, its quotes doubled */
export const csvField = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const rowsToCsv = (rows: string[][]): string =>
  rows.map((row) => row.map(csvField).join(",")).join("\n");

/**
 * The table's cells as plain text.
 *
 * Read out of the DOM rather than out of the markdown source because by this point
 * react-markdown has already turned `**bold**`, `[text](url)` and code spans into elements,
 * so `textContent` is the value the user sees with no inline syntax left to strip.
 */
export const tableRows = (table: HTMLTableElement): string[][] =>
  Array.from(table.rows, (row) => Array.from(row.cells, (cell) => (cell.textContent ?? "").trim()));

export const tableToCsv = (table: HTMLTableElement): string => rowsToCsv(tableRows(table));
