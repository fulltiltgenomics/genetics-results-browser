import { describe, expect, it, vi } from "vitest";
import { TtlLruCache } from "./cache.js";

describe("TtlLruCache", () => {
  it("returns a stored value before it expires and undefined for a missing key", () => {
    const cache = new TtlLruCache<number>(10, 1000);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("expires an entry once its TTL elapses", () => {
    vi.useFakeTimers();
    try {
      const cache = new TtlLruCache<number>(10, 1000);
      cache.set("a", 1);
      vi.advanceTimersByTime(999);
      expect(cache.get("a")).toBe(1);
      vi.advanceTimersByTime(2);
      expect(cache.get("a")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("evicts the least-recently-used entry when over the size bound", () => {
    const cache = new TtlLruCache<number>(2, 1000);
    cache.set("a", 1);
    cache.set("b", 2);
    // touch "a" so "b" becomes the LRU
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.size).toBe(2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  it("is disabled when max entries is 0 (always a miss)", () => {
    const cache = new TtlLruCache<number>(0, 1000);
    cache.set("a", 1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("is disabled when the ttl is 0 (always a miss)", () => {
    const cache = new TtlLruCache<number>(10, 0);
    cache.set("a", 1);
    expect(cache.get("a")).toBeUndefined();
  });
});
