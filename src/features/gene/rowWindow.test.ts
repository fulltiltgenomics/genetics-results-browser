import { describe, expect, it } from "vitest";
import { rowAt, rowTop, rowWindow, totalHeight, windowSize } from "./rowWindow";

const closed = { rowHeight: 20, panelHeight: 100, open: [] };
const opened = { rowHeight: 20, panelHeight: 100, open: [2, 5] };

describe("row geometry", () => {
  it("stacks rows, with a panel under each open one", () => {
    expect([0, 1, 2, 3].map((i) => rowTop(i, closed))).toEqual([0, 20, 40, 60]);
    expect([2, 3, 5, 6].map((i) => rowTop(i, opened))).toEqual([40, 160, 200, 320]);
    expect(totalHeight(10, closed)).toBe(200);
    expect(totalHeight(10, opened)).toBe(400);
    // an open row that a filter has since removed takes no room
    expect(totalHeight(4, opened)).toBe(180);
  });

  it("finds the row at an offset, counting a panel as part of its row", () => {
    expect(rowAt(0, 10, closed)).toBe(0);
    expect(rowAt(59, 10, closed)).toBe(2);
    expect(rowAt(60, 10, opened)).toBe(2);
    expect(rowAt(159, 10, opened)).toBe(2);
    expect(rowAt(160, 10, opened)).toBe(3);
    expect(rowAt(250, 10, opened)).toBe(5);
    expect(rowAt(320, 10, opened)).toBe(6);
  });

  it("agrees with rowTop for every row", () => {
    for (let i = 0; i < 10; i++) {
      expect(rowAt(rowTop(i, opened), 10, opened)).toBe(i);
      expect(rowAt(rowTop(i, opened) + 19, 10, opened)).toBe(i);
    }
  });

  it("clamps an offset outside the rows", () => {
    expect(rowAt(-50, 10, closed)).toBe(0);
    expect(rowAt(5000, 10, closed)).toBe(9);
  });
});

describe("rowWindow", () => {
  const size = windowSize(100, 20, 2);

  it("keeps what the viewport can show and the overscan either side", () => {
    expect(size).toBe(10);
    expect(rowWindow(400, 1000, size, 2, closed)).toEqual([18, 28]);
  });

  it("holds the same number of rows at either end of the list", () => {
    expect(rowWindow(0, 1000, size, 2, closed)).toEqual([0, 10]);
    expect(rowWindow(19990, 1000, size, 2, closed)).toEqual([990, 1000]);
  });

  it("holds every row of a list shorter than the window", () => {
    expect(rowWindow(0, 4, size, 2, closed)).toEqual([0, 4]);
    expect(rowWindow(0, 0, size, 2, closed)).toEqual([0, 0]);
  });

  it("starts from the row on screen when panels have pushed the rows down", () => {
    expect(rowWindow(330, 1000, size, 2, opened)).toEqual([4, 14]);
  });
});
