import { PointerEvent, ReactNode, useMemo, useRef } from "react";
import { Box, Tooltip, Typography, useTheme } from "@mui/material";
import { GeneModel } from "@/types/types.gene";
import { chrName, formatSpan, layoutGeneModel, ModelExon } from "./geneAnnotation";

/**
 * The canonical transcript drawn the way a genome browser draws it: a line for the introns, a tall
 * box for coding sequence and a shorter one for UTR, in genomic orientation with arrows giving the
 * direction of transcription. Positions are percentages, so the drawing follows the container's
 * width without being measured.
 */

const HEIGHT = 44;
const MID = 18;
const CDS_HEIGHT = 20;
const UTR_HEIGHT = 10;
const ARROW = 4;
// room above the transcript for the variant track, and the height a PIP of 1 reaches in it
const TRACK_HEIGHT = 72;
const PIP_HEIGHT = 56;
// how far a mark reaches above and below the middle of the transcript
const MARK_REACH = 15;
// an intron narrower than this share of the view has no room for an arrow
const MIN_ARROW_FRACTION = 0.04;

export type VariantClass = "lof" | "coding" | "other";

export interface ModelVariant {
  pos: number;
  pip: number;
  variantClass: VariantClass;
  title: string;
}

// a vertical line across the transcript at one variant
export interface ModelMark {
  key: string;
  pos: number;
  variantClass: VariantClass;
  tooltip: ReactNode;
}

export interface ModelView {
  start: number;
  end: number;
}

// LoF and other coding variants, light / dark; a LoF is also a diamond, so the pair never rests on
// hue alone
const VARIANT_COLOURS = {
  light: { lof: "#c62828", coding: "#ef8e00" },
  dark: { lof: "#d0343c", coding: "#d08c14" },
};
// drawn in this order, so a coding variant is never hidden under a non-coding neighbour
const DRAW_ORDER: VariantClass[] = ["other", "coding", "lof"];
const MARKER_RADIUS = { lof: 5, coding: 4.5, other: 3 };

const byDrawOrder = (a: { variantClass: VariantClass }, b: { variantClass: VariantClass }) =>
  DRAW_ORDER.indexOf(a.variantClass) - DRAW_ORDER.indexOf(b.variantClass);

const exonTitle = (exon: ModelExon, total: number): string => {
  const coding =
    exon.cds == null
      ? "untranslated"
      : exon.cds.start === exon.start && exon.cds.end === exon.end
        ? "coding"
        : "partly coding";
  return `exon ${exon.number} of ${total} · ${exon.start.toLocaleString()}–${exon.end.toLocaleString()} · ${(exon.end - exon.start + 1).toLocaleString()} bp · ${coding}`;
};

/**
 * `variants` turns on a track above the transcript with one lollipop per variant, as tall as its
 * PIP, and a count at either edge of the variants beyond the view. Pass null to keep the track's
 * room while there is nothing to show, so the drawing does not jump when variants arrive.
 *
 * `view` is the stretch of the chromosome drawn, the transcript by default; with `onViewChange` the
 * drawing can be dragged sideways.
 */
const GeneModelPlot = ({
  model,
  view,
  onViewChange,
  variants,
  marks,
  exonTooltips = true,
}: {
  model: GeneModel;
  view?: ModelView;
  onViewChange?: (view: ModelView) => void;
  variants?: ModelVariant[] | null;
  marks?: ModelMark[];
  exonTooltips?: boolean;
}) => {
  const theme = useTheme();
  const layout = useMemo(() => layoutGeneModel(model), [model]);
  const colour = theme.palette.primary.main;
  const start = view?.start ?? layout.start;
  const end = view?.end ?? layout.end;
  const span = Math.max(1, end - start);
  const pct = (pos: number) => `${((pos - start) / span) * 100}%`;
  const widthPct = (from: number, to: number) => `${(Math.max(0, to - from) / span) * 100}%`;
  const forward = model.strand === 1;
  const track = variants !== undefined;
  const top = track ? TRACK_HEIGHT : 0;
  const mid = top + MID;
  const height = top + HEIGHT;
  const pipBase = mid - CDS_HEIGHT / 2 - 2;
  const pipY = (pip: number) => pipBase - Math.min(1, Math.max(0, pip)) * PIP_HEIGHT;
  const variantColour = (c: VariantClass) =>
    c === "other" ? theme.palette.text.disabled : VARIANT_COLOURS[theme.palette.mode][c];

  const shown = useMemo(
    () => (variants ?? []).filter((v) => v.pos >= start && v.pos <= end).sort(byDrawOrder),
    [variants, start, end]
  );
  const beyond = useMemo(
    () => ({
      left: (variants ?? []).filter((v) => v.pos < start).length,
      right: (variants ?? []).filter((v) => v.pos > end).length,
    }),
    [variants, start, end]
  );
  const shownMarks = useMemo(
    () => (marks ?? []).filter((m) => m.pos >= start && m.pos <= end).sort(byDrawOrder),
    [marks, start, end]
  );
  // the part of each intron inside the view, where it is wide enough to carry a strand arrow
  const arrows = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i + 1 < layout.exons.length; i++) {
      const from = Math.max(layout.exons[i].end, start);
      const to = Math.min(layout.exons[i + 1].start, end);
      if ((to - from) / span >= MIN_ARROW_FRACTION) {
        out.push((from + to) / 2);
      }
    }
    return out;
  }, [layout, start, end, span]);

  const drag = useRef<{ x: number; view: ModelView; width: number } | null>(null);
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!onViewChange) {
      return;
    }
    drag.current = {
      x: e.clientX,
      view: { start, end },
      width: e.currentTarget.getBoundingClientRect().width,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || !onViewChange || d.width === 0) {
      return;
    }
    const shift = Math.round(((d.x - e.clientX) / d.width) * (d.view.end - d.view.start));
    onViewChange({ start: d.view.start + shift, end: d.view.end + shift });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const withExonTooltip = (exon: ModelExon, node: React.ReactElement) =>
    exonTooltips ? (
      <Tooltip key={exon.start} title={exonTitle(exon, layout.exons.length)} placement="top">
        {node}
      </Tooltip>
    ) : (
      node
    );

  return (
    <Box data-testid="gene-model">
      <Typography variant="caption" color="text.secondary">
        canonical transcript · {layout.exons.length} exon
        {layout.exons.length === 1 ? "" : "s"} · {formatSpan(layout.end - layout.start + 1)} ·{" "}
        {forward ? "forward" : "reverse"} strand
      </Typography>
      {/* inset so the first and last exon keep their minimum width inside the drawing */}
      <Box sx={{ px: "4px" }}>
        <svg
          width="100%"
          height={height}
          style={{
            display: "block",
            overflow: "visible",
            cursor: onViewChange ? "grab" : undefined,
            touchAction: onViewChange ? "none" : undefined,
          }}
          role="img"
          aria-label={`gene model of ${model.geneName}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}>
          {/* a nested svg clips to its box: with a view narrower than the transcript, what lies
              outside must not be drawn past the edges */}
          <svg x={0} y={0} width="100%" height={height} overflow={view ? "hidden" : "visible"}>
            {track &&
              [0.5, 1].map((pip) => (
                <line
                  key={pip}
                  x1="0%"
                  x2="100%"
                  y1={pipY(pip)}
                  y2={pipY(pip)}
                  stroke={theme.palette.divider}
                  strokeWidth={1}
                />
              ))}
            <line
              x1={pct(layout.start)}
              x2={pct(layout.end)}
              y1={mid}
              y2={mid}
              stroke={colour}
              strokeWidth={1.5}
            />
            {arrows.map((pos) => (
              <svg key={pos} x={pct(pos)} y={mid} overflow="visible">
                <path
                  d={
                    forward
                      ? `M ${-ARROW / 2} ${-ARROW} L ${ARROW / 2} 0 L ${-ARROW / 2} ${ARROW}`
                      : `M ${ARROW / 2} ${-ARROW} L ${-ARROW / 2} 0 L ${ARROW / 2} ${ARROW}`
                  }
                  fill="none"
                  stroke={colour}
                  strokeWidth={1.5}
                />
              </svg>
            ))}
            {layout.exons
              .filter((exon) => exon.end >= start && exon.start <= end)
              .map((exon) =>
                withExonTooltip(
                  exon,
                  <g key={exon.start}>
                    <rect
                      x={pct(exon.start)}
                      y={mid - UTR_HEIGHT / 2}
                      width={widthPct(exon.start, exon.end)}
                      height={UTR_HEIGHT}
                      fill={colour}
                      // a short exon in a long gene is a fraction of a pixel wide; the stroke keeps
                      // it visible and hoverable
                      stroke={colour}
                      strokeWidth={1}
                    />
                    {exon.cds && (
                      <rect
                        x={pct(exon.cds.start)}
                        y={mid - CDS_HEIGHT / 2}
                        width={widthPct(exon.cds.start, exon.cds.end)}
                        height={CDS_HEIGHT}
                        fill={colour}
                        stroke={colour}
                        strokeWidth={1}
                      />
                    )}
                    {/* hover target taller and wider than the mark */}
                    {exonTooltips && (
                      <rect
                        x={pct(exon.start)}
                        y={mid - CDS_HEIGHT / 2}
                        width={widthPct(exon.start, exon.end)}
                        height={CDS_HEIGHT}
                        fill="transparent"
                        stroke="transparent"
                        strokeWidth={6}
                      />
                    )}
                  </g>
                )
              )}
            {shownMarks.map((m) => (
              <Tooltip
                key={m.key}
                title={m.tooltip}
                placement="bottom"
                slotProps={{ tooltip: { sx: { maxWidth: "none" } } }}>
                <svg x={pct(m.pos)} y={mid} overflow="visible" data-mark-class={m.variantClass}>
                  {/* surface-coloured edge keeps the line apart from the exon it crosses */}
                  <line
                    x1={0}
                    x2={0}
                    y1={-MARK_REACH}
                    y2={MARK_REACH}
                    stroke={theme.palette.background.paper}
                    strokeWidth={4}
                  />
                  <line
                    x1={0}
                    x2={0}
                    y1={-MARK_REACH}
                    y2={MARK_REACH}
                    stroke={variantColour(m.variantClass)}
                    strokeWidth={2}
                  />
                  {/* hover target wider than the line */}
                  <rect
                    x={-5}
                    y={-MARK_REACH}
                    width={10}
                    height={2 * MARK_REACH}
                    fill="transparent"
                  />
                </svg>
              </Tooltip>
            ))}
            {shown.map((v) => {
              const r = MARKER_RADIUS[v.variantClass];
              const y = pipY(v.pip);
              const fill = variantColour(v.variantClass);
              return (
                <Tooltip key={v.title} title={v.title} placement="top">
                  <svg x={pct(v.pos)} y={0} overflow="visible" data-variant-class={v.variantClass}>
                    <line x1={0} x2={0} y1={pipBase} y2={y} stroke={fill} strokeWidth={1.5} />
                    {v.variantClass === "lof" ? (
                      <rect
                        x={-r}
                        y={y - r}
                        width={2 * r}
                        height={2 * r}
                        transform={`rotate(45 0 ${y})`}
                        fill={fill}
                        stroke={theme.palette.background.paper}
                        strokeWidth={1.5}
                      />
                    ) : (
                      <circle
                        cx={0}
                        cy={y}
                        r={r}
                        fill={fill}
                        stroke={theme.palette.background.paper}
                        strokeWidth={1.5}
                      />
                    )}
                    {/* hover target larger than the mark */}
                    <circle cx={0} cy={y} r={9} fill="transparent" />
                  </svg>
                </Tooltip>
              );
            })}
          </svg>
          {/* over the lollipops, with a halo, so a variant at the edge does not hide the scale */}
          {track &&
            [0.5, 1].map((pip) => (
              <text
                key={pip}
                x="0%"
                y={pipY(pip) - 3}
                fontSize={10}
                fill={theme.palette.text.secondary}
                stroke={theme.palette.background.paper}
                strokeWidth={3}
                paintOrder="stroke">
                PIP {pip}
              </text>
            ))}
          {beyond.left > 0 && (
            <text
              x="0%"
              y={pipY(0.2)}
              fontSize={11}
              fill={theme.palette.text.primary}
              stroke={theme.palette.background.paper}
              strokeWidth={3}
              paintOrder="stroke"
              data-testid="variants-beyond-left">
              ◀ {beyond.left}
            </text>
          )}
          {beyond.right > 0 && (
            <text
              x="100%"
              y={pipY(0.2)}
              fontSize={11}
              textAnchor="end"
              fill={theme.palette.text.primary}
              stroke={theme.palette.background.paper}
              strokeWidth={3}
              paintOrder="stroke"
              data-testid="variants-beyond-right">
              {beyond.right} ▶
            </text>
          )}
          <text x="0%" y={height - 2} fontSize={11} fill={theme.palette.text.secondary}>
            chr{chrName(model.chr)}:{start.toLocaleString()}
          </text>
          <text
            x="100%"
            y={height - 2}
            fontSize={11}
            textAnchor="end"
            fill={theme.palette.text.secondary}>
            {end.toLocaleString()}
          </text>
        </svg>
      </Box>
      {(track || marks) && (
        <Box sx={{ display: "flex", gap: 2, mt: 0.5 }}>
          {(
            [
              ["lof", "LoF"],
              ["coding", "other coding"],
              ["other", "non-coding"],
            ] as const
          ).map(([variantClass, label]) => (
            <Typography
              key={variantClass}
              variant="caption"
              color="text.secondary"
              sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Box
                component="span"
                sx={{
                  width: 9,
                  height: 9,
                  bgcolor: variantColour(variantClass),
                  borderRadius: variantClass === "lof" ? 0 : "50%",
                  transform: variantClass === "lof" ? "rotate(45deg) scale(0.85)" : "none",
                }}
              />
              {label}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default GeneModelPlot;
