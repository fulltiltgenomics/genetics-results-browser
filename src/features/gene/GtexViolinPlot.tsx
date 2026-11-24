import { useEffect, useMemo, useRef, useState } from "react";
import { Box, ToggleButton, ToggleButtonGroup, Typography, useTheme } from "@mui/material";
import type { GtexExpression } from "../../../bff/geneAnnotationTypes";
import { gtexTissueColor, gtexTissueLabel } from "./gtexTissues";
import { axisTicks, toScale, ViolinScale, violinStats } from "./gtexViolin";

/**
 * A gene's expression across GTEx tissues as the GTEx portal draws it: per tissue a violin of every
 * sample in the portal's tissue colour, with the median and quartiles as a box inside it and the
 * samples beyond 1.5 IQR as points.
 */

type SortBy = "name" | "median";

// CSS pixels. a tissue's column is as wide as the space allows within these bounds
const MIN_STEP = 20;
const MAX_STEP = 36;
const PLOT_HEIGHT = 260;
const MARGIN = { top: 12, left: 58 };
const LABEL_SIZE = 12;
// the names run down to the right, as on the GTEx portal, shallow enough to read without tilting
const LABEL_ANGLE = 40;
const COS = Math.cos((LABEL_ANGLE * Math.PI) / 180);
const SIN = Math.sin((LABEL_ANGLE * Math.PI) / 180);
// an estimate, for the room the slanted names need below and to the right of the plot
const labelLength = (label: string): number => label.length * LABEL_SIZE * 0.55;
// of a tissue that is not the one under the pointer
const FAINT = 0.45;

const tpm = (v: number): string => (v >= 100 ? v.toFixed(0) : v.toPrecision(3));

const GtexViolinPlot = ({ expression }: { expression: GtexExpression }) => {
  const theme = useTheme();
  const [scale, setScale] = useState<ViolinScale>("log");
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [hovered, setHovered] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) {
      return;
    }
    const measure = () => setAvailable(el.clientWidth);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  const tissues = useMemo(() => {
    const all = expression.tissues.flatMap((t) => {
      const id = t.tissue.toLowerCase();
      const stats = violinStats(t.tissue, t.values, scale);
      return stats ? [{ ...stats, label: gtexTissueLabel(id), colour: gtexTissueColor(id) }] : [];
    });
    return all.sort((a, b) =>
      sortBy === "median" ? b.median - a.median : a.label.localeCompare(b.label)
    );
  }, [expression, scale, sortBy]);

  const maxTpm = useMemo(
    () => Math.max(0, ...tissues.map((t) => Math.max(t.whiskerHigh, ...t.outliers))),
    [tissues]
  );
  const ticks = axisTicks(maxTpm, scale);
  // a little above the highest sample, and never a flat axis
  const top = Math.max(toScale(maxTpm, scale), toScale(ticks[ticks.length - 1], scale)) * 1.04 || 1;
  const y = (value: number): number => MARGIN.top + PLOT_HEIGHT * (1 - toScale(value, scale) / top);
  const yScaled = (scaled: number): number => MARGIN.top + PLOT_HEIGHT * (1 - scaled / top);

  // how far the names of the last tissues reach past the plot's right edge, at a column width
  const overhang = (step: number): number =>
    Math.max(
      12,
      ...tissues.map((t, i) => labelLength(t.label) * COS - step * (tissues.length - i - 0.5) + 8)
    );
  const fit = (right: number): number =>
    Math.min(
      MAX_STEP,
      Math.max(MIN_STEP, (available - MARGIN.left - right) / Math.max(1, tissues.length))
    );
  // the overhang depends on the column width and the column width on the overhang; the second
  // pass is within a pixel or two of settled, and a wider column only shortens the overhang
  const step = fit(overhang(fit(overhang(MIN_STEP))));
  const halfViolin = step * 0.4;
  const halfBox = Math.max(2, step * 0.1);
  const marginRight = overhang(step);
  const marginBottom = Math.max(40, ...tissues.map((t) => labelLength(t.label) * SIN + 24));
  const width = MARGIN.left + tissues.length * step + marginRight;
  const height = MARGIN.top + PLOT_HEIGHT + marginBottom;
  const axis = theme.palette.text.secondary;

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1, flexWrap: "wrap" }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={scale}
          onChange={(_e, value) => value && setScale(value)}
          aria-label="expression scale">
          <ToggleButton value="log">log scale</ToggleButton>
          <ToggleButton value="linear">linear scale</ToggleButton>
        </ToggleButtonGroup>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={sortBy}
          onChange={(_e, value) => value && setSortBy(value)}
          aria-label="tissue order">
          <ToggleButton value="name">by tissue name</ToggleButton>
          <ToggleButton value="median">by median</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Box ref={box} sx={{ overflowX: "auto" }}>
        <svg
          data-testid="gtex-violin-plot"
          role="img"
          aria-label="expression by GTEx tissue"
          width={width}
          height={height}
          style={{ display: "block" }}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={width - marginRight}
                y1={y(tick)}
                y2={y(tick)}
                stroke={theme.palette.divider}
              />
              <text
                x={MARGIN.left - 6}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
                fontSize={11}
                fill={axis}>
                {tick}
              </text>
            </g>
          ))}
          <text
            transform={`translate(14 ${MARGIN.top + PLOT_HEIGHT / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={12}
            fill={axis}>
            {expression.unit}
            {scale === "log" ? " (log scale)" : ""}
          </text>
          {tissues.map((t, i) => {
            const x = MARGIN.left + step * (i + 0.5);
            const lowest = Math.min(t.whiskerLow, ...t.outliers);
            const highest = Math.max(t.whiskerHigh, ...t.outliers);
            const right = t.density.map((d) => `${x + d.width * halfViolin},${yScaled(d.at)}`);
            const left = t.density
              .map((d) => `${x - d.width * halfViolin},${yScaled(d.at)}`)
              .reverse();
            return (
              <g
                key={t.tissue}
                data-tissue={t.tissue}
                opacity={hovered && hovered !== t.tissue ? FAINT : 1}
                onMouseEnter={() => setHovered(t.tissue)}
                onMouseLeave={() => setHovered(null)}>
                <title>
                  {`${t.label} · ${t.n.toLocaleString()} samples · median ${tpm(t.median)} ${expression.unit}, quartiles ${tpm(t.q1)}–${tpm(t.q3)}`}
                </title>
                {/* the span of the tissue's samples answers the pointer, at the violin's full
                    width: the shape alone is too thin to catch, and the empty plot around it
                    stays quiet so the whole plot can be read with the pointer over it */}
                <rect
                  x={x - halfViolin}
                  y={y(highest)}
                  width={halfViolin * 2}
                  height={Math.max(1, y(lowest) - y(highest))}
                  fill="transparent"
                />
                <polygon
                  points={[...right, ...left].join(" ")}
                  fill={t.colour}
                  stroke={axis}
                  strokeWidth={0.5}
                  strokeLinejoin="round"
                />
                <line x1={x} x2={x} y1={y(t.whiskerLow)} y2={y(t.whiskerHigh)} stroke={axis} />
                <rect
                  x={x - halfBox}
                  y={y(t.q3)}
                  width={halfBox * 2}
                  height={Math.max(1, y(t.q1) - y(t.q3))}
                  fill="#222"
                  stroke={axis}
                  strokeWidth={0.5}
                />
                <line
                  x1={x - halfBox - 1}
                  x2={x + halfBox + 1}
                  y1={y(t.median)}
                  y2={y(t.median)}
                  stroke="#fff"
                  strokeWidth={1.5}
                />
                {t.outliers.map((v, o) => (
                  <circle
                    key={o}
                    cx={x}
                    cy={y(v)}
                    r={1.5}
                    fill="none"
                    stroke={axis}
                    strokeOpacity={0.6}
                  />
                ))}
                <text
                  transform={`translate(${x - 3} ${MARGIN.top + PLOT_HEIGHT + 12}) rotate(${LABEL_ANGLE})`}
                  textAnchor="start"
                  fontSize={LABEL_SIZE}
                  fontWeight={hovered === t.tissue ? 600 : 400}
                  fill={theme.palette.text.primary}>
                  {t.label}
                </text>
              </g>
            );
          })}
          <line
            x1={MARGIN.left}
            x2={MARGIN.left}
            y1={MARGIN.top}
            y2={MARGIN.top + PLOT_HEIGHT}
            stroke={axis}
          />
        </svg>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        every sample of the tissue, from the GTEx portal. The box is the median and the quartiles,
        the line reaches the furthest samples within 1.5 interquartile ranges of the box, and the
        points are the samples beyond.
      </Typography>
    </Box>
  );
};

export default GtexViolinPlot;
