import { Ref, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Box, Paper, Typography, useTheme } from "@mui/material";
import { Scatter } from "react-chartjs-2";
import {
  Chart,
  ChartOptions,
  LinearScale,
  Plugin,
  PointElement,
  ScriptableContext,
  Tooltip,
} from "chart.js";
import { GeneBurdenRow } from "@/types/types.normalized";
import { downloadUrl } from "../table/utils/export";
import { datasetDisplayName, formatTraitName, pValRepr } from "../table/utils/tableutil";
import {
  BurdenBand,
  BurdenPoint,
  buildBurdenPoints,
  isQuantitativeTrait,
  placeLabels,
} from "./geneBurden";

Chart.register(LinearScale, PointElement, Tooltip);

/**
 * PheWAS-style burden plot: -log10(p) against traits, grouped on the x axis by dataset and, inside
 * a dataset, into binary then quantitative traits. A triangle points up for a positive beta and
 * down for a negative one, with its area proportional to |beta|.
 */

// categorical series colours, light / dark, taken in this order and never cycled
const SERIES_COLOURS = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

const LABEL_FONT = "11px sans-serif";
const LABEL_HEIGHT = 13;
const LABEL_MAX_CHARS = 32;
// only the strongest traits are offered a label; more than this and the plot reads as text
const LABEL_CANDIDATES = 12;
// pixels per CSS pixel of the downloaded image
const PNG_SCALE = 3;

export interface GeneBurdenPlotHandle {
  downloadPng: (filename: string) => void;
}

const count = (v: number | null): string => (v == null ? "NA" : v.toLocaleString());

// the same fields as a row of the burden table
export const burdenTooltipRows = (r: GeneBurdenRow): [string, string][] => [
  ["type", isQuantitativeTrait(r) ? "quantitative" : "binary"],
  ["dataset", datasetDisplayName(r.dataset)],
  ["burden mask", r.annotation],
  ["p-value", pValRepr(r.mlog10pBurden)],
  ["beta", r.beta == null ? "NA" : r.beta.toPrecision(3)],
  ["n cases", count(r.nCases)],
  ["n controls", isQuantitativeTrait(r) ? "NA" : count(r.nControls)],
];

const truncate = (text: string): string =>
  text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS - 1)}…` : text;

// the surface, band separators, and labels on the strongest traits
interface Decorations {
  bands: BurdenBand[];
  points: BurdenPoint[];
  colours: { line: string; text: string; surface: string };
}

// reads through a ref: react-chartjs-2 hands plugins to the chart once, at creation
const bandDecorations = (current: { current: Decorations }): Plugin<"scatter"> => ({
  id: "burdenBandDecorations",
  // a canvas is transparent until painted, which a downloaded PNG would keep
  beforeDraw: (chart) => {
    chart.ctx.save();
    chart.ctx.fillStyle = current.current.colours.surface;
    chart.ctx.fillRect(0, 0, chart.width, chart.height);
    chart.ctx.restore();
  },
  beforeDatasetsDraw: (chart) => {
    const { bands, colours } = current.current;
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    ctx.strokeStyle = colours.line;
    ctx.lineWidth = 1;
    for (const band of bands.slice(0, -1)) {
      const x = scales.x.getPixelForValue(band.end);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
    }
    ctx.restore();
  },
  afterDatasetsDraw: (chart) => {
    const { points, colours } = current.current;
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    ctx.fillStyle = colours.text;
    ctx.textBaseline = "middle";
    ctx.font = LABEL_FONT;
    ctx.textAlign = "left";
    const pixels = points.map((p) => ({
      point: p,
      x: scales.x.getPixelForValue(p.x),
      y: scales.y.getPixelForValue(p.y),
      radius: p.radius,
    }));
    // one candidate per trait: its strongest mask
    const topOfTrait = new Map<number, (typeof pixels)[number]>();
    for (const p of pixels) {
      const top = topOfTrait.get(p.point.x);
      if (!top || p.point.y > top.point.y) {
        topOfTrait.set(p.point.x, p);
      }
    }
    const candidates = [...topOfTrait.values()]
      .sort((a, b) => b.point.y - a.point.y)
      .slice(0, LABEL_CANDIDATES)
      .map((p) => {
        const text = truncate(formatTraitName(p.point.row.trait));
        return { ...p, text, w: ctx.measureText(text).width };
      });
    const obstacles = pixels.map((p) => ({
      x: p.x - p.radius,
      y: p.y - p.radius,
      w: 2 * p.radius,
      h: 2 * p.radius,
    }));
    const area = {
      x: chartArea.left,
      y: chartArea.top - LABEL_HEIGHT,
      w: chartArea.width,
      h: chartArea.height + LABEL_HEIGHT,
    };
    for (const { candidate, rect } of placeLabels(candidates, obstacles, area, LABEL_HEIGHT)) {
      ctx.fillText(candidate.text, rect.x, rect.y + LABEL_HEIGHT / 2);
    }
    ctx.restore();
  },
});

interface HoveredPoint {
  row: GeneBurdenRow;
  x: number;
  y: number;
  // the tooltip opens towards the middle of the plot so it never leaves it
  flip: boolean;
}

const BurdenTooltip = ({ hovered }: { hovered: HoveredPoint }) => (
  <Paper
    elevation={4}
    sx={{
      position: "absolute",
      left: hovered.x,
      top: hovered.y,
      transform: `translate(${hovered.flip ? "calc(-100% - 14px)" : "14px"}, 10px)`,
      pointerEvents: "none",
      zIndex: 1,
      p: 1,
      fontSize: "0.75rem",
      maxWidth: 420,
    }}>
    <Box sx={{ fontWeight: 700, mb: 1.5 }}>{formatTraitName(hovered.row.trait)}</Box>
    <Box component="table" sx={{ borderSpacing: 0, "& td": { p: 0, verticalAlign: "top" } }}>
      <tbody>
        {burdenTooltipRows(hovered.row).map(([name, value]) => (
          <tr key={name}>
            <Box component="td" sx={{ pr: "12px !important", color: "text.secondary", whiteSpace: "nowrap" }}>
              {name}
            </Box>
            <Box component="td" sx={{ wordBreak: "break-word" }}>
              {value}
            </Box>
          </tr>
        ))}
      </tbody>
    </Box>
  </Paper>
);

const GeneBurdenPlot = ({
  rows,
  datasets,
  ref,
}: {
  rows: GeneBurdenRow[];
  datasets: string[];
  ref?: Ref<GeneBurdenPlotHandle>;
}) => {
  const chart = useRef<Chart<"scatter">>(null);
  useImperativeHandle(ref, () => ({
    downloadPng: (filename) => {
      const c = chart.current;
      if (!c) {
        return;
      }
      // redrawn at a higher pixel density for the export, then put back
      const screenRatio = c.options.devicePixelRatio;
      c.options.devicePixelRatio = PNG_SCALE;
      c.resize();
      downloadUrl(c.toBase64Image("image/png", 1), `${filename}.png`);
      c.options.devicePixelRatio = screenRatio;
      c.resize();
    },
  }));

  const theme = useTheme();
  const palette = SERIES_COLOURS[theme.palette.mode];
  const [hovered, setHovered] = useState<HoveredPoint | null>(null);

  const { points, bands } = useMemo(() => buildBurdenPoints(rows, datasets), [rows, datasets]);

  const data = useMemo(
    () => ({
      datasets: [...new Set(bands.map((b) => b.dataset))].map((dataset) => ({
        label: datasetDisplayName(dataset),
        data: points.filter((p) => p.row.dataset === dataset),
        // indexed by the gene's full dataset list, so a filter never repaints the survivors
        backgroundColor: palette[datasets.indexOf(dataset) % palette.length],
      })),
    }),
    [points, bands, datasets, palette]
  );

  const options: ChartOptions<"scatter"> = useMemo(() => {
    const raw = (ctx: ScriptableContext<"scatter">) => ctx.raw as BurdenPoint | undefined;
    return {
      maintainAspectRatio: false,
      animation: false as const,
      // a large triangle just above the significance cut would otherwise be cut off by the x axis
      clip: false as const,
      layout: { padding: { top: LABEL_HEIGHT } },
      elements: {
        point: {
          pointStyle: (ctx) => (raw(ctx)?.direction == null ? "circle" : "triangle"),
          rotation: (ctx) => (raw(ctx)?.direction === "down" ? 180 : 0),
          radius: (ctx) => raw(ctx)?.radius ?? 0,
          hoverRadius: (ctx) => (raw(ctx)?.radius ?? 0) + 2,
          hitRadius: 4,
          // surface-coloured ring keeps overlapping triangles apart
          borderColor: theme.palette.background.paper,
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          type: "linear" as const,
          min: 0,
          max: bands.at(-1)?.end ?? 1,
          afterBuildTicks: (axis) => {
            axis.ticks = bands.map((b) => ({ value: (b.start + b.end) / 2 }));
          },
          ticks: {
            color: theme.palette.text.primary,
            autoSkip: false,
            maxRotation: 30,
            callback: (value) => {
              const band = bands.find((b) => (b.start + b.end) / 2 === value);
              return band ? `${datasetDisplayName(band.dataset)} ${band.scale}` : "";
            },
          },
          grid: { display: false },
        },
        y: {
          min: 0,
          title: { display: true, text: "-log10(p)", color: theme.palette.text.secondary },
          ticks: { color: theme.palette.text.secondary },
          grid: { display: false },
          border: { color: theme.palette.divider },
        },
      },
      interaction: { mode: "nearest" as const, intersect: true },
      plugins: {
        legend: { display: false },
        tooltip: {
          // drawn as HTML instead, for a bold trait name over an aligned table
          enabled: false,
          external: ({ chart, tooltip }) => {
            const point = tooltip.opacity === 0 ? undefined : tooltip.dataPoints?.[0];
            setHovered((prev) => {
              if (!point) {
                return null;
              }
              const row = (point.raw as BurdenPoint).row;
              return prev?.row === row
                ? prev
                : {
                    row,
                    x: tooltip.caretX,
                    y: tooltip.caretY,
                    flip: tooltip.caretX > chart.width / 2,
                  };
            });
          },
        },
      },
    };
  }, [bands, theme]);

  const decorations = useRef<Decorations>(null!);
  decorations.current = {
    bands,
    points,
    colours: {
      line: theme.palette.divider,
      text: theme.palette.text.primary,
      surface: theme.palette.background.paper,
    },
  };
  const plugins = useMemo(() => [bandDecorations(decorations)], []);

  return (
    <Box>
      <Box data-testid="gene-burden-plot" sx={{ height: 440, position: "relative" }}>
        <Scatter ref={chart} data={data} options={options} plugins={plugins} />
        {hovered && <BurdenTooltip hovered={hovered} />}
      </Box>
      <Typography variant="caption" color="text.secondary">
        ▲ positive beta, ▼ negative beta; triangle area is proportional to |beta|, scaled separately
        for binary and quantitative traits
      </Typography>
    </Box>
  );
};

export default GeneBurdenPlot;
