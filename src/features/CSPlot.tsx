import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import { scaleLinear, scaleBand, scaleOrdinal, scalePow } from "d3-scale";
import { D3ZoomEvent, zoom, zoomIdentity, ZoomTransform } from "d3-zoom";
import { CSDatum, GeneModel } from "@/types/types.gene";
import { useThemeStore } from "@/store/store.theme";
import config from "@/config.json";
import { useMediaQuery } from "@mui/material";

const CSPlot = ({
  geneName,
  data,
  range,
  varAnno,
  resources,
  rowHeight,
  width,
  highlightTrait,
  setHighlightTrait,
  highlightVariant,
  setHighlightVariant,
  highlightCS,
  isZoomEnabled,
  geneModels,
  geneModelHeight,
  setGeneModelHeight,
}: {
  geneName: string;
  data: CSDatum[];
  range: number[];
  varAnno: { [key: string]: { [key: string]: string | boolean } } | undefined;
  resources: Record<string, string>[];
  rowHeight: number;
  width: number;
  highlightTrait?: string;
  setHighlightTrait?: (id: string | undefined) => void;
  highlightVariant?: string;
  setHighlightVariant?: (csDatum: CSDatum | undefined, index: number | undefined) => void;
  highlightCS?: Set<string>;
  isZoomEnabled?: boolean;
  geneModels: GeneModel[];
  geneModelHeight: number;
  setGeneModelHeight?: (height: number) => void;
}) => {
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
  const { isDarkMode } = useThemeStore();
  const isActualDarkMode = isDarkMode ?? prefersDarkMode;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const geneModelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | undefined>(undefined);
  const [zoomTransform, setZoomTransform] = useState<ZoomTransform>(zoomIdentity);
  const [geneModelPositions, setGeneModelPositions] = useState<
    { geneModel: GeneModel; y: number }[]
  >([]);
  useEffect(() => {
    setGeneModelPositions([]);
  }, [geneModels]);

  const csAreaHeight = data.length * rowHeight;

  const scales = useMemo(() => {
    const colorScale = scaleOrdinal<string>()
      .domain(resources.map((r) => r.dataName))
      .range(resources.map((r) => r.color));
    const pipScale = scalePow().exponent(0.5).domain([0, 1]).range([0, rowHeight]);
    const x = scaleLinear<number>().range([0, width]).domain(range);
    const y = scaleBand<number>()
      .range([0, csAreaHeight])
      .domain(data.map((_, i) => i));
    return { colorScale, pipScale, x, y };
  }, [resources, rowHeight, width, range, data, csAreaHeight]);

  const helperLines = false;
  const verticalLine = true;

  const drawGeneModel = useCallback(
    (
      context: CanvasRenderingContext2D,
      geneModel: GeneModel,
      geneModelY: number,
      exonHeight: number,
      geneStart: number,
      geneEnd: number
    ) => {
      const color =
        geneName === geneModel.geneName ? (isActualDarkMode ? "white" : "black") : "#888888";
      const geneLineY = geneModelY + exonHeight / 2;

      // gene line
      context.beginPath();
      context.moveTo(scales.x(geneStart), geneLineY);
      context.lineTo(scales.x(geneEnd), geneLineY);
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.stroke();
      // exons
      geneModel.exonStarts.forEach((start, exonIndex) => {
        const end = geneModel.exonEnds[exonIndex];
        context.beginPath();
        context.rect(scales.x(start), geneModelY, scales.x(end) - scales.x(start), exonHeight);
        context.fillStyle = color;
        context.fill();
      });

      // strand direction arrow
      const arrowSize = 5;
      const arrowX = scales.x(geneStart) - arrowSize - 5;
      context.beginPath();
      if (geneModel.strand === 1) {
        context.moveTo(arrowX, geneLineY - arrowSize);
        context.lineTo(arrowX + arrowSize, geneLineY);
        context.lineTo(arrowX, geneLineY + arrowSize);
      } else {
        context.moveTo(arrowX + arrowSize, geneLineY - arrowSize);
        context.lineTo(arrowX, geneLineY);
        context.lineTo(arrowX + arrowSize, geneLineY + arrowSize);
      }
      context.fillStyle = color;
      context.fill();

      const geneNameX = scales.x(geneEnd) + 5;
      const geneNameY = geneLineY + 3;

      context.font = "12px Arial";
      context.textBaseline = "middle";
      context.fillText(geneModel.geneName, geneNameX, geneNameY);
      context.fillStyle = color;
    },
    [scales.x, isActualDarkMode]
  );

  const drawGeneModels = useCallback(
    (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();

      const padding = 50; // minimum padding between gene models
      const geneModelRowHeight = 20;
      const exonHeight = 10;

      let totalGeneModelHeight = 0;
      if (geneModelPositions.length === 0) {
        const rows: { end: number; y: number }[] = []; // track the end position and y position of each row
        const positions: { geneModel: GeneModel; y: number }[] = [];

        geneModels.forEach((geneModel) => {
          const geneStart = Math.min(...geneModel.exonStarts);
          const geneEnd = Math.max(...geneModel.exonEnds);
          if (scales.x(geneEnd) < 0) {
            return; // if gene is not in the current viewport, skip it because otherwise its name may be drawn on the canvas which is not what we want
          }
          const geneNameWidth = context.measureText(geneModel.geneName).width;
          // find the earliest row where the gene model can fit without overlapping
          let placed = false;
          for (const row of rows) {
            if (scales.x(geneStart) >= row.end + padding) {
              row.end = scales.x(geneEnd) + geneNameWidth + padding;
              const y = row.y;
              positions.push({ geneModel, y });
              drawGeneModel(context, geneModel, y, exonHeight, geneStart, geneEnd);
              placed = true;
              break;
            }
          }

          if (!placed) {
            // create a new row
            const newRowY = rows.length * geneModelRowHeight;
            rows.push({ end: scales.x(geneEnd) + geneNameWidth + padding, y: newRowY });
            positions.push({ geneModel, y: newRowY });
            drawGeneModel(context, geneModel, newRowY, exonHeight, geneStart, geneEnd);
          }
        });

        setGeneModelPositions(positions);
        setGeneModelHeight && setGeneModelHeight(totalGeneModelHeight);
      } else {
        const ySeen = new Set<number>();
        geneModelPositions.forEach(({ geneModel, y }) => {
          const geneStart = Math.min(...geneModel.exonStarts);
          const geneEnd = Math.max(...geneModel.exonEnds);
          drawGeneModel(context, geneModel, y, exonHeight, geneStart, geneEnd);
          ySeen.add(y);
        });
        totalGeneModelHeight = Math.max(...Array.from(ySeen)) + geneModelRowHeight;
        setGeneModelHeight && setGeneModelHeight(totalGeneModelHeight);
      }

      if (verticalLine && mousePos) {
        context.beginPath();
        context.moveTo(mousePos.x, 0);
        context.lineTo(mousePos.x, geneModelHeight);
        context.strokeStyle = isActualDarkMode ? "rgba(255, 255, 255, 0.3)" : "rgba(0, 0, 0, 0.3)";
        context.lineWidth = 1;
        context.stroke();
      }
    },
    [geneModelHeight, drawGeneModel, geneModels, geneModelPositions, mousePos]
  );

  const draw = useCallback(
    (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => {
      if (!canvas || !context) return;

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      const { x, y, colorScale, pipScale } = scales;
      x.range([0, width].map((d) => zoomTransform.applyX(d)));

      data.forEach((d, i) => {
        const yPos = y(i)!;
        if (helperLines) {
          context.beginPath();
          context.moveTo(0, yPos);
          context.lineTo(width, yPos);
          context.strokeStyle = "gray";
          context.stroke();

          context.beginPath();
          context.moveTo(0, yPos + rowHeight);
          context.lineTo(width, yPos + rowHeight);
          context.strokeStyle = "gray";
          context.stroke();
        }

        if (d.traitId === highlightTrait) {
          context.fillStyle = isActualDarkMode ? "black" : "#eeeeee";
          context.fillRect(scales.x(0), yPos, 10000000000, rowHeight);
        }
        if (
          mousePos &&
          d.traitId != highlightTrait &&
          yPos <= mousePos.y &&
          mousePos.y < yPos + rowHeight
        ) {
          context.fillRect(scales.x(0), yPos, 10000000000, rowHeight);
          setHighlightTrait && d.traitId != highlightTrait && setHighlightTrait(d.traitId);
        }
        d.pos.forEach((pos, j) => {
          let color = colorScale(d.resource);
          const xPos = x(pos);
          const pipHeight = pipScale(d.pip[j]);
          if (d.variant[j] === highlightVariant) {
            color = isActualDarkMode ? "white" : "black";
          } else if (varAnno !== undefined && varAnno[d.variant[j]]?.isLoF) {
            color = config.gene_view.colors.plof;
          } else if (varAnno !== undefined && varAnno[d.variant[j]]?.isCoding) {
            color = config.gene_view.colors.coding;
          }
          if (highlightCS && !highlightCS.has(d.traitCSId)) {
            color = isActualDarkMode
              ? config.gene_view.colors.dimDark
              : config.gene_view.colors.dim;
          }
          context.beginPath();
          context.moveTo(xPos, yPos + rowHeight);
          context.lineTo(xPos, yPos + rowHeight - pipHeight);
          context.strokeStyle = color;
          context.stroke();
        });
      });

      if (verticalLine && mousePos) {
        context.beginPath();
        context.moveTo(mousePos.x, 0);
        context.lineTo(mousePos.x, csAreaHeight);
        context.strokeStyle = isActualDarkMode ? "rgba(255, 255, 255, 0.3)" : "rgba(0, 0, 0, 0.3)";
        context.lineWidth = 1;
        context.stroke();
      }

      context.restore();
    },
    [
      scales,
      data,
      highlightTrait,
      highlightVariant,
      highlightCS,
      zoomTransform,
      mousePos,
      isActualDarkMode,
    ]
  );

  const zoomBehavior = useMemo(
    () =>
      zoom<HTMLCanvasElement, unknown>()
        .scaleExtent([1, 100])
        .wheelDelta((d) => -0.0025 * d.deltaY)
        .translateExtent([
          [0, 0],
          [width, csAreaHeight],
        ])
        .on("zoom", (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
          setZoomTransform(event.transform);
        }),
    [width, csAreaHeight]
  );

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      setMousePos({ x: mouseX, y: mouseY });
      const { x, y, pipScale } = scales;
      let found = false;
      data.forEach((d, i) => {
        const yPos = y(i)!; // TODO is last row ok
        // find variants close to the mouse
        d.pos.forEach((pos, j) => {
          const xPos = x(pos);
          const pipHeight = pipScale(d.pip[j]);
          const lineTop = yPos + rowHeight - pipHeight - 1;
          const lineBottom = yPos + rowHeight + 1;
          const lineLeft = xPos - 3;
          const lineRight = xPos + 3;
          if (
            mouseX >= lineLeft &&
            mouseX <= lineRight &&
            mouseY >= lineTop &&
            mouseY <= lineBottom
          ) {
            setHighlightVariant && setHighlightVariant(d, j);
            found = true;
          }
        });
      });
      if (!found) {
        setHighlightVariant && setHighlightVariant(undefined, undefined);
      }
    },
    [data, scales, setHighlightVariant]
  );

  const handleMouseLeave = (event: MouseEvent) => {
    setMousePos(undefined);
    event.offsetX > 0 && setHighlightTrait && setHighlightTrait(undefined); // if offsetX is negative, mouse went to the trait list, so we don't want to reset the highlight trait
  };

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const geneModelCanvas = geneModelCanvasRef.current;
    const geneModelContext = geneModelCanvas?.getContext("2d");

    if (!canvas || !context || !geneModelCanvas || !geneModelContext) return;

    canvas.width = width;
    canvas.height = csAreaHeight;

    // Apply zoom behavior if enabled
    if (isZoomEnabled) {
      select(canvas).call(zoomBehavior);
    } else {
      select(canvas).on(".zoom", null);
    }

    draw(canvas, context);
    drawGeneModels(geneModelCanvas, geneModelContext);
  }, [width, csAreaHeight, isZoomEnabled, zoomBehavior, draw, drawGeneModels]);

  useLayoutEffect(() => {
    initCanvas();
  }, [initCanvas]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [handleMouseMove, handleMouseLeave]);

  useLayoutEffect(() => {
    if (!zoomTransform) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const geneModelCanvas = geneModelCanvasRef.current;
    const geneModelContext = geneModelCanvas?.getContext("2d");
    if (canvas && context && geneModelCanvas && geneModelContext) {
      scales.x.range([0, width].map((d) => zoomTransform.applyX(d)));
      draw(canvas, context);
      drawGeneModels(geneModelCanvas, geneModelContext);
    }
  }, [zoomTransform, mousePos, draw, drawGeneModels]);

  return (
    <div style={{ margin: 0, padding: 0 }}>
      <canvas
        ref={geneModelCanvasRef}
        width={width}
        height={geneModelHeight}
        style={{ display: "block" }}></canvas>
      <canvas
        ref={canvasRef}
        width={width}
        height={csAreaHeight}
        style={{ display: "block" }}></canvas>
      <div style={{ height: "60px" }}></div>
    </div>
  );
};

export default CSPlot;
