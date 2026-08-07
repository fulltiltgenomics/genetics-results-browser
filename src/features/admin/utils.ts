import type { UsageDataPoint } from "./adminApi";

/**
 * Fills gaps in usage analytics so the chart x-axis shows every date in range,
 * including days/months with zero activity (the backend only returns dates that
 * have rows). Granularity is detected from the date format: daily (YYYY-MM-DD) or
 * monthly (YYYY-MM). Dates are walked in UTC to avoid timezone/DST drift.
 */
export function fillUsageGaps(data: UsageDataPoint[]): UsageDataPoint[] {
  if (data.length < 2) return data;

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((d) => [d.date, d]));
  const monthly = /^\d{4}-\d{2}$/.test(sorted[0].date);
  // bail out if the format is unexpected — better to show raw data than mangle it
  if (!monthly && !/^\d{4}-\d{2}-\d{2}$/.test(sorted[0].date)) return data;

  const keys: string[] = [];
  if (monthly) {
    const [fy, fm] = sorted[0].date.split("-").map(Number);
    const [ly, lm] = sorted[sorted.length - 1].date.split("-").map(Number);
    for (let y = fy, m = fm; y < ly || (y === ly && m <= lm); ) {
      keys.push(`${y}-${String(m).padStart(2, "0")}`);
      if (m === 12) {
        m = 1;
        y++;
      } else {
        m++;
      }
    }
  } else {
    const start = Date.parse(`${sorted[0].date}T00:00:00Z`);
    const end = Date.parse(`${sorted[sorted.length - 1].date}T00:00:00Z`);
    for (let t = start; t <= end; t += 86_400_000) {
      keys.push(new Date(t).toISOString().slice(0, 10));
    }
  }

  return keys.map(
    (date) => byDate.get(date) ?? { date, unique_users: 0, conversations: 0 }
  );
}

// matches a trailing UTC marker or numeric offset, i.e. an already-unambiguous instant
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Parses a timestamp from the admin API, which are UTC instants missing their offset.
 *
 * chat_sessions.created_at/updated_at are written by SQLite CURRENT_TIMESTAMP (UTC) and
 * serialized with a naive `datetime.isoformat()`, so they arrive as "2026-04-28T23:33:27"
 * with no zone. JS parses an offset-less date-time as *local* time, which showed the UTC
 * wall clock mislabelled as local and filed anything after local midnight under the
 * previous day. Supplying the missing Z pins the instant so it renders in the viewer's zone.
 */
export function parseUtcTimestamp(value: string): Date {
  // tolerate the SQLite "YYYY-MM-DD HH:MM:SS" spelling as well as ISO's "T"
  const normalized = value.trim().replace(" ", "T");
  // date-only strings are already spec'd to parse as UTC, and appending Z would break them
  if (!normalized.includes("T") || HAS_OFFSET.test(normalized)) return new Date(normalized);
  return new Date(`${normalized}Z`);
}

/** Local calendar day of an admin timestamp as YYYY-MM-DD, for day-granularity filtering. */
export function localDayKey(value: string): string {
  const d = parseUtcTimestamp(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Inclusive day-range test used by the Created column filter. Both bounds are optional
 * YYYY-MM-DD strings, which sort lexicographically in calendar order, so plain string
 * comparison is enough and no Date arithmetic (or DST edge case) is involved.
 */
export function withinDayRange(day: string, range: [string, string] | undefined): boolean {
  if (!range) return true;
  const [from, to] = range;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

/**
 * Returns a human-readable relative time string like "today", "yesterday", "3 days ago".
 */
export function formatRelativeTime(isoString: string): string {
  const date = parseUtcTimestamp(isoString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  return `${diffDays} days ago`;
}
