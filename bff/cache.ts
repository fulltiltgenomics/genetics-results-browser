// Small in-process TTL + LRU cache for assembled stage-1 responses.
//
// The expensive /v1/results path is dominated by upstream tabix/GCS range seeks: a named-set query
// (e.g. FinnGen_enriched_202505, ~900 variants) takes tens of seconds and is issued repeatedly with
// the SAME input. The assembled NormalizedResponse is a pure function of that input and the upstream
// data, which is effectively static between deploys, so it caches extremely well. Caching here turns
// a repeated 60s fan-out into a Map lookup.
//
// A process restart (every deploy) clears the cache, so the TTL is only a staleness safety-net for a
// long-lived process, not a correctness mechanism. Entry count is bounded because a single
// NormalizedResponse can be several MB; LRU eviction keeps the hot named sets resident.
//
// Deliberately dependency-free: a plain Map preserves insertion order, so re-inserting on read and
// evicting the first (oldest) key gives LRU with no external lru-cache dependency.

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlLruCache<V> {
  private readonly store = new Map<string, Entry<V>>();
  private readonly enabled: boolean;

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number
  ) {
    // a non-positive size or ttl disables the cache entirely (get miss / set no-op) so it can be
    // turned off by config without a code change
    this.enabled = maxEntries > 0 && ttlMs > 0;
  }

  get(key: string): V | undefined {
    if (!this.enabled) return undefined;
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // mark most-recently-used by re-inserting at the tail of the Map's iteration order
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    if (!this.enabled) return;
    // overwrite in place moves the key to the tail; delete first so order is refreshed
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    // evict oldest entries (front of the Map) until within the size bound
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
