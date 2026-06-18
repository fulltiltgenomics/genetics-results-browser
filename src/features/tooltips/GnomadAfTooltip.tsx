import { Link, Typography, useTheme } from "@mui/material";
import { ReactNode } from "react";
import { GnomadFreq, GnomadPop } from "../../types/types.normalized";
import { HtmlTooltip } from "./HtmlTooltip";
import { ChartOptions, Plugin, TooltipItem } from "chart.js";
import { Bar } from "react-chartjs-2";
import { Chart, CategoryScale, LinearScale, BarElement, Tooltip } from "chart.js";

Chart.register(CategoryScale, LinearScale, BarElement, Tooltip);

// credible-set-model port of the legacy VariantGnomadToolTip: a log-scale bar plot of the per-
// population gnomAD allele frequency, read from the normalized GnomadFreq (byPop) instead of the old
// TableData gnomad record. Wraps an arbitrary trigger element (the AF cell text).

const POPS: GnomadPop[] = ["afr", "amr", "asj", "eas", "fin", "mid", "nfe", "remaining", "sas"];
const MAX_LOG_FREQ = 5;

const gnomadVariantUrl = (variant: string): string =>
  `https://gnomad.broadinstitute.org/variant/${variant.replace(/:/g, "-")}?dataset=gnomad_r4`;

export const GnomadAfTooltip = (props: {
  variant: string;
  gnomad: GnomadFreq;
  children: ReactNode;
}) => {
  const theme = useTheme();
  const { gnomad } = props;

  const dataValues = POPS.map((pop) => {
    const af = gnomad.byPop[pop];
    // reverse log scale: bar height = MAX_LOG_FREQ + log10(af), clamped at 1e-MAX_LOG_FREQ
    return af === undefined || af <= 0 ? 0 : MAX_LOG_FREQ + Math.max(-MAX_LOG_FREQ, Math.log10(af));
  });
  const textValues = POPS.map((pop) => {
    const af = gnomad.byPop[pop];
    return af === undefined
      ? "NA"
      : af === 0
      ? "0"
      : af < 0.01
      ? af.toExponential(1)
      : af.toPrecision(2);
  });

  const geLabel = gnomad.genomeOrExome === "g" ? " (genomes)" : gnomad.genomeOrExome === "e" ? " (exomes)" : "";

  const data = {
    labels: POPS as string[],
    datasets: [
      {
        label: `gnomAD${geLabel} allele frequency`,
        data: dataValues,
        backgroundColor: theme.palette.primary.main,
        categoryPercentage: 0.95,
      },
    ],
  };

  const options: ChartOptions<"bar"> = {
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          stepSize: 1,
          callback: (_, index) => (index === MAX_LOG_FREQ ? "" : `1e-${MAX_LOG_FREQ - index}`),
        },
        grid: {
          drawOnChartArea: true,
          color: (context) =>
            context.tick && context.index === MAX_LOG_FREQ ? "rgba(0, 0, 0, 0)" : "#E0E0E0",
        },
      },
      x: { grid: { display: false } },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context: TooltipItem<"bar">) =>
            `${context.label} AF ${textValues[context.dataIndex]}`,
        },
      },
    },
    animation: false,
  };

  const plugins: Plugin<"bar">[] = [
    {
      id: "dataLabelsOnTop",
      afterDraw: (chart: Chart) => {
        const ctx = chart.ctx;
        const meta = chart.getDatasetMeta(0);
        if (meta.hidden) return;
        ctx.fillStyle = "rgb(255, 255, 255)";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        meta.data.forEach((element, index) => {
          const s = textValues[index] === "0" ? "" : textValues[index];
          ctx.fillText(s, element.x, element.y + 15);
        });
      },
    },
  ];

  const popmax =
    gnomad.popmaxPop !== undefined && gnomad.popmaxAf !== undefined ? (
      <Typography variant="body2" sx={{ paddingBottom: "4px" }}>
        highest in {gnomad.popmaxPop}:{" "}
        {gnomad.popmaxAf < 0.001 ? gnomad.popmaxAf.toExponential(1) : gnomad.popmaxAf.toPrecision(2)}
      </Typography>
    ) : null;

  return (
    <HtmlTooltip
      title={
        <div style={{ display: "flex", flexDirection: "column", width: "500px" }}>
          <Typography variant="h6" sx={{ paddingBottom: "10px" }}>
            gnomAD{geLabel} allele frequency
          </Typography>
          {popmax}
          <Bar data={data} options={options} plugins={plugins} />
          <Link color="inherit" href={gnomadVariantUrl(props.variant)} target="_blank">
            Go to gnomAD variant page
          </Link>
        </div>
      }>
      <span>{props.children}</span>
    </HtmlTooltip>
  );
};

export default GnomadAfTooltip;
