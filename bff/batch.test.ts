import { describe, expect, it } from "vitest";
import { chunk, fetchBatched, Semaphore, withRetry } from "./batch.js";

describe("chunk", () => {
  it("splits into fixed-size slices with a possibly-shorter tail", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("returns an empty array for empty input", () => {
    expect(chunk([], 3)).toEqual([]);
  });
  it("rejects a non-positive size", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("Semaphore", () => {
  it("never exceeds the configured concurrency and still runs every task", async () => {
    const sem = new Semaphore(3);
    let active = 0;
    let peak = 0;
    const task = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return 1;
    };
    const results = await Promise.all(Array.from({ length: 12 }, () => sem.run(task)));
    expect(results).toHaveLength(12);
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe("withRetry", () => {
  it("returns the first success without extra attempts", async () => {
    let calls = 0;
    const out = await withRetry(async () => {
      calls++;
      return "ok";
    }, 3, 1);
    expect(out).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries a transient failure then succeeds", async () => {
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return "ok";
      },
      3,
      1
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
  });

  it("stops immediately when shouldRetry is false", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("permanent");
        },
        3,
        1,
        () => false
      )
    ).rejects.toThrow("permanent");
    expect(calls).toBe(1);
  });

  it("throws the last error after exhausting attempts", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new Error(`fail ${calls}`);
      }, 3, 1)
    ).rejects.toThrow("fail 3");
    expect(calls).toBe(3);
  });
});

describe("fetchBatched", () => {
  it("chunks the input, calls per chunk, and flattens results in order", async () => {
    const seenChunks: number[][] = [];
    const out = await fetchBatched([1, 2, 3, 4, 5], 2, new Semaphore(2), async (c) => {
      seenChunks.push(c);
      return c.map((n) => n * 10);
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(seenChunks).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("treats a null chunk result as empty (no rows contributed)", async () => {
    const out = await fetchBatched([1, 2, 3, 4], 2, new Semaphore(2), async (c) =>
      c[0] === 1 ? null : c
    );
    expect(out).toEqual([3, 4]);
  });

  it("returns [] for empty input without calling", async () => {
    let called = false;
    const out = await fetchBatched([], 2, new Semaphore(2), async (c) => {
      called = true;
      return c;
    });
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });
});
