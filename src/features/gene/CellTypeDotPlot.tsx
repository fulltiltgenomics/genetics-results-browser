import { useMemo } from "react";
import { Box, Typography, useTheme } from "@mui/material";
import { scaleLinear, scaleSqrt } from "d3-scale";
import { CellTypeExpressionSummaryRow } from "@/types/types.normalized";
import { buildDotGrid } from "./cellTypeDots";

/**
 * Tissue x cell type dot plot: colour is mean log1p CP10K (the primary measure), area is the
 * fraction of cells expressing. SVG rather than chart.js because the axes are categorical on both
 * sides and the legend needs to match the dots exactly.
 */

const CELL = 22;
const MAX_R = 10;
const LEFT = 190;
const TOP = 130;

const CellTypeDotPlot = ({
  rows,
  maxCellTypes,
}: {
  rows: CellTypeExpressionSummaryRow[];
  maxCellTypes: number;
}) => {
  const theme = useTheme();
  const grid = useMemo(() => buildDotGrid(rows, maxCellTypes), [rows, maxCellTypes]);
  const lowColour = theme.palette.mode === "dark" ? "#3b4a6b" : "#d8e4f5";
  const highColour = theme.palette.mode === "dark" ? "#ffb347" : "#b22222";
  const colour = scaleLinear<string>()
    .domain([0, grid.maxMean || 1])
    .range([lowColour, highColour])
    .clamp(true);
  const radius = scaleSqrt()
    .domain([0, grid.maxFrac || 1])
    .range([1.5, MAX_R]);

  const colIndex = new Map(grid.tissues.map((t, i) => [t, i]));
  const rowIndex = new Map(grid.cellTypes.map((c, i) => [c, i]));
  const width = LEFT + grid.tissues.length * CELL + 150;
  const height = TOP + grid.cellTypes.length * CELL + 20;
  const legendX = LEFT + grid.tissues.length * CELL + 20;
  const legendFracs = [0.25, 0.5, 1].map((f) => f * grid.maxFrac);

  return (
    <Box sx={{ overflowX: "auto" }} data-testid="cell-type-dot-plot">
      <svg width={width} height={height} role="img" aria-label="cell type expression dot plot">
        {grid.tissues.map((t, i) => (
          <text
            key={t}
            transform={`translate(${LEFT + i * CELL + CELL / 2}, ${TOP - 8}) rotate(-60)`}
            fontSize={11}
            fill={theme.palette.text.primary}>
            {t}
          </text>
        ))}
        {grid.cellTypes.map((c, i) => (
          <text
            key={c}
            x={LEFT - 8}
            y={TOP + i * CELL + CELL / 2 + 4}
            textAnchor="end"
            fontSize={11}
            fill={theme.palette.text.primary}>
            {c}
          </text>
        ))}
        {grid.dots.map((d) => (
          <circle
            key={`${d.cellTypeId}|${d.tissueId}`}
            cx={LEFT + colIndex.get(d.tissue)! * CELL + CELL / 2}
            cy={TOP + rowIndex.get(d.cellType)! * CELL + CELL / 2}
            r={radius(d.fracExpressing!)}
            fill={colour(d.meanLog1pCp10k!)}
            stroke={theme.palette.divider}>
            <title>
              {`${d.cellType}, ${d.tissue}\nmean log1p CP10K ${d.meanLog1pCp10k!.toPrecision(3)}\n` +
                `${(d.fracExpressing! * 100).toFixed(1)}% of cells expressing\n` +
                `${d.nCells ?? "NA"} cells, ${d.nDonors ?? "NA"} donors`}
            </title>
          </circle>
        ))}
        <text x={legendX} y={TOP} fontSize={11} fill={theme.palette.text.secondary}>
          fraction expressing
        </text>
        {legendFracs.map((f, i) => (
          <g key={f} transform={`translate(${legendX + 12}, ${TOP + 20 + i * 26})`}>
            <circle r={radius(f)} fill="none" stroke={theme.palette.text.secondary} />
            <text x={20} y={4} fontSize={11} fill={theme.palette.text.secondary}>
              {(f * 100).toFixed(f * 100 < 10 ? 1 : 0)}%
            </text>
          </g>
        ))}
        <text x={legendX} y={TOP + 110} fontSize={11} fill={theme.palette.text.secondary}>
          mean log1p CP10K
        </text>
        <defs>
          <linearGradient id="cell-type-colour-ramp">
            <stop offset="0%" stopColor={lowColour} />
            <stop offset="100%" stopColor={highColour} />
          </linearGradient>
        </defs>
        <rect x={legendX} y={TOP + 118} width={110} height={10} fill="url(#cell-type-colour-ramp)" />
        <text x={legendX} y={TOP + 142} fontSize={11} fill={theme.palette.text.secondary}>
          0
        </text>
        <text x={legendX + 110} y={TOP + 142} textAnchor="end" fontSize={11} fill={theme.palette.text.secondary}>
          {grid.maxMean.toPrecision(2)}
        </text>
      </svg>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {grid.cellTypes.length} cell types x {grid.tissues.length} tissues; dots only where data exist
      </Typography>
    </Box>
  );
};

export default CellTypeDotPlot;
