import { useEffect, useState } from "react";

// not part of the build: the deployment mounts this file into the served tree and rewrites it
// while a deploy runs, so a tab learns of the update without a new bundle
const NOTICE_URL = `${import.meta.env.BASE_URL}notice/notice.json`;
const CHECK_INTERVAL_MS = 60_000;

// null when the file cannot be read or does not say; the caller then keeps what it last knew
export async function fetchUpdateInProgress(): Promise<boolean | null> {
  try {
    const response = await fetch(NOTICE_URL, { cache: "no-store" });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const updating = (body as { updating?: unknown } | null)?.updating;
    return typeof updating === "boolean" ? updating : null;
  } catch {
    return null;
  }
}

// whether the deployment says an update is running. Checked at mount, when the tab becomes
// visible and on an interval. An unreadable file changes nothing: the pod serving it is itself
// replaced during a deploy, and the notice should not flicker off while that happens
export function useUpdateInProgress(
  enabled: boolean,
  check: () => Promise<boolean | null> = fetchUpdateInProgress,
): boolean {
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = async () => {
      const answer = await check();
      if (!cancelled && answer !== null) setUpdating(answer);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void run();
    };
    void run();
    const timer = window.setInterval(() => void run(), CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, check]);
  return updating;
}
