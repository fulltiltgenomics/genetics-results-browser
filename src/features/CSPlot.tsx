import { useEffect, useRef, useState } from "react";
import { select } from "d3-selection";
import { scaleLinear, scaleBand, scaleOrdinal, scalePow } from "d3-scale";
import { D3ZoomEvent, zoom, ZoomBehavior, zoomIdentity, ZoomTransform } from "d3-zoom";
import { CSDatum, GeneModel } from "@/types/types.gene";

const CSPlot = ({
  geneName,
  data,
  range,
  varAnno,
  resources,
  colors,
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
  resources: string[];
  colors: string[];
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const geneModelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | undefined>(undefined);
  const [zoomTransform, setZoomTransform] = useState<ZoomTransform>(zoomIdentity);
  const [geneModelPositions, setGeneModelPositions] = useState<
    { geneModel: GeneModel; y: number }[]
  >([]);

  const colorScale = scaleOrdinal<string>().domain(resources).range(colors);
  const pipScale = scalePow().exponent(0.5).domain([0, 1]).range([0, rowHeight]);

  const csAreaHeight = data.length * rowHeight;

  const x = scaleLinear<number>().range([0, width]);
  const y = scaleBand<number>().range([0, csAreaHeight]);
  x.domain(range);
  y.domain(data.map((_, i) => i));

  const helperLines = false;
  const verticalLine = true;

  const drawGeneModels = (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => {
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
        if (x(geneEnd) < 0) {
          return; // if gene is not in the current viewport, skip it because otherwise its name may be drawn on the canvas which is not what we want
        }
        const geneNameWidth = context.measureText(geneModel.geneName).width;
        // find the earliest row where the gene model can fit without overlapping
        let placed = false;
        for (const row of rows) {
          if (x(geneStart) >= row.end + padding) {
            row.end = x(geneEnd) + geneNameWidth + padding;
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
          rows.push({ end: x(geneEnd) + geneNameWidth + padding, y: newRowY });
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
      context.strokeStyle = "rgba(255, 255, 255, 0.3)";
      context.lineWidth = 1;
      context.stroke();
    }
  };

  const drawGeneModel = (
    context: CanvasRenderingContext2D,
    geneModel: GeneModel,
    geneModelY: number,
    exonHeight: number,
    geneStart: number,
    geneEnd: number
  ) => {
    const color = geneName === geneModel.geneName ? "white" : "#999999";
    const geneLineY = geneModelY + exonHeight / 2;

    // gene line
    context.beginPath();
    context.moveTo(x(geneStart), geneLineY);
    context.lineTo(x(geneEnd), geneLineY);
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.stroke();
    // exons
    geneModel.exonStarts.forEach((start, exonIndex) => {
      const end = geneModel.exonEnds[exonIndex];
      context.beginPath();
      context.rect(x(start), geneModelY, x(end) - x(start), exonHeight);
      context.fillStyle = color;
      context.fill();
      context.fillStyle = "black";
    });

    // strand direction arrow
    const arrowSize = 5;
    const arrowX = x(geneStart) - arrowSize - 5;
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

    const geneNameX = x(geneEnd) + 5;
    const geneNameY = geneLineY + 3;

    context.font = "12px Arial";
    context.textBaseline = "middle";
    context.fillText(geneModel.geneName, geneNameX, geneNameY);
    context.fillStyle = color;
  };

  const draw = (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => {
    if (!canvas || !context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
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
        context.fillStyle = "black";
        context.fillRect(x(0), yPos, 10000000000, rowHeight);
      }
      if (
        mousePos &&
        d.traitId != highlightTrait &&
        yPos <= mousePos.y &&
        mousePos.y < yPos + rowHeight
      ) {
        context.fillRect(x(0), yPos, 10000000000, rowHeight);
        setHighlightTrait && d.traitId != highlightTrait && setHighlightTrait(d.traitId);
      }
      d.pos.forEach((pos, j) => {
        let color = colorScale(d.resource);
        const xPos = x(pos);
        const pipHeight = pipScale(d.pip[j]);
        if (d.variant[j] === highlightVariant) {
          color = "white";
        } else if (varAnno !== undefined && varAnno[d.variant[j]]?.isLoF) {
          color = "red";
        } else if (varAnno !== undefined && varAnno[d.variant[j]]?.isCoding) {
          color = "orange";
        }
        if (highlightCS && !highlightCS.has(d.traitCSId)) {
          color = "#444444";
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
      context.strokeStyle = "rgba(255, 255, 255, 0.3)";
      context.lineWidth = 1;
      context.stroke();
    }

    context.restore();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const geneModelCanvas = geneModelCanvasRef.current;
    const geneModelContext = geneModelCanvas?.getContext("2d");

    const handleMouseMove = (event: MouseEvent) => {
      const rect = canvas!.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      setMousePos({ x: mouseX, y: mouseY });

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
    };

    const handleMouseLeave = (event: MouseEvent) => {
      setMousePos(undefined);
      event.offsetX > 0 && setHighlightTrait && setHighlightTrait(undefined); // if offsetX is negative, mouse went to the trait list, so we don't want to reset the highlight trait
    };

    const initChart = () => {
      if (!canvas || !context || !geneModelCanvas || !geneModelContext) return;

      canvas.width = width;
      canvas.height = csAreaHeight;

      const zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown> = zoom<
        HTMLCanvasElement,
        unknown
      >()
        .scaleExtent([1, 100])
        .wheelDelta((d) => -0.0025 * d.deltaY)
        .translateExtent([
          [0, 0],
          [width, csAreaHeight],
        ])
        .on("zoom", (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
          if (canvas && context && geneModelCanvas) {
            setZoomTransform(event.transform);
          }
        });

      const selection = select(canvas);
      if (isZoomEnabled) {
        selection.call(zoomBehavior);
      } else {
        selection.on(".zoom", null); // Disable zoom
      }

      canvas.addEventListener("mousemove", handleMouseMove);
      canvas.addEventListener("mouseleave", handleMouseLeave);

      draw(canvas, context);
      drawGeneModels(geneModelCanvas, geneModelContext);
    };

    initChart();

    return () => {
      canvas?.removeEventListener("mousemove", handleMouseMove);
      canvas?.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [data, rowHeight, width, highlightTrait, isZoomEnabled]);

  useEffect(() => {
    if (zoomTransform) {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      const geneModelCanvas = geneModelCanvasRef.current;
      const geneModelContext = geneModelCanvas?.getContext("2d");
      if (canvas && context && geneModelCanvas && geneModelContext) {
        x.range([0, width].map((d) => zoomTransform.applyX(d)));
        draw(canvas, context);
        drawGeneModels(geneModelCanvas, geneModelContext);
      }
    }
  }, [zoomTransform, mousePos]);

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
      <div style={{ height: "20px" }}></div>
    </div>
  );
};

export default CSPlot;
