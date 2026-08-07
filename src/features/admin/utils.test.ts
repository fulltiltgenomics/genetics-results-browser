import { describe, it, expect, afterEach, vi } from "vitest";
import { fillUsageGaps, localDayKey, parseUtcTimestamp, withinDayRange } from "./utils";

describe("parseUtcTimestamp", () => {
  it("reads an offset-less admin timestamp as UTC, not local time", () => {
    // the regression: JS parses "2026-04-28T23:33:27" as local, so in any zone east of UTC
    // the instant was reported hours early and slid onto the previous day
    expect(parseUtcTimestamp("2026-04-28T23:33:27").toISOString()).toBe(
      "2026-04-28T23:33:27.000Z"
    );
  });

  it("accepts the SQLite space-separated spelling", () => {
    expect(parseUtcTimestamp("2026-04-28 23:33:27").toISOString()).toBe(
      "2026-04-28T23:33:27.000Z"
    );
  });

  it("leaves an already-zoned timestamp alone", () => {
    expect(parseUtcTimestamp("2026-04-28T23:33:27Z").toISOString()).toBe(
      "2026-04-28T23:33:27.000Z"
    );
    expect(parseUtcTimestamp("2026-04-28T23:33:27+03:00").toISOString()).toBe(
      "2026-04-28T20:33:27.000Z"
    );
  });

  it("does not mangle a date-only string", () => {
    expect(parseUtcTimestamp("2026-04-28").toISOString()).toBe("2026-04-28T00:00:00.000Z");
  });

  it("returns an invalid Date for a missing timestamp instead of throwing", () => {
    // a null created_at/updated_at crashed the whole Conversations table: the parse runs
    // inside an MRT accessor, so the throw escaped into the table's render
    expect(parseUtcTimestamp(null).getTime()).toBeNaN();
    expect(parseUtcTimestamp(undefined).getTime()).toBeNaN();
  });
});

describe("localDayKey", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("returns the viewer's calendar day, not the UTC one", () => {
    // the exact case that made the date filter look one day off: 23:33 UTC is 02:33
    // the *next* day in Helsinki summer time, so this conversation belongs to Apr 29
    process.env.TZ = "Europe/Helsinki";
    expect(localDayKey("2026-04-28T23:33:27")).toBe("2026-04-29");
  });

  it("agrees with the UTC day for a viewer in UTC", () => {
    process.env.TZ = "UTC";
    expect(localDayKey("2026-04-28T23:33:27")).toBe("2026-04-28");
  });

  it("handles a zone west of UTC crossing the other way", () => {
    process.env.TZ = "America/New_York";
    expect(localDayKey("2026-04-29T02:33:27")).toBe("2026-04-28");
  });

  it("is empty for an unparseable timestamp rather than throwing", () => {
    expect(localDayKey("not a date")).toBe("");
    expect(localDayKey(null)).toBe("");
  });
});

describe("withinDayRange", () => {
  it("passes everything when no range is set", () => {
    expect(withinDayRange("2026-04-28", undefined)).toBe(true);
    expect(withinDayRange("2026-04-28", ["", ""])).toBe(true);
  });

  it("is inclusive at both bounds", () => {
    expect(withinDayRange("2026-04-28", ["2026-04-28", "2026-04-28"])).toBe(true);
    expect(withinDayRange("2026-04-27", ["2026-04-28", "2026-04-28"])).toBe(false);
    expect(withinDayRange("2026-04-29", ["2026-04-28", "2026-04-28"])).toBe(false);
  });

  it("supports open-ended ranges", () => {
    expect(withinDayRange("2026-04-29", ["2026-04-28", ""])).toBe(true);
    expect(withinDayRange("2026-04-27", ["2026-04-28", ""])).toBe(false);
    expect(withinDayRange("2026-04-27", ["", "2026-04-28"])).toBe(true);
    expect(withinDayRange("2026-04-29", ["", "2026-04-28"])).toBe(false);
  });
});

describe("fillUsageGaps", () => {
  afterEach(() => vi.useRealTimers());

  it("inserts zero rows for missing days", () => {
    const filled = fillUsageGaps([
      { date: "2026-04-01", unique_users: 2, conversations: 5 },
      { date: "2026-04-03", unique_users: 1, conversations: 1 },
    ]);
    expect(filled.map((d) => d.date)).toEqual(["2026-04-01", "2026-04-02", "2026-04-03"]);
    expect(filled[1]).toEqual({ date: "2026-04-02", unique_users: 0, conversations: 0 });
  });
});
