import { useCallback, useEffect, useState } from "react";

// matches `#schema/<view_name>` where view_name is lowercase alphanumeric + underscores
const HASH_PATTERN = /^#schema\/([a-z0-9_]+)$/;

interface SchemaHashRoute {
  open: boolean;
  selectedView: string | null;
  openTo: (name: string) => void;
  openEmpty: () => void;
  close: () => void;
}

// keep pathname+search, only rewrite the hash portion via replaceState so back/forward
// don't accumulate drawer open/close entries
function _replaceHash(newHashWithLeadingHash: string) {
  const { pathname, search } = window.location;
  history.replaceState(null, "", `${pathname}${search}${newHashWithLeadingHash}`);
}

function _parseHash(): string | null {
  const match = HASH_PATTERN.exec(window.location.hash);
  return match ? match[1] : null;
}

/**
 * URL hash deep-link routing for SchemaDrawer.
 * - `#schema/<view>` opens the drawer at <view> if it's a known view name
 * - selecting a view updates the hash via replaceState
 * - closing the drawer clears the hash (only if it currently belongs to us)
 * - unknown view names are ignored (drawer stays closed, hash untouched)
 * - if known views are not yet available (schema loading), pending hash is held and
 *   reconciled once `knownViews` arrives
 */
export function useSchemaHashRoute(knownViews: string[] | undefined): SchemaHashRoute {
  const [open, setOpen] = useState(false);
  const [selectedView, setSelectedView] = useState<string | null>(null);
  // hash captured before knownViews resolved; reconciled by the effect below
  const [pendingHash, setPendingHash] = useState<string | null>(() => _parseHash());

  // reconcile pending hash against known views once they load
  useEffect(() => {
    if (!knownViews || pendingHash === null) return;
    if (knownViews.includes(pendingHash)) {
      setOpen(true);
      setSelectedView(pendingHash);
    }
    setPendingHash(null);
  }, [knownViews, pendingHash]);

  // listen for hashchange (e.g. user pastes a deep link, middle-click navigation,
  // or auto-linkified view names from chat markdown)
  useEffect(() => {
    const handler = () => {
      const name = _parseHash();
      if (name === null) {
        // hash cleared or not ours — leave drawer state alone (close() handles our own clears)
        return;
      }
      if (!knownViews) {
        setPendingHash(name);
        return;
      }
      if (knownViews.includes(name)) {
        setOpen(true);
        setSelectedView(name);
      }
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, [knownViews]);

  const openTo = useCallback((name: string) => {
    setOpen(true);
    setSelectedView(name);
    _replaceHash(`#schema/${name}`);
  }, []);

  const openEmpty = useCallback(() => {
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    // only clear hash if it currently belongs to us; avoid stomping unrelated hashes
    if (HASH_PATTERN.test(window.location.hash)) {
      _replaceHash("");
    }
  }, []);

  return { open, selectedView, openTo, openEmpty, close };
}
