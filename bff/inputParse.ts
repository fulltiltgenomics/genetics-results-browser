import { upstreamJson } from "./upstream.js";

// canonical internal id is colon-separated chr:pos:ref:alt (GRCh38); accept the usual CPRA
// separators (- _ | / \) and an optional chr prefix, mirroring the MCP _parse_variant_list.
const VARIANT_RE = /^(?:chr)?(\d{1,2}|X|Y|MT):(\d+):([ACGT]+):([ACGT]+)$/i;
const CPRA_SEP_RE = /[-_|/\\]/g;
const RSID_RE = /^rs\d+$/i;

export interface ParsedRow {
  /** canonical chr:pos:ref:alt for direct variant ids; null when the token is an rsid or unparseable. */
  variant: string | null;
  /** original rsid token (lowercased) when the input row was an rsid. */
  rsid: string | null;
  raw: string;
  beta?: number;
  value?: number | string;
}

const normalizeVariant = (raw: string): string | null => {
  const tryMatch = (s: string): string | null => {
    const m = VARIANT_RE.exec(s);
    if (!m) return null;
    const chr = m[1] === "23" ? "X" : m[1].toUpperCase().replace(/^MT$/, "MT");
    return `${chr}:${m[2]}:${m[3].toUpperCase()}:${m[4].toUpperCase()}`;
  };
  const direct = tryMatch(raw);
  if (direct) return direct;
  // normalize CPRA separators to colon and chr23 -> X, then retry
  const normalized = raw.replace(CPRA_SEP_RE, ":").replace(/^(?:chr)?23:/i, "X:");
  return tryMatch(normalized);
};

/**
 * Parse the free-text variant-list input the UI produces: one entry per line, optional
 * tab/whitespace/comma-separated `beta` and custom `value` columns (mirrors the legacy input box).
 * Each row is classified as a direct variant id, an rsid (resolved later), or unparseable.
 */
export const parseInputRows = (text: string): ParsedRow[] => {
  const normalized = text.replace(/\\n/g, "\n");
  const lines = normalized
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines.map((line): ParsedRow => {
    // tab-separated is the canonical UI format (variant\tbeta\tvalue); fall back to whitespace
    const fields = (line.includes("\t") ? line.split("\t") : line.split(/\s+/)).map((f) => f.trim());
    const token = fields[0];

    const row: ParsedRow = { variant: null, rsid: null, raw: token };
    if (RSID_RE.test(token)) {
      row.rsid = token.toLowerCase();
    } else {
      row.variant = normalizeVariant(token);
    }

    if (fields[1] !== undefined && fields[1] !== "") {
      const b = Number(fields[1]);
      if (!Number.isNaN(b)) row.beta = b;
    }
    if (fields[2] !== undefined && fields[2] !== "") {
      const n = Number(fields[2]);
      row.value = Number.isNaN(n) ? fields[2] : n;
    }
    return row;
  });
};

interface RsidLookupRow {
  rsid: string;
  variants: string[]; // colon-separated chr:pos:ref:alt
}

/**
 * Resolve rsid tokens to canonical variant ids via GET /v1/rsid/variants?rsids=rs1,rs2.
 * Returns a map rsid -> [variantId,...] ([] when the rsid is unknown to the db).
 */
export const resolveRsids = async (rsids: string[]): Promise<Record<string, string[]>> => {
  const unique = [...new Set(rsids.map((r) => r.toLowerCase()))];
  if (unique.length === 0) return {};
  const rows = await upstreamJson<RsidLookupRow[]>("/v1/rsid/variants", {
    query: { rsids: unique.join(",") },
  });
  const map: Record<string, string[]> = {};
  for (const r of rows ?? []) {
    map[r.rsid.toLowerCase()] = (r.variants ?? []).map((v) => v.replace(/-/g, ":"));
  }
  // ensure every requested rsid has an entry even if the upstream omitted it
  for (const r of unique) if (!(r in map)) map[r] = [];
  return map;
};

export interface ResolvedInput {
  rows: ParsedRow[];
  /** canonical variant ids to query upstream (direct ids + rsid-resolved, deduped, order-stable). */
  variantIds: string[];
  rsidMap: Record<string, string[]>; // rsid -> resolved variant ids (camelCased InputVariants.rsidMap)
  notFound: string[]; // rsids that resolved to nothing
  unparsed: string[]; // tokens that are neither a valid variant nor an rsid
  /** per-variant user beta / custom value, keyed by canonical variant id. */
  betaByVariant: Record<string, number>;
  valueByVariant: Record<string, number | string>;
}

/** Parse the input text and resolve any rsids into the canonical variant set for fan-out. */
export const resolveInput = async (text: string): Promise<ResolvedInput> => {
  const rows = parseInputRows(text);
  const rsidTokens = rows.filter((r) => r.rsid).map((r) => r.rsid as string);
  const rsidMap = await resolveRsids(rsidTokens);

  const variantIds: string[] = [];
  const seen = new Set<string>();
  const notFound: string[] = [];
  const unparsed: string[] = [];
  const betaByVariant: Record<string, number> = {};
  const valueByVariant: Record<string, number | string> = {};

  const addVariant = (vid: string, row: ParsedRow): void => {
    if (!seen.has(vid)) {
      seen.add(vid);
      variantIds.push(vid);
    }
    // last write wins for duplicate inputs; betas/values attach to the canonical id
    if (row.beta !== undefined) betaByVariant[vid] = row.beta;
    if (row.value !== undefined) valueByVariant[vid] = row.value;
  };

  for (const row of rows) {
    if (row.variant) {
      addVariant(row.variant, row);
    } else if (row.rsid) {
      const resolved = rsidMap[row.rsid] ?? [];
      if (resolved.length === 0) notFound.push(row.raw);
      else for (const vid of resolved) addVariant(vid, row);
    } else {
      unparsed.push(row.raw);
    }
  }

  return { rows, variantIds, rsidMap, notFound, unparsed, betaByVariant, valueByVariant };
};
