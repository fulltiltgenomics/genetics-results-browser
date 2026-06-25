// hover-highlight for the multi-line quality plots. hovering a line (or its
// legend item) highlights that series and dims the others so a single issue
// category / disposition can be followed across an otherwise messy plot.
//
// design: we keep the highlighted dataset index in a ref (NOT React state) so a
// mousemove never re-renders the React tree. the dataset border/background
// colours and widths are chart.js *scriptable* options that read that ref, so a
// cheap chart.update("none") re-applies the dim/highlight with no animation and
// no flicker. onHover / legend.onHover mutate the ref and update the chart only
// when the highlighted index actually changes.

import { useMemo, useRef } from "react";
import type { Chart, ChartEvent, LegendItem, LegendElement } from "chart.js";

// alpha applied to a non-highlighted series' colour when some other series is
// highlighted. low enough to recede, high enough to keep its shape readable.
const DIM_ALPHA = 0.15;

// expand a 3/6-digit hex colour to "#rrggbb". returns null for anything else
// (e.g. already-rgba strings) so callers can fall back to the original.
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// derive a dimmed version of a base series colour by lowering its alpha. the
// dim effect is always derived from the existing colour (never a new hardcoded
// colour) so highlighting can't change which colour means which series.
export function dimColor(base: string, alpha: number = DIM_ALPHA): string {
  const rgb = hexToRgb(base);
  if (!rgb) return base; // unknown format: leave as-is rather than guess
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

// pick the dataset index to render for a given series index, given which index
// (if any) is currently highlighted. exported for unit testing the branching.
export function resolveLineStyle(
  seriesIndex: number,
  highlighted: number | null,
  base: string,
  baseWidth: number
): { color: string; width: number } {
  if (highlighted === null) return { color: base, width: baseWidth };
  if (highlighted === seriesIndex) return { color: base, width: baseWidth + 1 };
  return { color: dimColor(base), width: baseWidth };
}

export interface HighlightHandlers {
  // chart-level options patch: scriptable colours/widths + onHover. spread onto
  // each dataset via styleDataset, and merge `chartOptions` into the chart options.
  styleDataset: <T extends { borderColor?: unknown; backgroundColor?: unknown; borderWidth?: number }>(
    dataset: T
  ) => T;
  onHover: (event: ChartEvent, _active: unknown[], chart: Chart) => void;
  legendOnHover: (event: ChartEvent, item: LegendItem, legend: LegendElement<"line">) => void;
  legendOnLeave: (event: ChartEvent, item: LegendItem, legend: LegendElement<"line">) => void;
}

// shared hook: returns dataset stylers + hover handlers backed by a per-chart
// ref. call it once per chart (each instance gets its own highlighted ref).
export function useLineHighlight(): HighlightHandlers {
  const highlightedRef = useRef<number | null>(null);

  return useMemo<HighlightHandlers>(() => {
    const setHighlighted = (chart: Chart, index: number | null): void => {
      if (highlightedRef.current === index) return; // skip no-op updates -> no flicker
      highlightedRef.current = index;
      chart.update("none");
    };

    return {
      styleDataset: (dataset) => {
        // capture the base colour/width at dataset-build time; scriptable
        // callbacks then derive dim/highlight from these per render.
        const baseColor = typeof dataset.borderColor === "string" ? dataset.borderColor : "#000000";
        const baseWidth = typeof dataset.borderWidth === "number" ? dataset.borderWidth : 1.5;
        const colorScriptable = (ctx: { datasetIndex: number }) =>
          resolveLineStyle(ctx.datasetIndex, highlightedRef.current, baseColor, baseWidth).color;
        return {
          ...dataset,
          borderColor: colorScriptable,
          backgroundColor: colorScriptable,
          borderWidth: (ctx: { datasetIndex: number }) =>
            resolveLineStyle(ctx.datasetIndex, highlightedRef.current, baseColor, baseWidth).width,
        };
      },

      onHover: (event, _active, chart) => {
        // "dataset" mode finds the nearest line under the cursor regardless of
        // which point we're over, which is what "follow this line" needs.
        const elements = chart.getElementsAtEventForMode(
          event.native as Event,
          "dataset",
          { intersect: false },
          false
        );
        setHighlighted(chart, elements.length > 0 ? elements[0].datasetIndex : null);
      },

      legendOnHover: (_event, item, legend) => {
        if (item.datasetIndex != null) setHighlighted(legend.chart, item.datasetIndex);
      },
      legendOnLeave: (_event, _item, legend) => {
        setHighlighted(legend.chart, null);
      },
    };
  }, []);
}
