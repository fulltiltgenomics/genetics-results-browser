import { act, renderHook } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/msw/server";
import { fetchUpdateInProgress, useUpdateInProgress } from "./updateNotice";

const ONE_MINUTE = 60_000;

describe("useUpdateInProgress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("checks at mount and follows the notice on and off", async () => {
    let answer: boolean | null = true;
    const check = vi.fn(async () => answer);
    const { result } = renderHook(() => useUpdateInProgress(true, check));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(check).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(true);
    answer = false;
    await act(() => vi.advanceTimersByTimeAsync(ONE_MINUTE));
    expect(result.current).toBe(false);
  });

  it("keeps the last answer while the file is unreadable", async () => {
    let answer: boolean | null = true;
    const check = vi.fn(async () => answer);
    const { result } = renderHook(() => useUpdateInProgress(true, check));
    await act(() => vi.advanceTimersByTimeAsync(0));
    answer = null;
    await act(() => vi.advanceTimersByTimeAsync(ONE_MINUTE));
    expect(check).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(true);
  });

  it("checks when the tab becomes visible", async () => {
    const check = vi.fn(async () => false);
    renderHook(() => useUpdateInProgress(true, check));
    await act(() => vi.advanceTimersByTimeAsync(0));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("never checks when disabled (dev server, tests)", async () => {
    const check = vi.fn(async () => true);
    const { result } = renderHook(() => useUpdateInProgress(false, check));
    await act(() => vi.advanceTimersByTimeAsync(ONE_MINUTE));
    expect(check).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });
});

describe("fetchUpdateInProgress", () => {
  it("reads the flag out of notice.json", async () => {
    server.use(http.get("*/notice/notice.json", () => HttpResponse.json({ updating: true })));
    expect(await fetchUpdateInProgress()).toBe(true);
    server.use(http.get("*/notice/notice.json", () => HttpResponse.json({ updating: false })));
    expect(await fetchUpdateInProgress()).toBe(false);
  });

  it("returns null on a missing file or a malformed body", async () => {
    server.use(http.get("*/notice/notice.json", () => new HttpResponse(null, { status: 404 })));
    expect(await fetchUpdateInProgress()).toBeNull();
    server.use(http.get("*/notice/notice.json", () => HttpResponse.json({ updating: "yes" })));
    expect(await fetchUpdateInProgress()).toBeNull();
    server.use(http.get("*/notice/notice.json", () => HttpResponse.text("<!doctype html>")));
    expect(await fetchUpdateInProgress()).toBeNull();
  });
});
