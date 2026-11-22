import { describe, expect, it } from "vitest";
import type { GeneModel } from "@/types/types.gene";
import {
  axisTicks,
  bpToX,
  clampView,
  dotRadius,
  dragRegion,
  geneBox,
  hitGene,
  hitVariant,
  layoutGenes,
  MIN_VIEW_SPAN,
  pipToY,
  placeGeneLabels,
  TRACK,
  wheelZoomFactor,
  xToBp,
  zoomAt,
} from "./assocTrack";

const limits = { start: 1000, end: 11000 };
const WIDTH = 1000;

describe("view", () => {
  it("slides a view back inside the limits without changing its span", () => {
    expect(clampView({ start: 500, end: 2500 }, limits)).toEqual({ start: 1000, end: 3000 });
    expect(clampView({ start: 10500, end: 12500 }, limits)).toEqual({ start: 9000, end: 11000 });
  });

  it("bounds the span between the minimum and the limits", () => {
    expect(clampView({ start: 5000, end: 5010 }, limits)).toEqual({
      start: 5000,
      end: 5000 + MIN_VIEW_SPAN,
    });
    expect(clampView({ start: -5000, end: 50000 }, limits)).toEqual(limits);
  });

  it("zooms about the anchor, which stays at the same share of the view", () => {
    const view = { start: 4000, end: 6000 };
    const out = zoomAt(view, 4500, 2, limits);
    expect(out).toEqual({ start: 3500, end: 7500 });
    expect(bpToX(4500, out, WIDTH)).toBeCloseTo(bpToX(4500, view, WIDTH));
    expect(zoomAt(view, 4500, 0.5, limits)).toEqual({ start: 4250, end: 5250 });
  });

  it("stops zooming at the limits and at the minimum span", () => {
    expect(zoomAt({ start: 2000, end: 10000 }, 3000, 4, limits)).toEqual(limits);
    const tight = zoomAt({ start: 5000, end: 5300 }, 5100, 0.1, limits);
    expect(tight.end - tight.start).toBe(MIN_VIEW_SPAN);
  });

  it("turns wheel travel into a bounded factor, out for down and in for up", () => {
    expect(wheelZoomFactor(10, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(-10, 0)).toBeLessThan(1);
    expect(wheelZoomFactor(10, 0) * wheelZoomFactor(-10, 0)).toBeCloseTo(1);
    // a wheel that reports lines, or one huge step, zooms no further than the cap
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(wheelZoomFactor(48, 0));
    expect(wheelZoomFactor(5000, 0)).toBe(wheelZoomFactor(60, 0));
  });

  it("maps base pairs to pixels and back", () => {
    const view = { start: 2000, end: 4000 };
    expect(bpToX(2500, view, WIDTH)).toBe(250);
    expect(xToBp(250, view, WIDTH)).toBe(2500);
  });
});

describe("variant dots", () => {
  it("puts PIP 0 on the baseline and PIP 1 on the top line", () => {
    expect(pipToY(0)).toBe(TRACK.pipBottom);
    expect(pipToY(1)).toBe(TRACK.pipTop);
    expect(pipToY(7)).toBe(TRACK.pipTop);
  });

  it("grows a dot's area, not its radius, with the number of credible sets", () => {
    const one = dotRadius(1, 101);
    const half = dotRadius(51, 101);
    const most = dotRadius(101, 101);
    expect(most).toBeGreaterThan(half);
    expect(half ** 2 - one ** 2).toBeCloseTo(most ** 2 - half ** 2);
    expect(dotRadius(5000, 101)).toBe(most);
    // a locus where no variant is in more than one set
    expect(dotRadius(1, 1)).toBe(one);
  });

  it("selects what a drag covers, whichever way it ran", () => {
    const view = { start: 2000, end: 4000 };
    expect(dragRegion(600, 100, view, WIDTH)).toEqual(dragRegion(100, 600, view, WIDTH));
    expect(dragRegion(100, 600, view, WIDTH)).toEqual({ start: 2200, end: 3200 });
  });

  describe("hitVariant", () => {
    const view = { start: 0, end: 1000 };
    const dots = {
      positions: [100, 500, 504, 900],
      pip: [0.5, 1, 0.9, 0],
      radius: [dotRadius(1, 50), dotRadius(50, 50), dotRadius(1, 50), dotRadius(1, 50)],
    };

    it("reads the dot under the pointer", () => {
      expect(hitVariant(dots, view, WIDTH, 100, pipToY(0.5))).toBe(0);
      expect(hitVariant(dots, view, WIDTH, 300, pipToY(0.5))).toBeNull();
      expect(hitVariant(dots, view, WIDTH, 100, pipToY(0.9))).toBeNull();
    });

    it("gives a large dot a large target and prefers the nearer of two", () => {
      expect(hitVariant(dots, view, WIDTH, 492, pipToY(1))).toBe(1);
      expect(hitVariant(dots, view, WIDTH, 505, pipToY(0.9) + 1)).toBe(2);
    });

    it("reads a dot where it is drawn, whatever it stands for", () => {
      expect(hitVariant(dots, view, WIDTH, 900, pipToY(0))).toBe(3);
    });
  });
});

const gene = (name: string, start: number, end: number, strand = 1): GeneModel => ({
  geneName: name,
  ensg: "",
  chr: "1",
  strand,
  exonStarts: [start, end - 10],
  exonEnds: [start + 10, end],
  cdsStarts: [start, null],
  cdsEnds: [start + 10, null],
});

describe("layoutGenes", () => {
  const byName = (genes: ReturnType<typeof layoutGenes>) =>
    Object.fromEntries(genes.map((g) => [g.name, g.lane]));

  it("gives a gene the full lane unless it overlaps another on its strand", () => {
    const lanes = byName(
      layoutGenes(
        [gene("A", 100, 200), gene("B", 300, 400), gene("C", 150, 350, -1), gene("F", 500, 600)],
        "F"
      )
    );
    expect(lanes).toEqual({ A: "full", B: "full", C: "full", F: "full" });
  });

  it("splits overlapping genes of one strand between the two half lanes", () => {
    const lanes = byName(
      layoutGenes([gene("A", 100, 300), gene("B", 200, 400), gene("C", 350, 500)], "none")
    );
    // C overlaps B and starts after A has ended, so it takes A's lane
    expect(lanes).toEqual({ A: "outer", B: "inner", C: "outer" });
  });

  it("keeps the viewed gene at full height and sends what overlaps it to the outer half", () => {
    const genes = layoutGenes([gene("N", 100, 300), gene("F", 200, 400), gene("M", 250, 280)], "F");
    expect(byName(genes)).toEqual({ N: "outer", F: "full", M: "outer" });
    expect(genes.find((g) => g.name === "F")!.focal).toBe(true);
  });

  it("takes a gene's extent and exons from its canonical transcript, in genomic order", () => {
    const [laid] = layoutGenes(
      [{ ...gene("A", 100, 200), exonStarts: [190, 100], exonEnds: [200, 110] }],
      "A"
    );
    expect([laid.start, laid.end]).toEqual([100, 200]);
    expect(laid.exons.map((e) => e.start)).toEqual([100, 190]);
  });

  it("draws the forward strand above the centre line and the reverse below, halves outermost", () => {
    const [fwd, fwdHalf, rev, revHalf] = layoutGenes(
      [gene("A", 100, 200), gene("B", 300, 500), gene("C", 100, 200, -1), gene("D", 300, 500, -1)],
      "none"
    ).map((g, i) => geneBox(i % 2 === 1 ? { ...g, lane: "outer" as const } : g));
    expect(fwd.top + fwd.height).toBeLessThan(TRACK.centre);
    expect(rev.top).toBeGreaterThan(TRACK.centre);
    expect(fwdHalf.top).toBe(fwd.top);
    expect(revHalf.top + revHalf.height).toBe(rev.top + rev.height);
    expect(fwdHalf.height).toBeLessThan(fwd.height / 2 + 1);
  });
});

describe("placeGeneLabels", () => {
  // eight pixels a character
  const measure = (text: string) => text.length * 8;
  const view = { start: 0, end: 1000 };

  it("names the viewed gene first, then the others nearest first, where they fit", () => {
    const genes = layoutGenes(
      [
        gene("FAR", 900, 950),
        gene("NEAR", 545, 560),
        gene("FOCAL", 480, 540),
        gene("CLASH", 500, 520),
      ],
      "FOCAL"
    );
    const labels = placeGeneLabels(genes, view, WIDTH, measure);
    // CLASH would sit on FOCAL's name, and NEAR within the gap kept around it
    expect(labels.map((l) => l.gene.name)).toEqual(["FOCAL", "FAR"]);
    expect(labels[0].text).toBe("FOCAL ›");
    expect(labels[0].x).toBe(510);
  });

  it("gives each strand its own row, with the arrow on the side transcription runs to", () => {
    const genes = layoutGenes([gene("UP", 480, 540), gene("DOWN", 480, 540, -1)], "UP");
    const labels = placeGeneLabels(genes, view, WIDTH, measure);
    expect(labels.map((l) => l.text)).toEqual(["UP ›", "‹ DOWN"]);
  });

  it("keeps a name inside the track and over the visible part of its gene", () => {
    const genes = layoutGenes([gene("EDGE", -500, 20), gene("OUT", 2000, 3000)], "none");
    const labels = placeGeneLabels(genes, view, WIDTH, measure);
    expect(labels).toHaveLength(1);
    expect(labels[0].x).toBe(measure("EDGE ›") / 2);
  });
});

describe("hitGene", () => {
  const view = { start: 0, end: 1000 };
  const genes = layoutGenes(
    [gene("LONG", 100, 900), gene("SHORT", 400, 450), gene("REV", 100, 900, -1)],
    "none"
  );
  const forwardY = TRACK.forwardTop + 4;
  const reverseY = TRACK.reverseTop + 4;

  it("reads the gene on the pointer's side of the centre line", () => {
    expect(hitGene(genes, view, WIDTH, 200, forwardY)?.name).toBe("LONG");
    expect(hitGene(genes, view, WIDTH, 200, reverseY)?.name).toBe("REV");
    expect(hitGene(genes, view, WIDTH, 50, forwardY)).toBeNull();
    expect(hitGene(genes, view, WIDTH, 200, TRACK.pipTop)).toBeNull();
  });

  it("prefers the shorter of two overlapping genes, and the viewed gene over both", () => {
    expect(hitGene(genes, view, WIDTH, 420, forwardY)?.name).toBe("SHORT");
    const withFocal = layoutGenes([gene("LONG", 100, 900), gene("SHORT", 400, 450)], "LONG");
    expect(hitGene(withFocal, view, WIDTH, 420, forwardY)?.name).toBe("LONG");
  });
});

describe("axisTicks", () => {
  it("picks round positions about one per spacing", () => {
    expect(axisTicks({ start: 27_496_570, end: 27_523_953 }, 1400)).toEqual([
      27_500_000, 27_505_000, 27_510_000, 27_515_000, 27_520_000,
    ]);
    expect(axisTicks({ start: 0, end: 1_000_000 }, 1000)[1]).toBe(200_000);
  });

  it("never steps by less than a base pair", () => {
    expect(axisTicks({ start: 100, end: 104 }, 2000)).toEqual([100, 101, 102, 103, 104]);
  });
});
