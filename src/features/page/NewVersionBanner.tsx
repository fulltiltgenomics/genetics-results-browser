import { useEffect, useState } from "react";
import { Alert, Button, Snackbar } from "@mui/material";
import { APP_NAME } from "@/config/appName";

// index.html is served no-store, so a navigation always gets the current build; a tab that
// stays open across a deploy does not, and keeps running a bundle the backend has moved on
// from (the first visible casualty was a chat stream event the old bundle silently dropped)
const VERSION_URL = `${import.meta.env.BASE_URL}version.json`;
const CHECK_INTERVAL_MS = 5 * 60_000;

// null under `vite dev` and in tests, where no version.json exists either
export const BUILD_ID: string | null = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : null;

export async function fetchDeployedBuildId(): Promise<string | null> {
  try {
    const response = await fetch(VERSION_URL, { cache: "no-store" });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const build = (body as { build?: unknown } | null)?.build;
    return typeof build === "string" ? build : null;
  } catch {
    return null;
  }
}

// true once the deployed build id differs from the one this bundle was built with. Checked
// when the tab becomes visible and on an interval, never at mount (a fresh load matches by
// construction). Any failure to read the file counts as "no news". During a rolling update
// an old pod can still answer, so a just-reloaded tab may be told once more to reload
export function useNewVersionAvailable(
  current: string | null,
  check: () => Promise<string | null> = fetchDeployedBuildId,
): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (current === null || stale) return;
    let cancelled = false;
    const run = async () => {
      const deployed = await check();
      if (!cancelled && deployed !== null && deployed !== current) setStale(true);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void run();
    };
    const timer = window.setInterval(() => void run(), CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [current, check, stale]);
  return stale;
}

export function NewVersionBanner() {
  const stale = useNewVersionAvailable(BUILD_ID);
  return (
    <Snackbar open={stale} anchorOrigin={{ vertical: "top", horizontal: "center" }}>
      <Alert
        severity="warning"
        action={
          <Button color="inherit" size="small" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }>
        A new version of {APP_NAME} has been deployed. Reload the page to keep everything working.
      </Alert>
    </Snackbar>
  );
}
