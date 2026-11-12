import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Tooltip, Typography, useTheme } from "@mui/material";
import { scaleLinear } from "d3-scale";
import { SELECTION_COLOUR } from "../structure/viewSpec";
import { PSEUDO_CS_TOOLTIP } from "../table/utils/tableutil";
import {
  PLDDT_BANDS,
  markersOf,
  plddtRuns,
  type FeatureTrackRow,
  type PlacedVariant,
  type ProteinModel,
  type ResidueRow,
  type VariantSource,
} from "./proteinTrack";

/**
 * The protein drawn along its amino-acid axis: model windows, the pLDDT strip, the two
 * variant rows and one row per feature type. Dragging selects a range and a click selects
 * one residue or one variant; what a selection means is the parent's business.
 */

const GUTTER = 150;
const RIGHT_PAD = 12;
const AXIS_H = 22;
const ROW_H = 14;
const VARIANT_ROW_H = 20;
const DEFAULT_WIDTH = 900;
// a press that moves less than this is a click on one residue, not a brush
const CLICK_SLOP_PX = 3;

export const VARIANT_COLOURS: Record<VariantSource, string> = { cs: "#d62728", exome: "#1f77b4" };
export const VARIANT_ROW_LABELS: Record<VariantSource, string> = {
  cs: "credible-set missense",
  exome: "exome missense",
};
const SOURCE_COLOURS: Record<string, string> = { uniprot: "#6b7a8f", ted: "#8c6bb1" };
const SOURCE_LABELS: Record<string, string> = { uniprot: "UniProt", ted: "TED" };

export interface TrackSelection {
  start: number;
  end: number;
  /** the variants of the selected marker, when the selection is one */
  variants?: string[];
}

/** the app's mark for a pseudo credible set, with the explanation it always carries */
export const PseudoMark = () => (
  <Tooltip title={PSEUDO_CS_TOOLTIP} arrow>
    <Box component="span" sx={{ color: "text.secondary", cursor: "help", ml: "2px" }}>
      *
    </Box>
  </Tooltip>
);

const Swatch = ({ colour, round, children }: { colour: string; round?: boolean; children: React.ReactNode }) => (
  <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
    <Box sx={{ width: 10, height: 10, bgcolor: colour, borderRadius: round ? "50%" : "2px", flex: "none" }} />
    <Typography variant="caption">{children}</Typography>
  </Box>
);

interface Props {
  /** the stretch of the protein on show, inclusive */
  domain: [number, number];
  owners: ResidueRow[];
  windows: ProteinModel[];
  shownModelFileId: string | undefined;
  featureRows: FeatureTrackRow[];
  variants: PlacedVariant[];
  selection: TrackSelection | null;
  /** the residue the structure's pointer is over */
  marker: number | null;
  onSelectRange: (start: number, end: number) => void;
  /** every variant of one marker: those placed at the same residue */
  onSelectVariants: (variants: PlacedVariant[]) => void;
  onShowWindow: (modelFileId: string) => void;
}

const useWidth = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
};

const ProteinTrack = ({
  domain,
  owners,
  windows,
  shownModelFileId,
  featureRows,
  variants,
  selection,
  marker,
  onSelectRange,
  onSelectVariants,
  onShowWindow,
}: Props) => {
  const theme = useTheme();
  const { ref, width } = useWidth();
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ fromX: number; toX: number } | null>(null);
  // per row, the residue of the marker that holds the row's one tab stop, and the marker
  // the keyboard is on
  const [roving, setRoving] = useState<Partial<Record<VariantSource, number>>>({});
  const [focused, setFocused] = useState<string | null>(null);

  const plotWidth = Math.max(100, width - GUTTER - RIGHT_PAD);
  // a residue is a unit-wide cell, so the scale runs over cell edges: start-0.5 … end+0.5
  const x = useMemo(
    () => scaleLinear().domain([domain[0] - 0.5, domain[1] + 0.5]).range([GUTTER, GUTTER + plotWidth]),
    [domain, plotWidth],
  );
  const cell = (start: number, end: number) => {
    const left = Math.max(GUTTER, x(start - 0.5));
    const right = Math.min(GUTTER + plotWidth, x(end + 0.5));
    return { x: left, width: Math.max(1, right - left) };
  };
  const inView = (start: number, end: number) => end >= domain[0] && start <= domain[1];

  // more residues than pixels: a strip cell stands for several
  const binned = domain[1] - domain[0] + 1 > plotWidth;
  const runs = useMemo(
    () => plddtRuns(owners, domain[0], domain[1], plotWidth),
    [owners, domain, plotWidth],
  );

  const sources: VariantSource[] = ["cs", "exome"];
  const windowsY = AXIS_H;
  const plddtY = windowsY + (windows.length > 1 ? ROW_H + 4 : 0);
  const variantsY = plddtY + ROW_H + 4;
  const featuresY = variantsY + sources.length * VARIANT_ROW_H + 4;
  const height = featuresY + featureRows.length * ROW_H + 6;

  const positionAt = (clientX: number): number => {
    const left = svg.current?.getBoundingClientRect().left ?? 0;
    const p = Math.round(x.invert(clientX - left));
    return Math.min(domain[1], Math.max(domain[0], p));
  };
  const finish = () => {
    if (!drag) return;
    setDrag(null);
    const a = positionAt(drag.fromX);
    const b = Math.abs(drag.toX - drag.fromX) < CLICK_SLOP_PX ? a : positionAt(drag.toX);
    onSelectRange(Math.min(a, b), Math.max(a, b));
  };

  const band = drag
    ? { start: Math.min(positionAt(drag.fromX), positionAt(drag.toX)), end: Math.max(positionAt(drag.fromX), positionAt(drag.toX)) }
    : selection;
  const text = { fontSize: 10, fill: theme.palette.text.secondary } as const;
  const label = (y: number, h: number, content: string) => (
    <text x={GUTTER - 8} y={y + h / 2} textAnchor="end" dominantBaseline="central" {...text}>
      {content}
    </text>
  );

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg
        ref={svg}
        data-testid="protein-track"
        width={width}
        height={height}
        style={{ display: "block", userSelect: "none" }}
        onMouseMove={(e) => drag && setDrag({ ...drag, toX: e.clientX })}
        onMouseUp={finish}
        onMouseLeave={finish}>
        {x.ticks(Math.max(2, Math.floor(plotWidth / 90))).filter((t) => Number.isInteger(t) && t >= domain[0]).map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={AXIS_H - 6} y2={AXIS_H - 2} stroke={theme.palette.text.secondary} />
            <text x={x(t)} y={AXIS_H - 9} textAnchor="middle" {...text}>
              {t.toLocaleString()}
            </text>
          </g>
        ))}
        {label(0, AXIS_H - 6, "residue")}

        {/* under everything that takes its own clicks, so a press on bare track starts a brush */}
        <rect
          data-testid="protein-track-brush"
          x={GUTTER}
          y={AXIS_H}
          width={plotWidth}
          height={height - AXIS_H}
          fill="transparent"
          style={{ cursor: "crosshair" }}
          onMouseDown={(e) => {
            e.preventDefault();
            setDrag({ fromX: e.clientX, toX: e.clientX });
          }}
        />

        {windows.length > 1 && (
          <g data-testid="protein-track-windows">
            {label(windowsY, ROW_H, "structure windows")}
            {windows.filter((w) => inView(w.ownedStart, w.ownedEnd)).map((w) => {
              const shown = w.modelFileId === shownModelFileId;
              return (
                <rect
                  key={w.modelFileId}
                  {...cell(w.ownedStart, w.ownedEnd)}
                  y={windowsY + 1}
                  height={ROW_H - 2}
                  fill={shown ? theme.palette.primary.main : theme.palette.action.selected}
                  stroke={theme.palette.background.paper}
                  style={{ cursor: "pointer" }}
                  onClick={() => onShowWindow(w.modelFileId)}>
                  <title>
                    {`window ${w.windowIndex} of ${w.nWindows}: the model file covers residues ${w.proteinStart}–${w.proteinEnd} and owns ${w.ownedStart}–${w.ownedEnd}${shown ? " (shown)" : ""}`}
                  </title>
                </rect>
              );
            })}
          </g>
        )}

        <g data-testid="protein-track-plddt" pointerEvents="none">
          {label(plddtY, ROW_H, "pLDDT")}
          {runs.map((run) => (
            <rect
              key={run.start}
              {...cell(run.start, run.end)}
              y={plddtY}
              height={ROW_H}
              fill={PLDDT_BANDS[run.band].colour}
            />
          ))}
        </g>

        {sources.map((source, row) => {
          const y = variantsY + row * VARIANT_ROW_H;
          const cy = y + VARIANT_ROW_H / 2;
          const markers = markersOf(variants, source).filter((m) => inView(m.aaPos, m.aaPos));
          // the row's tab stop: the marker last focused, or its first while none has been
          const stop = markers.some((m) => m.aaPos === roving[source]) ? roving[source] : markers[0]?.aaPos;
          return (
            <g key={source} data-testid={`protein-track-variants-${source}`} role="group" aria-label={`${VARIANT_ROW_LABELS[source]} variants`}>
              {label(y, VARIANT_ROW_H, VARIANT_ROW_LABELS[source])}
              <line
                x1={GUTTER}
                x2={GUTTER + plotWidth}
                y1={cy}
                y2={cy}
                stroke={theme.palette.divider}
                pointerEvents="none"
              />
              {markers.map((m) => {
                const id = `${source}:${m.aaPos}`;
                const ids = m.variants.map((v) => v.variant);
                const selected = !!selection?.variants && ids.every((v) => selection.variants!.includes(v));
                const many = m.variants.length > 1;
                const r = many ? 6.5 : 4.5;
                const names = m.variants.map((v) => `${v.label} ${v.variant}`);
                return (
                  <g
                    key={m.aaPos}
                    data-testid="protein-variant"
                    data-variant={ids.join(",")}
                    data-selected={selected}
                    role="button"
                    tabIndex={m.aaPos === stop ? 0 : -1}
                    aria-label={many ? `${m.variants.length} variants at residue ${m.aaPos}: ${names.join(", ")}` : names[0]}
                    aria-pressed={selected}
                    // the browser's focus outline is the element's box, a square around a
                    // circle: focus and selection are drawn as rings instead, so the marker
                    // keeps the legend's shape
                    style={{ cursor: "pointer", outline: "none" }}
                    onClick={() => onSelectVariants(m.variants)}
                    onFocus={() => {
                      setFocused(id);
                      setRoving((at) => ({ ...at, [source]: m.aaPos }));
                    }}
                    onBlur={() => setFocused(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectVariants(m.variants);
                        return;
                      }
                      const row = Array.from(
                        e.currentTarget.parentElement?.querySelectorAll<SVGGElement>('[data-testid="protein-variant"]') ?? [],
                      );
                      const at = row.indexOf(e.currentTarget);
                      const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: row.length - 1 }[e.key];
                      if (to === undefined) return;
                      e.preventDefault();
                      row[Math.min(row.length - 1, Math.max(0, to))]?.focus();
                    }}>
                    {(selected || focused === id) && (
                      <circle
                        cx={x(m.aaPos)}
                        cy={cy}
                        r={r + 3}
                        fill="none"
                        stroke={selected ? SELECTION_COLOUR : theme.palette.text.primary}
                        strokeWidth={selected ? 2 : 1}
                        strokeDasharray={selected ? undefined : "2 2"}
                      />
                    )}
                    <circle
                      cx={x(m.aaPos)}
                      cy={cy}
                      r={r}
                      fill={VARIANT_COLOURS[source]}
                      stroke={theme.palette.background.paper}
                    />
                    {many && (
                      <text x={x(m.aaPos)} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={700} fill="#fff">
                        {m.variants.length}
                      </text>
                    )}
                    {source === "cs" && m.variants.every((v) => v.pseudoOnly) && (
                      <text x={x(m.aaPos) + r + 1} y={cy - r + 2} fontSize={11} fill={theme.palette.text.secondary}>
                        *
                      </text>
                    )}
                    <title>
                      {[
                        ...m.variants.flatMap((v) => [`${v.label} · ${v.variant}`, ...v.notes.map((n) => `  ${n}`)]),
                        ...(m.variants.some((v) => v.pseudo) ? [`* ${PSEUDO_CS_TOOLTIP}`] : []),
                      ].join("\n")}
                    </title>
                  </g>
                );
              })}
            </g>
          );
        })}

        {featureRows.map((row, i) => {
          const y = featuresY + i * ROW_H;
          // features that land on the same pixel as the one before them are drawn once
          let lastRight = -Infinity;
          return (
            <g key={row.key} data-testid="protein-track-features" pointerEvents="none">
              {label(y, ROW_H, `${SOURCE_LABELS[row.source] ?? row.source} · ${row.featureType}`)}
              {row.features.filter((f) => inView(f.start, f.end)).map((f, j) => {
                const box = cell(f.start, f.end);
                if (box.x + box.width <= lastRight + 0.5) return null;
                lastRight = box.x + box.width;
                return (
                  <rect
                    key={j}
                    {...box}
                    y={y + 2}
                    height={ROW_H - 4}
                    rx={1.5}
                    fill={SOURCE_COLOURS[row.source] ?? theme.palette.text.disabled}
                    fillOpacity={0.85}
                    // the brush rect beneath takes the press; the tooltip still needs the hover
                    pointerEvents="visiblePainted"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setDrag({ fromX: e.clientX, toX: e.clientX });
                    }}>
                    <title>
                      {[
                        `${f.featureType} ${f.start}${f.end === f.start ? "" : `–${f.end}`}`,
                        f.description,
                        f.evidenceTier ? `evidence: ${f.evidenceTier}` : null,
                      ]
                        .filter(Boolean)
                        .join("\n")}
                    </title>
                  </rect>
                );
              })}
            </g>
          );
        })}

        {band && inView(band.start, band.end) && (
          <rect
            data-testid="protein-track-selection"
            data-start={band.start}
            data-end={band.end}
            {...cell(band.start, band.end)}
            y={AXIS_H}
            height={height - AXIS_H}
            fill={SELECTION_COLOUR}
            fillOpacity={0.18}
            stroke={SELECTION_COLOUR}
            pointerEvents="none"
          />
        )}
        {marker !== null && inView(marker, marker) && (
          <line
            data-testid="protein-track-marker"
            data-position={marker}
            x1={x(marker)}
            x2={x(marker)}
            y1={AXIS_H - 4}
            y2={height}
            stroke={theme.palette.text.primary}
            strokeDasharray="3 2"
            pointerEvents="none"
          />
        )}
      </svg>
      <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 1.5, rowGap: 0.25, mt: 0.5 }} data-testid="protein-track-legend">
        <Typography variant="caption" color="text.secondary">
          model confidence (pLDDT{binned ? ", lowest in the bin" : ""})
        </Typography>
        {/* least confident first, the order of the structure viewer's legend */}
        {[...PLDDT_BANDS].reverse().map((b) => (
          <Swatch key={b.name} colour={b.colour}>
            {b.name}
          </Swatch>
        ))}
        {sources.map((source) => (
          <Swatch key={source} colour={VARIANT_COLOURS[source]} round>
            {VARIANT_ROW_LABELS[source]}
          </Swatch>
        ))}
        {variants.some((v) => v.pseudo) && (
          <Typography variant="caption">
            <PseudoMark /> pseudo credible set
          </Typography>
        )}
        <Swatch colour={SELECTION_COLOUR}>selection</Swatch>
      </Box>
    </div>
  );
};

export default ProteinTrack;
