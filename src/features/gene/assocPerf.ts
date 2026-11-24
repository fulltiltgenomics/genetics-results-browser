import type { Region } from "./geneAssociation";

/**
 * Counters a benchmark reads off `window.__assocPerf`. Dev builds only: in a production build
 * `assocPerf` is null and every write to it is skipped.
 */
export interface AssocPerf {
  // the padded region's data is loaded and the tracks have painted it
  ready: boolean;
  view: Region;
  limits: Region;
  // track redraws so far
  frames: number;
  // top-level table rows after filters and selection
  tableRows: number;
  // performance.now() at the first track paint with any data, and with the padded region's
  firstPaintAt: number | null;
  readyAt: number | null;
}

declare global {
  interface Window {
    __assocPerf?: AssocPerf;
  }
}

const create = (): AssocPerf => {
  const perf: AssocPerf = {
    ready: false,
    view: { start: 0, end: 0 },
    limits: { start: 0, end: 0 },
    frames: 0,
    tableRows: 0,
    firstPaintAt: null,
    readyAt: null,
  };
  window.__assocPerf = perf;
  return perf;
};

export const assocPerf: AssocPerf | null = import.meta.env.DEV ? create() : null;
