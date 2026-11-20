import { Ref, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { Box, useTheme } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { VARIANT_CLASS } from "../../../bff/geneAssociationTypes";
import { cleanConsequence } from "../table/utils/tableutil";
import { assocPerf } from "./assocPerf";
import {
  axisTicks,
  bpToX,
  clampView,
  DotData,
  dotRadius,
  DRAG_THRESHOLD,
  dragRegion,
  geneBox,
  hitGene,
  hitVariant,
  pipToY,
  placeGeneLabels,
  TRACK,
  TrackGene,
  VARIANT_COLOURS,
  viewSpan,
  wheelZoomFactor,
  xToBp,
  zoomAt,
} from "./assocTrack";
import { chrName, formatSpan } from "./geneAnnotation";
import {
  AssocIndex,
  AssocView,
  Region,
  Selection,
  variantId,
  variantsInRegion,
} from "./geneAssociation";

/**
 * The two tracks of the variant association tab on one canvas: every variant of the credible sets
 * as a dot at its highest PIP, and the genes below it, split by strand.
 *
 * The view lives in a ref and the canvas is repainted from an animation frame, so a zoom or a pan
 * never renders React. What is under the pointer is written into one fixed line below the tracks.
 */

const HINT =
  "click a variant for its credible sets · drag to select a region · hold ctrl/⌘ to zoom by scrolling and pan by dragging";
const FONT = '11px "Roboto", "Helvetica", "Arial", sans-serif';

export interface AssocTracksHandle {
  zoomBy: (factor: number) => void;
  reset: () => void;
  // rings the members of a credible set, for the table row under the pointer
  highlightSet: (set: number | null) => void;
  // the credible sets whose rows are open in the table
  showSets: (sets: number[]) => void;
}

export interface ViewFlags {
  atLimits: boolean;
  isDefault: boolean;
}

interface Props {
  ref: Ref<AssocTracksHandle>;
  index: AssocIndex;
  view: AssocView;
  genes: TrackGene[];
  limits: Region;
  defaultView: Region;
  selection: Selection | null;
  // the selected variant in `index`, when the selection is one and the index holds it
  selectedVariant: number | null;
  onSelect: (selection: Selection | null) => void;
  onViewFlags: (flags: ViewFlags) => void;
  // the view once it has stopped moving, in whole base pairs
  onViewSettled: (view: Region) => void;
  // the variants inside the view and how many of them are not faint, on every paint that changes
  // either
  onViewCount: (count: number, passing: number) => void;
  // the padded region's data is what `index` holds
  complete: boolean;
}

type Colours = Record<"lof" | "coding" | "other" | "surface" | "strong", string>;

interface DotLayer {
  canvas: HTMLCanvasElement;
  // what it was last drawn from; a change in any of these makes it stale
  dots: unknown;
  colours: unknown;
  width: number;
  // the stretch it covers, which is wider than the view it was drawn for
  view: Region | null;
  drawnFor: Region | null;
  drawnAt: number;
  marks: number;
  // least time between two redraws while the view is moving
  interval: number;
}

// with more marks than this the layer is not redrawn on every frame of a moving view. Measured
// on a view of about two thousand: drawing them took 2 ms of script and another 4 ms to hand to
// the compositor, every frame, four times that under a 4x CPU throttle
const HEAVY_LAYER_MARKS = 600;
// bounds on the time between two redraws of such a layer while the view is moving
const MIN_LAYER_INTERVAL_MS = 96;
const MAX_LAYER_INTERVAL_MS = 400;
// how long the view has to rest before a stretched layer is drawn again
const SETTLE_MS = 100;
// how long it has to rest before the table follows it
const VIEW_SETTLED_MS = 160;
// share of the view the layer reaches beyond either edge, so a pan has marks to bring in
const LAYER_MARGIN = 0.25;

interface Scene {
  index: AssocIndex;
  view: AssocView;
  dots: Dots;
  colours: Colours;
}

interface Dots extends DotData {
  // drawn variants, back to front
  order: Int32Array;
  // the view's variantPasses; the others are faint
  passes: Uint8Array;
  // passingBefore[i] is the number of those among the first i variants
  passingBefore: Uint32Array;
}

// every variant the layer covers: the faint and the non-coding go in as one path per group, the
// few coding ones that are not faint singly with an edge so they stay apart
const drawDots = (layer: DotLayer, s: Scene, v: Region, w: number, dpr: number) => {
  const { canvas } = layer;
  const width = w * (1 + 2 * LAYER_MARGIN);
  const covered = {
    start: v.start - LAYER_MARGIN * viewSpan(v),
    end: v.end + LAYER_MARGIN * viewSpan(v),
  };
  if (canvas.width !== Math.round(width * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(TRACK.height * dpr);
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, TRACK.height);
  const { positions, maxPip, nSets, maxNSets, order, passes } = s.dots;
  const classes = s.index.summary.variants.variantClass;
  const span = viewSpan(covered);
  let marks = 0;
  let group = -1;
  const flush = () => {
    if (group >= 0) {
      ctx.fill();
    }
  };
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const r = dotRadius(nSets[id], maxNSets);
    const x = ((positions[id] - covered.start) / span) * width;
    if (x < -r || x > width + r) {
      continue;
    }
    marks++;
    const y = pipToY(maxPip[id]);
    const cls = classes[id];
    const single = passes[id] === 1 && cls !== VARIANT_CLASS.other;
    const key = single ? 100 : passes[id] * 10 + cls;
    if (key !== group || single) {
      flush();
      group = key;
      ctx.beginPath();
      const colour =
        cls === VARIANT_CLASS.lof
          ? s.colours.lof
          : cls === VARIANT_CLASS.coding
            ? s.colours.coding
            : s.colours.other;
      ctx.fillStyle = colour;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      // a faint mark still has to read as a variant of its class beside the others
      ctx.globalAlpha =
        passes[id] === 0 ? (cls === VARIANT_CLASS.other ? 0.18 : 0.27) : single ? 1 : 0.85;
    }
    if (cls === VARIANT_CLASS.lof) {
      const d = r * 1.25;
      ctx.moveTo(x, y - d);
      ctx.lineTo(x + d, y);
      ctx.lineTo(x, y + d);
      ctx.lineTo(x - d, y);
      ctx.closePath();
    } else {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, 2 * Math.PI);
    }
    if (single) {
      ctx.fill();
      // a dark edge on the viewed gene's own coding variants; a neighbour's get the surface's
      const own = s.index.variantCodingInGene[id] === 1;
      ctx.strokeStyle = own ? s.colours.strong : s.colours.surface;
      ctx.lineWidth = own ? 1.75 : 1;
      ctx.stroke();
      group = -1;
    }
  }
  flush();
  ctx.globalAlpha = 1;
  layer.marks = marks;
  layer.dots = s.dots;
  layer.colours = s.colours;
  layer.width = w;
  layer.view = covered;
  layer.drawnFor = v;
};

interface Drag {
  x0: number;
  x1: number;
  y0: number;
  view0: Region;
  mode: "pending" | "pan" | "region";
  // ctrl or ⌘ was down at the press: the drag moves the view rather than selecting
  pan: boolean;
}

const AssocTracks = ({
  ref,
  index,
  view,
  genes,
  limits,
  defaultView,
  selection,
  selectedVariant,
  onSelect,
  onViewFlags,
  onViewSettled,
  onViewCount,
  complete,
}: Props) => {
  const theme = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  const viewRef = useRef<Region>(defaultView);
  const width = useRef(0);
  const frame = useRef(0);
  const drag = useRef<Drag | null>(null);
  const hoveredVariant = useRef<number | null>(null);
  const highlightedSet = useRef<number | null>(null);
  const openSets = useRef<number[]>([]);
  const flags = useRef<ViewFlags>({ atLimits: false, isDefault: true });
  const dotLayer = useRef<DotLayer>(null!);
  dotLayer.current ??= {
    canvas: document.createElement("canvas"),
    dots: null,
    colours: null,
    width: 0,
    view: null,
    drawnFor: null,
    drawnAt: 0,
    marks: 0,
    interval: 0,
  };
  const settle = useRef(0);
  const viewSettle = useRef(0);
  const viewCount = useRef(-1);
  const viewPassing = useRef(-1);
  // ctrl or ⌘ is down, as far as the last key or pointer event said
  const navigating = useRef(false);
  // the view has stopped moving, and the layer is owed a redraw whatever its age
  const rested = useRef(false);

  const dots = useMemo<Dots>(() => {
    let maxNSets = 1;
    for (const n of index.variantNSets) {
      maxNSets = Math.max(maxNSets, n);
    }
    const classes = index.summary.variants.variantClass;
    const passes = view.variantPasses;
    const passingBefore = new Uint32Array(index.nVariants + 1);
    for (let v = 0; v < index.nVariants; v++) {
      passingBefore[v + 1] = passingBefore[v] + passes[v];
    }
    // painted back to front: the faint first; within each non-coding, coding and LoF, and
    // within those the large dots first so a small one is never buried
    const order = Int32Array.from({ length: index.nVariants }, (_, i) => i).sort(
      (a, b) =>
        passes[a] - passes[b] ||
        classes[a] - classes[b] ||
        index.variantNSets[b] - index.variantNSets[a]
    );
    return {
      positions: index.variantPos,
      // of every set, so that no filter and no selection moves or resizes a dot
      maxPip: index.variantMaxPip,
      nSets: index.variantNSets,
      maxNSets,
      order,
      passes,
      passingBefore,
    };
  }, [index, view]);

  const colours = useMemo(
    () => ({
      ...VARIANT_COLOURS[theme.palette.mode],
      other: theme.palette.text.secondary,
      surface: theme.palette.background.default,
      grid: theme.palette.divider,
      text: theme.palette.text.secondary,
      strong: theme.palette.text.primary,
      focal: theme.palette.primary.main,
      neighbour: alpha(theme.palette.text.primary, 0.38),
      selection: theme.palette.primary.main,
    }),
    [theme]
  );

  // everything a paint reads, so the handlers and the frame callback never go stale
  const scene = {
    index,
    view,
    genes,
    limits,
    defaultView,
    selection,
    selectedVariant,
    dots,
    colours,
    complete,
    onViewSettled,
    onViewCount,
  };
  const sceneRef = useRef(scene);
  useLayoutEffect(() => {
    sceneRef.current = scene;
  });

  const paint = () => {
    frame.current = 0;
    const s = sceneRef.current;
    const v = viewRef.current;
    const [first, end] = variantsInRegion(s.dots.positions, v);
    const count = end - first;
    const passing = s.dots.passingBefore[end] - s.dots.passingBefore[first];
    if (count !== viewCount.current || passing !== viewPassing.current) {
      viewCount.current = count;
      viewPassing.current = passing;
      s.onViewCount(count, passing);
    }
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    const w = width.current;
    if (!el || !ctx || w === 0) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, TRACK.height);
    ctx.font = FONT;
    ctx.textBaseline = "alphabetic";

    // PIP axis
    ctx.strokeStyle = s.colours.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const pip of [0, 1]) {
      const y = Math.round(pipToY(pip)) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // selection, under the marks
    const band =
      drag.current?.mode === "region"
        ? dragRegion(drag.current.x0, drag.current.x1, v, w)
        : s.selection?.kind === "region"
          ? s.selection
          : null;
    if (band) {
      const x0 = bpToX(band.start, v, w);
      const x1 = Math.max(bpToX(band.end, v, w), x0 + 2);
      if (x1 >= 0 && x0 <= w) {
        ctx.fillStyle = alpha(s.colours.selection, 0.14);
        ctx.fillRect(x0, 6, x1 - x0, TRACK.axis - 6);
        ctx.fillStyle = alpha(s.colours.selection, 0.7);
        ctx.fillRect(x0, 6, 1, TRACK.axis - 6);
        ctx.fillRect(x1 - 1, 6, 1, TRACK.axis - 6);
      }
    }

    // variants, from their own layer. A wide view holds thousands of marks, and drawing them is
    // most of a frame: while the view is moving, a layer with many is redrawn only every so
    // often and stretched over the view in between, then drawn again once the view rests
    const { positions, maxPip, nSets, maxNSets } = s.dots;
    const span = viewSpan(v);
    const layer = dotLayer.current;
    const now = performance.now();
    const current = layer.dots === s.dots && layer.colours === s.colours && layer.width === w;
    const moved = layer.drawnFor?.start !== v.start || layer.drawnFor?.end !== v.end;
    const redraw = !current || (moved && (rested.current || now - layer.drawnAt >= layer.interval));
    clearTimeout(settle.current);
    if (redraw) {
      rested.current = false;
      drawDots(layer, s, v, w, dpr);
      layer.drawnAt = now;
    } else if (moved) {
      settle.current = window.setTimeout(() => {
        rested.current = true;
        schedule();
      }, SETTLE_MS);
    }
    const drawn = layer.view!;
    ctx.drawImage(
      layer.canvas,
      ((drawn.start - v.start) / span) * w,
      0,
      (viewSpan(drawn) / span) * w,
      TRACK.height
    );
    if (redraw) {
      // timed through the copy above, which is when the layer's marks are actually rasterized. a
      // layer with few marks is drawn every frame; one with many gets an eighth of the time
      const cost = performance.now() - now;
      layer.interval =
        layer.marks <= HEAVY_LAYER_MARKS
          ? 0
          : Math.min(MAX_LAYER_INTERVAL_MS, Math.max(MIN_LAYER_INTERVAL_MS, 8 * cost));
    }

    // rings: the members of the set under the table pointer, and the variant under this one
    const ring = (id: number, colour: string, lineWidth = 1.5) => {
      ctx.beginPath();
      ctx.arc(
        bpToX(positions[id], v, w),
        pipToY(maxPip[id]),
        dotRadius(nSets[id], maxNSets) + 2,
        0,
        2 * Math.PI
      );
      ctx.strokeStyle = colour;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    };
    if (s.selectedVariant != null) {
      ring(s.selectedVariant, s.colours.selection, 2.5);
    }
    // a set of the table: its members ringed, and a bar at the PIP each has in this set, which
    // is not where the dot is when another set gives the variant a higher one
    const showSet = (set: number, rings: boolean) => {
      if (set >= s.index.nSets) {
        return;
      }
      ctx.fillStyle = s.colours.strong;
      for (let m = s.index.memberStart[set]; m < s.index.memberStart[set + 1]; m++) {
        const id = s.index.memberVariant[m];
        if (rings) {
          ring(id, s.colours.strong);
        }
        const x = bpToX(positions[id], v, w);
        if (x >= -6 && x <= w + 6) {
          ctx.fillRect(x - 5, pipToY(s.index.memberPip[m]) - 1, 10, 2);
        }
      }
    };
    for (const set of openSets.current) {
      showSet(set, false);
    }
    if (highlightedSet.current != null) {
      showSet(highlightedSet.current, true);
    }
    if (hoveredVariant.current != null && hoveredVariant.current < s.index.nVariants) {
      ring(hoveredVariant.current, s.colours.strong);
    }

    ctx.fillStyle = s.colours.text;
    ctx.textAlign = "left";
    ctx.fillText("PIP 1", 2, pipToY(1) - 3);

    // genes
    ctx.strokeStyle = s.colours.grid;
    ctx.beginPath();
    ctx.moveTo(0, TRACK.centre + 0.5);
    ctx.lineTo(w, TRACK.centre + 0.5);
    ctx.stroke();
    // the viewed gene last, over what it overlaps
    for (const pass of [false, true]) {
      for (const gene of s.genes) {
        if (gene.focal !== pass || gene.end < v.start || gene.start > v.end) {
          continue;
        }
        const { top, height } = geneBox(gene);
        const mid = top + height / 2;
        const colour = gene.focal ? s.colours.focal : s.colours.neighbour;
        const x0 = Math.max(-2, bpToX(gene.start, v, w));
        const x1 = Math.min(w + 2, bpToX(gene.end, v, w));
        ctx.fillStyle = colour;
        ctx.fillRect(x0, mid - 0.5, Math.max(1, x1 - x0), gene.focal ? 1.5 : 1);
        for (const exon of gene.exons) {
          if (exon.end < v.start || exon.start > v.end) {
            continue;
          }
          const ex0 = bpToX(exon.start, v, w);
          const ex1 = bpToX(exon.end, v, w);
          // untranslated sequence at half the height of coding sequence
          const utr = height / 2;
          ctx.fillRect(ex0, mid - utr / 2, Math.max(1, ex1 - ex0), utr);
          if (exon.cds) {
            const c0 = bpToX(exon.cds.start, v, w);
            const c1 = bpToX(exon.cds.end, v, w);
            ctx.fillRect(c0, top, Math.max(1, c1 - c0), height);
          }
        }
        if (gene.focal) {
          // direction of transcription along the introns that have room for it
          ctx.strokeStyle = colour;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let i = 0; i + 1 < gene.exons.length; i++) {
            const from = Math.max(bpToX(gene.exons[i].end, v, w), 0);
            const to = Math.min(bpToX(gene.exons[i + 1].start, v, w), w);
            if (to - from < 40) {
              continue;
            }
            const x = (from + to) / 2;
            const a = 3.5 * gene.strand;
            ctx.moveTo(x - a / 2, mid - 3.5);
            ctx.lineTo(x + a / 2, mid);
            ctx.lineTo(x - a / 2, mid + 3.5);
          }
          ctx.stroke();
        }
      }
    }
    ctx.textAlign = "center";
    for (const label of placeGeneLabels(s.genes, v, w, (text) => ctx.measureText(text).width)) {
      ctx.fillStyle = label.gene.focal ? s.colours.strong : s.colours.text;
      ctx.font = label.gene.focal ? `bold ${FONT}` : FONT;
      ctx.fillText(
        label.text,
        label.x,
        label.gene.strand === 1 ? TRACK.forwardLabel : TRACK.reverseLabel
      );
    }
    ctx.font = FONT;

    // position axis
    ctx.fillStyle = s.colours.text;
    ctx.strokeStyle = s.colours.grid;
    ctx.beginPath();
    ctx.moveTo(0, TRACK.axis + 0.5);
    ctx.lineTo(w, TRACK.axis + 0.5);
    const ticks = axisTicks(v, w);
    for (const tick of ticks) {
      const x = Math.round(bpToX(tick, v, w)) + 0.5;
      ctx.moveTo(x, TRACK.axis);
      ctx.lineTo(x, TRACK.axis + 4);
      const text = tick.toLocaleString();
      const half = ctx.measureText(text).width / 2;
      if (x - half >= 0 && x + half <= w) {
        ctx.fillText(text, x, TRACK.axis + 15);
      }
    }
    ctx.stroke();

    if (assocPerf) {
      assocPerf.frames++;
      assocPerf.view = { start: v.start, end: v.end };
      assocPerf.firstPaintAt ??= performance.now();
      if (s.complete && !assocPerf.ready) {
        assocPerf.ready = true;
        assocPerf.readyAt = performance.now();
      }
    }
  };

  const schedule = () => {
    if (frame.current === 0) {
      frame.current = requestAnimationFrame(paint);
    }
  };

  const setView = (next: Region) => {
    const s = sceneRef.current;
    const clamped = clampView(next, s.limits);
    viewRef.current = clamped;
    const nextFlags = {
      atLimits: clamped.start <= s.limits.start && clamped.end >= s.limits.end,
      isDefault: clamped.start === s.defaultView.start && clamped.end === s.defaultView.end,
    };
    // the buttons' state is the only part of the view React holds, and it changes rarely
    if (
      nextFlags.atLimits !== flags.current.atLimits ||
      nextFlags.isDefault !== flags.current.isDefault
    ) {
      flags.current = nextFlags;
      onViewFlags(nextFlags);
    }
    // the table follows the view, but only once it rests: a zoom passes through many views
    clearTimeout(viewSettle.current);
    viewSettle.current = window.setTimeout(
      () =>
        sceneRef.current.onViewSettled({
          start: Math.floor(clamped.start),
          end: Math.ceil(clamped.end),
        }),
      VIEW_SETTLED_MS
    );
    schedule();
  };

  useImperativeHandle(ref, () => ({
    zoomBy: (factor) => {
      const v = viewRef.current;
      setView(zoomAt(v, (v.start + v.end) / 2, factor, sceneRef.current.limits));
    },
    reset: () => setView(sceneRef.current.defaultView),
    highlightSet: (set) => {
      if (highlightedSet.current !== set) {
        highlightedSet.current = set;
        schedule();
      }
    },
    showSets: (sets) => {
      openSets.current = sets;
      schedule();
    },
  }));

  // a new gene starts from its own default view
  useLayoutEffect(() => {
    hoveredVariant.current = null;
    highlightedSet.current = null;
    setView(defaultView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultView.start, defaultView.end, limits.start, limits.end]);

  // repaint on any change of what is drawn
  useLayoutEffect(() => {
    hoveredVariant.current = null;
    viewCount.current = -1;
    viewPassing.current = -1;
    schedule();
  });

  // sets are numbered within one summary
  useLayoutEffect(() => {
    highlightedSet.current = null;
    openSets.current = [];
  }, [index]);

  useEffect(() => {
    if (assocPerf) {
      assocPerf.limits = { start: limits.start, end: limits.end };
    }
  }, [limits.start, limits.end]);

  useEffect(() => {
    const box = container.current!;
    const el = canvas.current!;
    const resize = () => {
      const w = box.getBoundingClientRect().width;
      if (w === width.current) {
        return;
      }
      width.current = w;
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.round(w * dpr);
      el.height = Math.round(TRACK.height * dpr);
      // a resized canvas is blank: paint in the same task rather than a frame later
      cancelAnimationFrame(frame.current);
      paint();
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(box);

    // React attaches wheel listeners as passive, and a passive one cannot keep ctrl + wheel from
    // zooming the whole page
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        return;
      }
      e.preventDefault();
      const x = e.clientX - box.getBoundingClientRect().left;
      const v = viewRef.current;
      setView(
        zoomAt(
          v,
          xToBp(x, v, width.current),
          wheelZoomFactor(e.deltaY, e.deltaMode),
          sceneRef.current.limits
        )
      );
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    // the cursor says what a drag would do, so it follows the key and not only the pointer
    const onKey = (e: KeyboardEvent) => {
      navigating.current = e.ctrlKey || e.metaKey;
      if (box.matches(":hover")) {
        showCursor();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      observer?.disconnect();
      box.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      cancelAnimationFrame(frame.current);
      clearTimeout(settle.current);
      clearTimeout(viewSettle.current);
      frame.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pointerX = (e: React.PointerEvent) =>
    e.clientX - container.current!.getBoundingClientRect().left;

  const showCursor = () => {
    const cursor =
      drag.current?.mode === "pan"
        ? "grabbing"
        : drag.current?.mode === "region"
          ? "crosshair"
          : navigating.current
            ? "grab"
            : hoveredVariant.current != null
              ? "pointer"
              : "crosshair";
    if (container.current && container.current.style.cursor !== cursor) {
      container.current.style.cursor = cursor;
    }
  };

  const describe = (x: number, y: number): string => {
    const s = sceneRef.current;
    const v = viewRef.current;
    const w = width.current;
    const hit = hitVariant(s.dots, v, w, x, y);
    if (hoveredVariant.current !== hit) {
      hoveredVariant.current = hit;
      schedule();
    }
    if (hit != null) {
      const { variants, consequences, genes: geneNames } = s.index.summary;
      const n = s.dots.nSets[hit];
      const passing = s.view.variantPassingSets[hit];
      const sets = (k: number) => `${k.toLocaleString()} credible set${k === 1 ? "" : "s"}`;
      return [
        variantId(s.index, hit),
        variants.consequence[hit] < 0
          ? null
          : cleanConsequence(consequences[variants.consequence[hit]]),
        variants.gene[hit] < 0 ? null : geneNames[variants.gene[hit]],
        `highest PIP ${s.dots.maxPip[hit].toPrecision(3)} · in ${sets(n)}`,
        // the dot stays where every set puts it, so what the filters leave of it is said here
        passing === n
          ? null
          : passing === 0
            ? "none passing the filters"
            : `${passing.toLocaleString()} passing the filters, highest PIP ${s.view.variantPassingPip[hit].toPrecision(3)} in those`,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    const gene = hitGene(s.genes, v, w, x, y);
    if (gene) {
      return [
        gene.name,
        `chr${chrName(s.index.summary.chr)}:${gene.start.toLocaleString()}–${gene.end.toLocaleString()}`,
        formatSpan(gene.end - gene.start + 1),
        `${gene.exons.length} exon${gene.exons.length === 1 ? "" : "s"}`,
        gene.strand === 1 ? "forward strand" : "reverse strand",
      ].join(" · ");
    }
    return HINT;
  };

  const say = (text: string) => {
    if (readout.current && readout.current.textContent !== text) {
      readout.current.textContent = text;
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) {
      return;
    }
    const x = pointerX(e);
    navigating.current = e.ctrlKey || e.metaKey;
    drag.current = {
      x0: x,
      x1: x,
      y0: e.clientY - container.current!.getBoundingClientRect().top,
      view0: viewRef.current,
      mode: "pending",
      pan: navigating.current,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const x = pointerX(e);
    const d = drag.current;
    if (!d) {
      navigating.current = e.ctrlKey || e.metaKey;
      say(describe(x, e.clientY - container.current!.getBoundingClientRect().top));
      showCursor();
      return;
    }
    d.x1 = x;
    if (d.mode === "pending" && Math.abs(x - d.x0) > DRAG_THRESHOLD) {
      d.mode = d.pan ? "pan" : "region";
      showCursor();
    }
    if (d.mode === "pan") {
      const shift = ((d.x0 - x) / width.current) * viewSpan(d.view0);
      setView({ start: d.view0.start + shift, end: d.view0.end + shift });
    } else if (d.mode === "region") {
      schedule();
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    navigating.current = e.ctrlKey || e.metaKey;
    showCursor();
    if (!d || width.current === 0) {
      return;
    }
    const s = sceneRef.current;
    const v = viewRef.current;
    if (d.mode === "region") {
      onSelect({ kind: "region", ...dragRegion(d.x0, d.x1, v, width.current) });
    } else if (d.mode === "pending" && !d.pan) {
      // a click: on a variant it selects that variant, or puts it away again. anywhere else it
      // puts the selection away, unless it lands inside the selected region
      const hit = hitVariant(s.dots, v, width.current, d.x0, d.y0);
      const bp = xToBp(d.x0, v, width.current);
      if (hit != null) {
        onSelect(
          hit === s.selectedVariant
            ? null
            : { kind: "variant", id: variantId(s.index, hit), pos: s.index.variantPos[hit] }
        );
      } else if (
        s.selection &&
        (s.selection.kind === "variant" || bp < s.selection.start || bp > s.selection.end)
      ) {
        onSelect(null);
      }
    }
    schedule();
  };

  return (
    <Box>
      <Box
        ref={container}
        data-testid="assoc-tracks"
        role="img"
        aria-label={`credible-set variants and genes around ${index.summary.gene}`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          showCursor();
          schedule();
        }}
        onPointerLeave={() => {
          if (hoveredVariant.current != null) {
            hoveredVariant.current = null;
            schedule();
          }
          say(HINT);
          showCursor();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && sceneRef.current.selection) {
            onSelect(null);
          }
        }}
        sx={{
          height: TRACK.height,
          cursor: "crosshair",
          // a vertical swipe still scrolls the page; a horizontal one selects a region
          touchAction: "pan-y",
          userSelect: "none",
          outline: "none",
          "&:focus-visible": { boxShadow: (t) => `0 0 0 1px ${t.palette.primary.main}` },
        }}>
        <canvas ref={canvas} style={{ display: "block", width: "100%", height: TRACK.height }} />
      </Box>
      <Box
        ref={readout}
        data-testid="assoc-readout"
        sx={{
          mt: 0.5,
          height: "1.25rem",
          lineHeight: "1.25rem",
          fontSize: "0.75rem",
          color: "text.secondary",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        }}>
        {HINT}
      </Box>
    </Box>
  );
};

export default AssocTracks;
