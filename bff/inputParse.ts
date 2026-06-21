import { upstreamJson, UpstreamError } from "./upstream.js";

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

export const normalizeVariant = (raw: string): string | null => {
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

// a single credible-set lead row from /v1/credible_sets_by_phenotype_leads (cs_header_schema subset)
interface CsLeadRow {
  chr: number;
  pos: number;
  ref: string;
  alt: string;
  beta?: number | null;
  cs_id: string;
}

/**
 * Expand a `pheno:{resource}:{code}` token into a variant<TAB>beta list: the lead variant of each
 * of that phenotype's credible sets, with the data's effect size as the beta. The upstream
 * /v1/credible_sets_by_phenotype_leads endpoint streams the per-phenotype file and returns one lead
 * per cs_id (highest pip). The returned text feeds straight into resolveInput, so the betas land in
 * betaByVariant exactly like a user-pasted beta column — no other parse changes needed.
 *
 * Returns null when the token isn't a `pheno:` token or the phenotype is unknown (404), so the
 * caller falls back to the normal variant-list / named-set paths.
 */
export const maybeExpandPhenotypeLeads = async (text: string): Promise<string | null> => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("pheno:") || /\s/.test(trimmed)) return null;
  // pheno:{resource}:{code} — split on the first two colons; a code may itself contain colons
  const parts = trimmed.split(":");
  const resource = parts[1];
  const code = parts.slice(2).join(":");
  if (!resource || !code) return null;

  try {
    const rows = await upstreamJson<CsLeadRow[]>(
      `/v1/credible_sets_by_phenotype_leads/${encodeURIComponent(resource)}/${encodeURIComponent(code)}`,
      { query: { format: "json", interval: 95 } }
    );
    if (!rows?.length) return null;
    return rows
      .map((r) => {
        const variant = `${r.chr}-${r.pos}-${r.ref}-${r.alt}`;
        return r.beta != null ? `${variant}\t${r.beta}` : variant;
      })
      .join("\n");
  } catch (err) {
    // unknown phenotype -> 404 -> not a usable pheno token; any other failure is genuine
    if (err instanceof UpstreamError && err.status === 404) return null;
    throw err;
  }
};

interface VariantSetResponse {
  name: string;
  variants: string[];
}

/**
 * Expand a named curated variant set (e.g. "FinnGen_enriched_202505", "COVID19_HGI_severity") into
 * its newline-joined variant list via GET /v1/variant_sets/{name}. The legacy backend resolved these
 * tokens server-side; the new genetics-results-api serves the curated lists through this endpoint.
 *
 * Returns the expanded variant text, or null when the query is not a named-set token (a multi-token
 * list, a bare variant id, an rsid, or an unknown set name) so the caller falls back to the normal
 * variant-list parse. Only single bare tokens that are NOT a variant/rsid trigger the lookup, so a
 * normal variant list never pays the extra round-trip.
 */
export const maybeExpandVariantSet = async (text: string): Promise<string | null> => {
  const trimmed = text.trim();
  // a named set is a single bare token: no internal whitespace/newlines, no tab-separated columns
  if (trimmed === "" || /\s/.test(trimmed)) return null;
  // tokens that already are a variant id or rsid are handled by the normal parse path
  if (normalizeVariant(trimmed) !== null || RSID_RE.test(trimmed)) return null;

  try {
    const res = await upstreamJson<VariantSetResponse>(
      `/v1/variant_sets/${encodeURIComponent(trimmed)}`
    );
    const variants = res?.variants ?? [];
    return variants.length ? variants.join("\n") : null;
  } catch (err) {
    // an unknown set name is a 404 -> not a named set, let the normal path mark it unparsed.
    // any other upstream failure is genuine and should surface.
    if (err instanceof UpstreamError && err.status === 404) return null;
    throw err;
  }
};
