import { act, render, renderHook, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/msw/server";
import { fetchDeployedBuildId, useNewVersionAvailable, NewVersionBanner } from "./NewVersionBanner";

const FIVE_MINUTES = 5 * 60_000;

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useNewVersionAvailable", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not check at mount and stays current while the deployed id matches", async () => {
    const check = vi.fn(async () => "b1");
    const { result } = renderHook(() => useNewVersionAvailable("b1", check));
    expect(check).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(FIVE_MINUTES));
    expect(check).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(false);
  });

  it("reports a newer deploy found on the interval", async () => {
    const check = vi.fn(async () => "b2");
    const { result } = renderHook(() => useNewVersionAvailable("b1", check));
    await act(() => vi.advanceTimersByTimeAsync(FIVE_MINUTES));
    expect(result.current).toBe(true);
    // settled: no further polling once the answer is known
    await act(() => vi.advanceTimersByTimeAsync(FIVE_MINUTES));
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("checks when the tab becomes visible, not when it is hidden", async () => {
    const check = vi.fn(async () => "b2");
    const { result } = renderHook(() => useNewVersionAvailable("b1", check));
    await act(async () => setVisibility("hidden"));
    expect(check).not.toHaveBeenCalled();
    await act(async () => setVisibility("visible"));
    expect(check).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(true);
  });

  it("treats an unreadable version file as no news", async () => {
    const check = vi.fn(async () => null);
    const { result } = renderHook(() => useNewVersionAvailable("b1", check));
    await act(() => vi.advanceTimersByTimeAsync(FIVE_MINUTES));
    expect(result.current).toBe(false);
  });

  it("never checks without a build id of its own (dev server, tests)", async () => {
    const check = vi.fn(async () => "b2");
    renderHook(() => useNewVersionAvailable(null, check));
    await act(() => vi.advanceTimersByTimeAsync(FIVE_MINUTES));
    expect(check).not.toHaveBeenCalled();
  });
});

describe("fetchDeployedBuildId", () => {
  it("reads the build id out of version.json", async () => {
    server.use(http.get("*/version.json", () => HttpResponse.json({ build: "b7" })));
    expect(await fetchDeployedBuildId()).toBe("b7");
  });

  it("returns null on a missing file or a malformed body", async () => {
    server.use(http.get("*/version.json", () => new HttpResponse(null, { status: 404 })));
    expect(await fetchDeployedBuildId()).toBeNull();
    server.use(http.get("*/version.json", () => HttpResponse.json({ build: 7 })));
    expect(await fetchDeployedBuildId()).toBeNull();
    server.use(http.get("*/version.json", () => HttpResponse.text("not json")));
    expect(await fetchDeployedBuildId()).toBeNull();
  });
});

describe("NewVersionBanner", () => {
  it("renders nothing while this bundle has no build id", () => {
    render(<NewVersionBanner />);
    expect(screen.queryByText(/new version/i)).toBeNull();
  });
});
