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
  clickRegion,
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
import { AssocIndex, AssocView, Region, variantId } from "./geneAssociation";

/**
 * The two tracks of the variant association tab on one canvas: every variant of the credible sets
 * as a dot at its highest PIP, and the genes below it, split by strand.
 *
 * The view lives in a ref and the canvas is repainted from an animation frame, so a zoom or a pan
 * never renders React. What is under the pointer is written into one fixed line below the tracks.
 */

const HINT =
  "ctrl/⌘ + scroll to zoom · drag to pan · click to select · shift + drag to select a region";
const FONT = '11px "Roboto", "Helvetica", "Arial", sans-serif';

export interface AssocTracksHandle {
  zoomBy: (factor: number) => void;
  reset: () => void;
  // rings the members of a credible set, for the table row under the pointer
  highlightSet: (set: number | null) => void;
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
  selection: Region | null;
  onSelect: (selection: Region | null) => void;
  onViewFlags: (flags: ViewFlags) => void;
  // the padded region's data is what `index` holds
  complete: boolean;
}

interface Drag {
  x0: number;
  x1: number;
  view0: Region;
  mode: "pending" | "pan" | "region";
}

const AssocTracks = ({
  ref,
  index,
  view,
  genes,
  limits,
  defaultView,
  selection,
  onSelect,
  onViewFlags,
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
  const flags = useRef<ViewFlags>({ atLimits: false, isDefault: true });

  const dots = useMemo<DotData & { order: Int32Array }>(() => {
    let maxNSets = 1;
    for (const n of view.variantNSets) {
      maxNSets = Math.max(maxNSets, n);
    }
    // painted back to front: what the table does not list, then non-coding, coding and LoF, and
    // within each the large dots first so a small one is never buried
    const classes = index.summary.variants.variantClass;
    const order = Int32Array.from({ length: index.nVariants }, (_, i) => i)
      .filter((v) => view.variantNSets[v] > 0)
      .sort(
        (a, b) =>
          view.variantInTable[a] - view.variantInTable[b] ||
          classes[a] - classes[b] ||
          view.variantNSets[b] - view.variantNSets[a]
      );
    return {
      positions: index.variantPos,
      maxPip: view.variantMaxPip,
      nSets: view.variantNSets,
      maxNSets,
      order,
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
    dots,
    colours,
    complete,
  };
  const sceneRef = useRef(scene);
  useLayoutEffect(() => {
    sceneRef.current = scene;
  });

  const paint = () => {
    frame.current = 0;
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    const w = width.current;
    if (!el || !ctx || w === 0) {
      return;
    }
    const s = sceneRef.current;
    const v = viewRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, TRACK.height);
    ctx.font = FONT;
    ctx.textBaseline = "alphabetic";

    // PIP axis
    ctx.strokeStyle = s.colours.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const pip of [0, 0.5, 1]) {
      const y = Math.round(pipToY(pip)) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // selection, under the marks
    const band =
      drag.current?.mode === "region"
        ? dragRegion(drag.current.x0, drag.current.x1, v, w)
        : s.selection;
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

    // variants: the unlisted and the non-coding go in as one translucent path per group, the few
    // coding ones singly with a surface edge so they stay apart
    const { positions, maxPip, nSets, maxNSets, order } = s.dots;
    const classes = s.index.summary.variants.variantClass;
    const span = viewSpan(v);
    let group = -1;
    const flush = () => {
      if (group >= 0) {
        ctx.fill();
      }
    };
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      const r = dotRadius(nSets[id], maxNSets);
      const x = ((positions[id] - v.start) / span) * w;
      if (x < -r || x > w + r) {
        continue;
      }
      const y = pipToY(maxPip[id]);
      const cls = classes[id];
      const listed = s.view.variantInTable[id] === 1;
      const single = listed && cls !== VARIANT_CLASS.other;
      const key = single ? 100 : (listed ? 10 : 0) + cls;
      if (key !== group || single) {
        flush();
        group = key;
        ctx.beginPath();
        ctx.fillStyle =
          cls === VARIANT_CLASS.lof
            ? s.colours.lof
            : cls === VARIANT_CLASS.coding
              ? s.colours.coding
              : s.colours.other;
        ctx.globalAlpha = single ? 1 : listed ? 0.7 : cls === VARIANT_CLASS.other ? 0.28 : 0.4;
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
        ctx.strokeStyle = s.colours.surface;
        ctx.lineWidth = 1;
        ctx.stroke();
        group = -1;
      }
    }
    flush();
    ctx.globalAlpha = 1;

    // rings: the members of the set under the table pointer, and the variant under this one
    const ring = (id: number, colour: string) => {
      if (nSets[id] === 0) {
        return;
      }
      ctx.beginPath();
      ctx.arc(
        bpToX(positions[id], v, w),
        pipToY(maxPip[id]),
        dotRadius(nSets[id], maxNSets) + 2,
        0,
        2 * Math.PI
      );
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    const set = highlightedSet.current;
    if (set != null && set < s.index.nSets) {
      for (let m = s.index.memberStart[set]; m < s.index.memberStart[set + 1]; m++) {
        ring(s.index.memberVariant[m], s.colours.strong);
      }
    }
    if (hoveredVariant.current != null && hoveredVariant.current < s.index.nVariants) {
      ring(hoveredVariant.current, s.colours.strong);
    }

    ctx.fillStyle = s.colours.text;
    ctx.textAlign = "left";
    for (const pip of [0.5, 1]) {
      ctx.fillText(`PIP ${pip}`, 2, pipToY(pip) - 3);
    }

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
    schedule();
  });

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
    return () => {
      observer?.disconnect();
      box.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pointerX = (e: React.PointerEvent) =>
    e.clientX - container.current!.getBoundingClientRect().left;

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
      return [
        variantId(s.index, hit),
        variants.consequence[hit] < 0
          ? null
          : cleanConsequence(consequences[variants.consequence[hit]]),
        variants.gene[hit] < 0 ? null : geneNames[variants.gene[hit]],
        `highest PIP ${s.dots.maxPip[hit].toPrecision(3)}`,
        `in ${n.toLocaleString()} credible set${n === 1 ? "" : "s"}`,
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
    drag.current = {
      x0: x,
      x1: x,
      view0: viewRef.current,
      mode: e.shiftKey ? "region" : "pending",
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const x = pointerX(e);
    const d = drag.current;
    if (!d) {
      say(describe(x, e.clientY - container.current!.getBoundingClientRect().top));
      return;
    }
    d.x1 = x;
    if (d.mode === "pending" && Math.abs(x - d.x0) > DRAG_THRESHOLD) {
      d.mode = "pan";
      e.currentTarget.style.cursor = "grabbing";
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
    e.currentTarget.style.cursor = "";
    if (!d || width.current === 0) {
      return;
    }
    const v = viewRef.current;
    const current = sceneRef.current.selection;
    if (d.mode === "region" && Math.abs(d.x1 - d.x0) > DRAG_THRESHOLD) {
      onSelect(dragRegion(d.x0, d.x1, v, width.current));
    } else if (d.mode !== "pan") {
      const bp = xToBp(d.x0, v, width.current);
      // a click on the selection puts it away
      onSelect(
        current && bp >= current.start && bp <= current.end
          ? null
          : clickRegion(d.x0, v, width.current)
      );
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
        }}
        onPointerLeave={() => {
          if (hoveredVariant.current != null) {
            hoveredVariant.current = null;
            schedule();
          }
          say(HINT);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && sceneRef.current.selection) {
            onSelect(null);
          }
        }}
        sx={{
          height: TRACK.height,
          cursor: "grab",
          // a vertical swipe still scrolls the page; a horizontal one pans the tracks
          touchAction: "pan-y",
          userSelect: "none",
          outline: "none",
          "&:focus-visible": {
            boxShadow: (t) => `0 0 0 1px ${t.palette.primary.main}`,
          },
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
