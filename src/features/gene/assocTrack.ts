import type { GeneModel } from "@/types/types.gene";
import { layoutGeneModel, ModelExon } from "./geneAnnotation";
import type { Region } from "./geneAssociation";

/**
 * Geometry of the variant association tracks: the view and its gestures, where a dot or a gene
 * goes, which labels fit and what lies under the pointer. No canvas in here, so all of it is unit
 * tested; AssocTracks only paints what these return.
 */

// vertical layout in CSS pixels, top to bottom: the PIP scatter, the two gene strands either side
// of a centre line with a label row outside each, and the position axis
export const TRACK = {
  pipTop: 22,
  pipBottom: 132,
  forwardLabel: 157,
  forwardTop: 162,
  centre: 180,
  reverseTop: 184,
  reverseLabel: 211,
  laneHeight: 14,
  halfLaneHeight: 6,
  axis: 222,
  height: 240,
} as const;

// LoF and other coding variants, light / dark; a LoF is also a diamond, so the pair never rests on
// hue alone
export const VARIANT_COLOURS = {
  light: { lof: "#c62828", coding: "#ef8e00" },
  dark: { lof: "#d0343c", coding: "#d08c14" },
};

export const MIN_VIEW_SPAN = 200;
const DOT_RADIUS = { min: 3, max: 10 };
// how far from a dot's edge the pointer still reads it
const HIT_SLOP = 3;
// a click selects this many pixels either side of the pointer, whatever the zoom
const CLICK_HALF_WIDTH = 5;
// pointer travel beyond which a press is a drag rather than a click
export const DRAG_THRESHOLD = 4;
const LABEL_GAP = 8;

export const viewSpan = (view: Region): number => view.end - view.start;

// keeps the span where it can and slides the view back inside the limits
export const clampView = (view: Region, limits: Region): Region => {
  const span = Math.min(Math.max(viewSpan(view), MIN_VIEW_SPAN), viewSpan(limits));
  const start = Math.min(Math.max(view.start, limits.start), limits.end - span);
  return { start, end: start + span };
};

// factor > 1 zooms out; the base pair under `anchor` stays where it is on screen
export const zoomAt = (view: Region, anchor: number, factor: number, limits: Region): Region => {
  const span = Math.min(Math.max(viewSpan(view) * factor, MIN_VIEW_SPAN), viewSpan(limits));
  const share = (anchor - view.start) / viewSpan(view);
  const start = anchor - share * span;
  return clampView({ start, end: start + span }, limits);
};

// wheel travel to zoom factor; a mouse wheel reports lines or large pixel steps, a trackpad pinch
// many small ones, so the step is capped rather than scaled per device
export const wheelZoomFactor = (deltaY: number, deltaMode: number): number => {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(Math.max(-60, Math.min(60, pixels)) * 0.01);
};

export const bpToX = (pos: number, view: Region, width: number): number =>
  ((pos - view.start) / viewSpan(view)) * width;

export const xToBp = (x: number, view: Region, width: number): number =>
  view.start + (x / width) * viewSpan(view);

export const pipToY = (pip: number): number =>
  TRACK.pipBottom - Math.min(1, Math.max(0, pip)) * (TRACK.pipBottom - TRACK.pipTop);

// area, not radius, grows with the number of credible sets
export const dotRadius = (nSets: number, maxNSets: number): number => {
  const share = maxNSets <= 1 ? 0 : (Math.min(nSets, maxNSets) - 1) / (maxNSets - 1);
  return Math.sqrt(DOT_RADIUS.min ** 2 + share * (DOT_RADIUS.max ** 2 - DOT_RADIUS.min ** 2));
};

export const clickRegion = (x: number, view: Region, width: number): Region => ({
  start: Math.floor(xToBp(x - CLICK_HALF_WIDTH, view, width)),
  end: Math.ceil(xToBp(x + CLICK_HALF_WIDTH, view, width)),
});

export const dragRegion = (x0: number, x1: number, view: Region, width: number): Region => ({
  start: Math.floor(xToBp(Math.min(x0, x1), view, width)),
  end: Math.ceil(xToBp(Math.max(x0, x1), view, width)),
});

// [from, to) of the position-sorted variants inside the region
export const variantsInRegion = (
  positions: ArrayLike<number>,
  region: Region
): [number, number] => {
  const bound = (pos: number): number => {
    let lo = 0;
    let hi = positions.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (positions[mid] < pos) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  };
  return [bound(region.start), bound(region.end + 1)];
};

export interface DotData {
  positions: ArrayLike<number>;
  maxPip: ArrayLike<number>;
  nSets: ArrayLike<number>;
  maxNSets: number;
}

/** The drawn variant nearest the pointer among those whose dot it is on or just beside. */
export const hitVariant = (
  dots: DotData,
  view: Region,
  width: number,
  x: number,
  y: number
): number | null => {
  const reach = ((DOT_RADIUS.max + HIT_SLOP) / width) * viewSpan(view);
  const bp = xToBp(x, view, width);
  const [from, to] = variantsInRegion(dots.positions, { start: bp - reach, end: bp + reach });
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let v = from; v < to; v++) {
    if (dots.nSets[v] === 0) {
      continue;
    }
    const distance = Math.hypot(
      bpToX(dots.positions[v], view, width) - x,
      pipToY(dots.maxPip[v]) - y
    );
    if (distance <= dotRadius(dots.nSets[v], dots.maxNSets) + HIT_SLOP && distance < bestDistance) {
      best = v;
      bestDistance = distance;
    }
  }
  return best;
};

export type GeneLane = "full" | "outer" | "inner";

export interface TrackGene {
  name: string;
  start: number;
  end: number;
  strand: 1 | -1;
  focal: boolean;
  lane: GeneLane;
  exons: ModelExon[];
}

/**
 * Genes for the strand-split track. A gene that overlaps another on its strand is drawn at half
 * height in one of two half lanes instead of on a row of its own, so the track's height never
 * depends on the locus. The viewed gene always keeps the full lane, and what overlaps it goes to
 * the outer half, where it shows past the gene's introns. Overlap is in base pairs, so a gene
 * keeps its lane at every zoom.
 */
export const layoutGenes = (models: GeneModel[], focalName: string): TrackGene[] => {
  const genes: TrackGene[] = models.map((model) => {
    const layout = layoutGeneModel(model);
    return {
      name: model.geneName,
      start: layout.start,
      end: layout.end,
      strand: model.strand === -1 ? -1 : 1,
      focal: model.geneName === focalName,
      lane: "full",
      exons: layout.exons,
    };
  });
  for (const strand of [1, -1] as const) {
    const onStrand = genes.filter((g) => g.strand === strand).sort((a, b) => a.start - b.start);
    const focal = onStrand.find((g) => g.focal);
    const overlaps = (a: TrackGene, b: TrackGene) => a.start <= b.end && b.start <= a.end;
    // where the last gene put in each half lane ends
    const laneEnd: Record<"outer" | "inner", number> = { outer: -Infinity, inner: -Infinity };
    for (const gene of onStrand) {
      if (gene.focal) {
        continue;
      }
      if (focal && overlaps(gene, focal)) {
        gene.lane = "outer";
      } else if (
        onStrand.some((other) => other !== gene && !other.focal && overlaps(gene, other))
      ) {
        // the free half lane, or with both taken the one that frees first
        gene.lane =
          gene.start > laneEnd.outer
            ? "outer"
            : gene.start > laneEnd.inner
              ? "inner"
              : laneEnd.outer <= laneEnd.inner
                ? "outer"
                : "inner";
      } else {
        continue;
      }
      laneEnd[gene.lane] = Math.max(laneEnd[gene.lane], gene.end);
    }
  }
  return genes;
};

// top edge and height of a gene's body
export const geneBox = (gene: TrackGene): { top: number; height: number } => {
  const laneTop = gene.strand === 1 ? TRACK.forwardTop : TRACK.reverseTop;
  if (gene.lane === "full") {
    return { top: laneTop, height: TRACK.laneHeight };
  }
  // outer is the half away from the centre line
  const upper = (gene.lane === "outer") === (gene.strand === 1);
  return {
    top: upper ? laneTop : laneTop + TRACK.laneHeight - TRACK.halfLaneHeight,
    height: TRACK.halfLaneHeight,
  };
};

export interface GeneLabel {
  gene: TrackGene;
  // centre of the text
  x: number;
  text: string;
}

/**
 * Gene names that fit. Each strand has one label row; names are offered in order of importance —
 * the viewed gene, then the others by distance from it — and one is placed only where it clears
 * those already placed. A name sits over the visible part of its gene and stays inside the track.
 */
export const placeGeneLabels = (
  genes: TrackGene[],
  view: Region,
  width: number,
  measure: (text: string) => number
): GeneLabel[] => {
  const focal = genes.find((g) => g.focal);
  const centre = focal ? (focal.start + focal.end) / 2 : (view.start + view.end) / 2;
  const distance = (g: TrackGene) => (g.focal ? -1 : Math.max(0, g.start - centre, centre - g.end));
  const placed: GeneLabel[] = [];
  const taken: Record<number, { from: number; to: number }[]> = { 1: [], [-1]: [] };
  for (const gene of [...genes].sort((a, b) => distance(a) - distance(b))) {
    const from = Math.max(0, bpToX(gene.start, view, width));
    const to = Math.min(width, bpToX(gene.end, view, width));
    if (to < from) {
      continue;
    }
    const text = gene.strand === 1 ? `${gene.name} ›` : `‹ ${gene.name}`;
    const half = measure(text) / 2;
    if (2 * half > width) {
      continue;
    }
    const x = Math.min(Math.max((from + to) / 2, half), width - half);
    const row = taken[gene.strand];
    if (row.some((t) => x - half < t.to + LABEL_GAP && x + half > t.from - LABEL_GAP)) {
      continue;
    }
    row.push({ from: x - half, to: x + half });
    placed.push({ gene, x, text });
  }
  return placed;
};

/**
 * The gene under the pointer: on the pointer's side of the centre line, the viewed gene first,
 * then the shortest, since a short gene inside a long one is the harder to point at.
 */
export const hitGene = (
  genes: TrackGene[],
  view: Region,
  width: number,
  x: number,
  y: number
): TrackGene | null => {
  if (y < TRACK.forwardLabel - 12 || y > TRACK.reverseLabel + 4) {
    return null;
  }
  const strand = y < TRACK.centre ? 1 : -1;
  const slop = (2 / width) * viewSpan(view);
  const bp = xToBp(x, view, width);
  let best: TrackGene | null = null;
  for (const gene of genes) {
    if (gene.strand !== strand || bp < gene.start - slop || bp > gene.end + slop) {
      continue;
    }
    if (
      !best ||
      (gene.focal && !best.focal) ||
      (gene.focal === best.focal && gene.end - gene.start < best.end - best.start)
    ) {
      best = gene;
    }
  }
  return best;
};

/** Round positions for the axis, about one per `spacing` pixels. */
export const axisTicks = (view: Region, width: number, spacing = 140): number[] => {
  const target = (viewSpan(view) / width) * spacing;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(target, 1)));
  const step = Math.max(
    1,
    [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= target) ?? 10 * magnitude
  );
  const ticks: number[] = [];
  for (let t = Math.ceil(view.start / step) * step; t <= view.end; t += step) {
    ticks.push(t);
  }
  return ticks;
};
