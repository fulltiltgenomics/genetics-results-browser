import { useMemo, useState } from "react";
import { Box, FormControlLabel, Switch, Typography, useTheme } from "@mui/material";
import { Bar } from "react-chartjs-2";
import {
  BarElement,
  CategoryScale,
  Chart,
  ChartOptions,
  LinearScale,
  LogarithmicScale,
  Tooltip,
  TooltipItem,
} from "chart.js";
import { GeneExpressionRow } from "@/types/types.normalized";
import { gtexTissueColor, gtexTissueLabel } from "./gtexTissues";

Chart.register(CategoryScale, LinearScale, LogarithmicScale, BarElement, Tooltip);

/**
 * GTEx expression bar plot for the gene view, mirroring the GTEx portal's median-TPM view: one
 * horizontal bar per tissue in the portal's own tissue colours, sorted most-expressed first.
 *
 * Deliberately not GTEx's violin plot — that needs per-sample expression, and the results API serves
 * only the median TPM matrix (one value per tissue).
 */

const ROW_HEIGHT = 15;

const GeneExpressionPlot = ({ rows }: { rows: GeneExpressionRow[] }) => {
  const theme = useTheme();
  const [logScale, setLogScale] = useState(false);

  const sorted = useMemo(
    () =>
      rows
        .filter((r) => r.level != null)
        .slice()
        .sort((a, b) => b.level! - a.level!),
    [rows]
  );

  // a log axis cannot place zeros, so they drop out of the plot entirely; count them for the caption
  const zeroCount = logScale ? sorted.filter((r) => r.level! <= 0).length : 0;

  const data = useMemo(
    () => ({
      labels: sorted.map((r) => gtexTissueLabel(r.tissueCell)),
      datasets: [
        {
          label: "median TPM",
          data: sorted.map((r) => (logScale && r.level! <= 0 ? null : r.level)),
          backgroundColor: sorted.map((r) => gtexTissueColor(r.tissueCell)),
          borderColor: theme.palette.divider,
          borderWidth: 1,
          categoryPercentage: 0.9,
          barPercentage: 0.95,
        },
      ],
    }),
    [sorted, logScale, theme.palette.divider]
  );

  const options: ChartOptions<"bar"> = useMemo(
    () => ({
      indexAxis: "y" as const,
      maintainAspectRatio: false,
      animation: false as const,
      scales: {
        x: {
          type: logScale ? ("logarithmic" as const) : ("linear" as const),
          position: "top" as const,
          title: { display: true, text: "median TPM", color: theme.palette.text.secondary },
          ticks: { color: theme.palette.text.secondary },
          grid: { color: theme.palette.divider },
        },
        y: {
          // every tissue keeps its label; MRT-like density, so a small font
          ticks: { autoSkip: false, color: theme.palette.text.primary, font: { size: 10 } },
          grid: { display: false },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context: TooltipItem<"bar">) => {
              const level = sorted[context.dataIndex]?.level;
              return level == null ? "NA" : `median TPM ${level.toPrecision(4)}`;
            },
          },
        },
      },
    }),
    [logScale, sorted, theme.palette.divider, theme.palette.text.primary, theme.palette.text.secondary]
  );

  return (
    <Box>
      <FormControlLabel
        control={
          <Switch size="small" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} />
        }
        label={<Typography variant="body2">log scale</Typography>}
      />
      <Box
        data-testid="gtex-expression-plot"
        sx={{ height: Math.max(240, sorted.length * ROW_HEIGHT + 70) }}>
        <Bar data={data} options={options} />
      </Box>
      {zeroCount > 0 && (
        <Typography variant="caption" color="text.secondary">
          {zeroCount} tissue{zeroCount > 1 ? "s" : ""} with 0 TPM omitted on the log scale
        </Typography>
      )}
    </Box>
  );
};

export default GeneExpressionPlot;
