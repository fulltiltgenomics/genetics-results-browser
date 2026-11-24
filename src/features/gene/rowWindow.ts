/**
 * Where the rows of a windowed table go. Every row has one height, and an open row is followed by
 * a panel of one height too, so a row's place is arithmetic and nothing has to be measured.
 */

export interface RowGeometry {
  rowHeight: number;
  panelHeight: number;
  // indices of the open rows, ascending
  open: number[];
}

const openBefore = (index: number, open: number[]): number => {
  let n = 0;
  while (n < open.length && open[n] < index) {
    n++;
  }
  return n;
};

export const rowTop = (index: number, g: RowGeometry): number =>
  index * g.rowHeight + openBefore(index, g.open) * g.panelHeight;

export const totalHeight = (count: number, g: RowGeometry): number =>
  count * g.rowHeight + g.open.filter((i) => i < count).length * g.panelHeight;

// the row at offset y, or whose panel is; clamped to the rows there are
export const rowAt = (y: number, count: number, g: RowGeometry): number => {
  let panels = 0;
  for (const i of g.open) {
    const panelTop = (i + 1) * g.rowHeight + panels;
    if (y < panelTop) {
      break;
    }
    if (y < panelTop + g.panelHeight) {
      return Math.min(i, count - 1);
    }
    panels += g.panelHeight;
  }
  return Math.max(0, Math.min(count - 1, Math.floor((y - panels) / g.rowHeight)));
};

// how many rows are kept in the document for a viewport: what can show, and `overscan` either side
export const windowSize = (viewport: number, rowHeight: number, overscan: number): number =>
  Math.ceil(viewport / rowHeight) + 1 + 2 * overscan;

/**
 * [from, to) of the rows to keep in the document. Always `size` rows where there are that many, so
 * a pool of `size` elements is fully in use and scrolling never adds or removes one.
 */
export const rowWindow = (
  scrollTop: number,
  count: number,
  size: number,
  overscan: number,
  g: RowGeometry
): [number, number] => {
  const from = Math.max(0, Math.min(rowAt(scrollTop, count, g) - overscan, count - size));
  return [from, Math.min(count, from + size)];
};
