import { useMemo } from "react";
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

const exonTitle = (exon: ModelExon, total: number): string => {
  const coding =
    exon.cds == null
      ? "untranslated"
      : exon.cds.start === exon.start && exon.cds.end === exon.end
        ? "coding"
        : "partly coding";
  return `exon ${exon.number} of ${total} · ${exon.start.toLocaleString()}–${exon.end.toLocaleString()} · ${(exon.end - exon.start + 1).toLocaleString()} bp · ${coding}`;
};

const GeneModelPlot = ({ model }: { model: GeneModel }) => {
  const theme = useTheme();
  const layout = useMemo(() => layoutGeneModel(model), [model]);
  const colour = theme.palette.primary.main;
  const span = Math.max(1, layout.end - layout.start);
  const pct = (pos: number) => `${((pos - layout.start) / span) * 100}%`;
  const widthPct = (start: number, end: number) => `${(Math.max(0, end - start) / span) * 100}%`;
  const forward = model.strand === 1;

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
          height={HEIGHT}
          style={{ display: "block", overflow: "visible" }}
          role="img"
          aria-label={`gene model of ${model.geneName}`}>
          <line x1="0%" x2="100%" y1={MID} y2={MID} stroke={colour} strokeWidth={1.5} />
          {layout.arrows.map((pos) => (
            <svg key={pos} x={pct(pos)} y={MID} overflow="visible">
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
          {layout.exons.map((exon) => (
            <Tooltip key={exon.start} title={exonTitle(exon, layout.exons.length)} placement="top">
              <g>
                <rect
                  x={pct(exon.start)}
                  y={MID - UTR_HEIGHT / 2}
                  width={widthPct(exon.start, exon.end)}
                  height={UTR_HEIGHT}
                  fill={colour}
                  // a short exon in a long gene is a fraction of a pixel wide; the stroke keeps it
                  // visible and hoverable
                  stroke={colour}
                  strokeWidth={1}
                />
                {exon.cds && (
                  <rect
                    x={pct(exon.cds.start)}
                    y={MID - CDS_HEIGHT / 2}
                    width={widthPct(exon.cds.start, exon.cds.end)}
                    height={CDS_HEIGHT}
                    fill={colour}
                    stroke={colour}
                    strokeWidth={1}
                  />
                )}
                {/* hover target taller and wider than the mark */}
                <rect
                  x={pct(exon.start)}
                  y={MID - CDS_HEIGHT / 2}
                  width={widthPct(exon.start, exon.end)}
                  height={CDS_HEIGHT}
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth={6}
                />
              </g>
            </Tooltip>
          ))}
          <text x="0%" y={HEIGHT - 2} fontSize={11} fill={theme.palette.text.secondary}>
            chr{chrName(model.chr)}:{layout.start.toLocaleString()}
          </text>
          <text
            x="100%"
            y={HEIGHT - 2}
            fontSize={11}
            textAnchor="end"
            fill={theme.palette.text.secondary}>
            {layout.end.toLocaleString()}
          </text>
        </svg>
      </Box>
    </Box>
  );
};

export default GeneModelPlot;
