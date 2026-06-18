// Chunked-concurrent fan-out for the stage-1 normalize batch calls.
//
// The genetics-results-api serves each batch endpoint (credible_sets_by_variant, variant_annotation,
// nearest_genes) with a single `tabix -R` over all requested variants. That is optimal per call, but
// for a large input (e.g. the ~900-variant FinnGen_enriched_202505 set) it becomes hundreds of
// sequential random-access GCS range seeks — gnomAD alone exceeded 290s. GCS serves *parallel* range
// reads well, so splitting the variant list into chunks and issuing them concurrently cuts wall time
// dramatically (gnomAD 888 variants: ~290s single call -> ~57s as 9 concurrent chunks).
//
// A single shared Semaphore bounds the total outstanding upstream requests across ALL endpoints, so
// the fan-out can't stampede the API with (endpoints x chunks) simultaneous tabix subprocesses.

/** chunk an array into fixed-size slices (last slice may be shorter). */
export const chunk = <T>(arr: T[], size: number): T[][] => {
  if (size <= 0) throw new Error("chunk size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/** counting semaphore: run() admits at most `max` concurrent tasks, queueing the rest FIFO. */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error("semaphore max must be >= 1");
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

/**
 * Retry `fn` up to `attempts` times with exponential backoff. `shouldRetry` decides whether a given
 * error is worth retrying (default: always). Used to ride out TRANSIENT upstream failures — e.g. an
 * occasional `Invalid BGZF header` mid-stream tabix read against GCS under concurrent load — which a
 * fresh attempt usually clears. Permanent errors (4xx) should pass `shouldRetry => false` so they
 * surface immediately instead of wasting retries.
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 400,
  shouldRetry: (err: unknown) => boolean = () => true
): Promise<T> => {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !shouldRetry(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** i));
    }
  }
  throw lastErr;
};

/**
 * Split `items` into chunks and run `call` on each concurrently under `sem`, then flatten the
 * per-chunk arrays back into one. A chunk that yields null (upstream empty body) contributes nothing.
 * Order across chunks is preserved, which keeps the assembled variant order stable.
 */
export const fetchBatched = async <I, O>(
  items: I[],
  chunkSize: number,
  sem: Semaphore,
  call: (chunk: I[]) => Promise<O[] | null>
): Promise<O[]> => {
  if (items.length === 0) return [];
  const chunks = chunk(items, chunkSize);
  const parts = await Promise.all(chunks.map((c) => sem.run(() => call(c))));
  return parts.flatMap((p) => p ?? []);
};
