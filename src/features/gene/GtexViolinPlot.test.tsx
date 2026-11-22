import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GtexViolinPlot from "./GtexViolinPlot";

const expression = {
  ensemblId: "ENSG00000169174",
  gencodeId: "ENSG00000169174.13",
  dataset: "gtex_v11",
  release: "v11",
  unit: "TPM",
  tissues: [
    { tissue: "Whole_Blood", values: [0, 0, 0.5] },
    { tissue: "Liver", values: [120, 150, 180, 210, 240, 2000] },
    { tissue: "Brain_Cortex", values: [1, 2, 3, 4] },
    { tissue: "Lung", values: [] },
  ],
};

const tissues = () =>
  Array.from(screen.getByTestId("gtex-violin-plot").querySelectorAll("g[data-tissue]"));

describe("GtexViolinPlot", () => {
  it("draws a violin per tissue with samples, by tissue name, in the portal's colours", () => {
    render(<GtexViolinPlot expression={expression} />);
    expect(tissues().map((g) => g.getAttribute("data-tissue"))).toEqual([
      "Brain_Cortex",
      "Liver",
      "Whole_Blood",
    ]);
    const liver = tissues()[1];
    expect(liver.querySelector("polygon")).toHaveAttribute("fill", "#AABB66");
    expect(liver.querySelector("title")!.textContent).toBe(
      "Liver · 6 samples · median 195 TPM, quartiles 158–233"
    );
    // the one sample beyond 1.5 IQR is a point
    expect(liver.querySelectorAll("circle")).toHaveLength(1);
  });

  it("orders the tissues by median on request", async () => {
    render(<GtexViolinPlot expression={expression} />);
    await userEvent.click(screen.getByRole("button", { name: "by median" }));
    expect(tissues().map((g) => g.getAttribute("data-tissue"))).toEqual([
      "Liver",
      "Brain_Cortex",
      "Whole_Blood",
    ]);
  });

  it("labels the axis in TPM on both scales", async () => {
    render(<GtexViolinPlot expression={expression} />);
    const plot = within(screen.getByTestId("gtex-violin-plot"));
    expect(plot.getByText("TPM (log scale)")).toBeInTheDocument();
    expect(plot.getByText("1000")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "linear scale" }));
    expect(plot.getByText("TPM")).toBeInTheDocument();
    expect(plot.getByText("500")).toBeInTheDocument();
  });
});
