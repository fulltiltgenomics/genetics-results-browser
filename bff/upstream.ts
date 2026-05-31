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
 * Typed upstream call used by the stage-1 normalize routes. Unlike the generic passthrough this
 * does NOT fold request cookies/headers from the browser hop — these are server-to-server calls
 * with their own lifecycle, so we avoid the multi-cookie header-folding bug from the .8 review.
 * Adds an AbortController timeout and explicit empty/non-JSON body handling.
 */
export const upstreamJson = async <T>(path: string, opts: UpstreamOpts = {}): Promise<T> => {
  const { method = "GET", body, query, timeoutMs = DEFAULT_TIMEOUT_MS, contentType } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const isString = typeof body === "string";
  const headers: Record<string, string> = {};
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

  // explicit empty/non-JSON handling: a 200 with an empty body (or HTML error page) must not
  // throw a raw SyntaxError — return null so callers can default sensibly
  const text = await res.text();
  if (text.trim() === "") return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError(`upstream returned non-JSON for ${path}`, 502, path);
  }
};
