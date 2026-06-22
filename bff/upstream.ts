import { config } from "./config.js";

// default per-call upstream timeout; a stalled genetics-results-api must not hang the BFF
// (the .8 review flagged the passthrough's lack of abort). overridable per call for slow batches.
const DEFAULT_TIMEOUT_MS = 30_000;

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

interface UpstreamOpts {
  method?: "GET" | "POST";
  /** request body — serialized as JSON unless already a string (rsid endpoint takes raw text). */
  body?: unknown;
  /** query params appended to the path. */
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
  /** content-type override; defaults to application/json for object bodies. */
  contentType?: string;
}

const buildUrl = (path: string, query?: UpstreamOpts["query"]): string => {
  const base = `${config.upstreamUrl}${path}`;
  if (!query) return base;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const str = qs.toString();
  return str ? `${base}?${str}` : base;
};

/**
 * Shared upstream fetch used by the stage-1 normalize routes. Unlike the generic passthrough this
 * does NOT fold request cookies/headers from the browser hop — these are server-to-server calls
 * with their own lifecycle, so we avoid the multi-cookie header-folding bug from the .8 review.
 * Adds an AbortController timeout. Returns the raw response text, or null for an empty body
 * (a 200 with no body or an HTML error page) so callers can default sensibly.
 */
const fetchUpstreamText = async (path: string, opts: UpstreamOpts): Promise<string | null> => {
  const { method = "GET", body, query, timeoutMs = DEFAULT_TIMEOUT_MS, contentType } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const isString = typeof body === "string";
  const headers: Record<string, string> = {};
  // authenticate these server-to-server calls when an API token is configured (prod: REQUIRE_AUTH).
  // the API accepts the shared internal secret as a bearer token; in dev the token is unset and the
  // dev API runs without auth, so the header is simply omitted.
  if (config.apiToken) headers["authorization"] = `Bearer ${config.apiToken}`;
  let serialized: string | undefined;
  if (body !== undefined) {
    headers["content-type"] = contentType ?? (isString ? "text/plain" : "application/json");
    serialized = isString ? body : JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: serialized,
      signal: controller.signal,
    });
  } catch (err) {
    // abort surfaces as an AbortError; everything else is a connection-level failure
    const reason = (err as Error)?.name === "AbortError" ? "upstream timed out" : "upstream unreachable";
    throw new UpstreamError(`${reason}: ${path}`, 502, path);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new UpstreamError(`upstream ${res.status} for ${path}`, res.status, path);
  }

  const text = await res.text();
  return text.trim() === "" ? null : text;
};

/** Typed JSON upstream call. Used for non-tabular endpoints (/datasets, /trait_name_mapping). */
export const upstreamJson = async <T>(path: string, opts: UpstreamOpts = {}): Promise<T> => {
  const text = await fetchUpstreamText(path, opts);
  if (text === null) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError(`upstream returned non-JSON for ${path}`, 502, path);
  }
};

/**
 * Tabular upstream call: requests the API's native TSV (format=tsv) and parses it into row objects
 * keyed by the header columns. The genetics-results-api serves tabix output natively as TSV, so
 * format=tsv lets the API stream the bytes straight through, skipping the per-row dict-building +
 * JSON serialization the format=json path does (see range_response / tsv_stream_to_list in the API)
 * — and this side parses with a tab split instead of JSON.parse. A present-but-"NA" cell becomes
 * null (matching the JSON path's None -> null); a column absent from the header is simply absent.
 */
export const upstreamTsv = async <T = Record<string, string | null>>(
  path: string,
  opts: UpstreamOpts = {}
): Promise<T[]> => {
  const text = await fetchUpstreamText(path, {
    ...opts,
    query: { ...opts.query, format: "tsv" },
  });
  if (text === null) return [];
  return parseTsv(text) as unknown as T[];
};

/** Parse a TSV body (header line + rows) into row objects keyed by column name; "NA" -> null. */
export const parseTsv = (text: string): Array<Record<string, string | null>> => {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return [];
  const header = lines[i].split("\t").map((h) => (h.startsWith("#") ? h.slice(1) : h));
  const rows: Array<Record<string, string | null>> = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].length === 0) continue;
    const fields = lines[j].split("\t");
    const row: Record<string, string | null> = {};
    for (let k = 0; k < header.length; k++) {
      const v = fields[k];
      // present-but-NA -> null (mirrors the API JSON path); missing trailing field -> null too
      row[header[k]] = v === undefined || v === "NA" ? null : v;
    }
    rows.push(row);
  }
  return rows;
};
