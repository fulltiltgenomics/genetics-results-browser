import { describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";

// Mol* needs WebGL, which jsdom has none of: the scene module is replaced whole, so these
// tests cover the states around it and never load Mol*
const createScene = vi.fn();
const downloadBlob = vi.fn();
vi.mock("../chat/downloadBlob", () => ({ downloadBlob: (...args: unknown[]) => downloadBlob(...args) }));
vi.mock("./molstarScene", () => {
  class WebGLUnavailableError extends Error {}
  return { WebGLUnavailableError, createScene: (...args: unknown[]) => createScene(...args) };
});

import StructureViewer, { StructureView } from "./StructureViewer";
import type { ViewSpec } from "./viewSpec";

const SPEC = {
  version: 1,
  model_file_id: "AF-TEST-F1-model_v6",
  gene: "GENE1",
  residues: [
    { file_position: 5, label: "p.A5V", role: "case" },
    { file_position: 900, role: "control" },
  ],
  sphere: { centre: 5, radius: 8 },
};
const b64 = (value: unknown) => btoa(typeof value === "string" ? value : JSON.stringify(value));
const ROUTE = "*/api/v1/protein_structure/structure/AF-TEST-F1-model_v6";

const show = (data: string) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <StructureViewer name="gene1.structure-view.json" data={data} />
    </QueryClientProvider>,
  );

describe("StructureViewer", () => {
  it("says so when the spec is invalid, and fetches nothing", () => {
    show(b64({ ...SPEC, model_file_id: undefined }));
    expect(screen.getByTestId("structure-view-invalid")).toHaveTextContent(/cannot be shown.*model_file_id/);
  });

  it("says so when the spec is not JSON", () => {
    show(b64("not json"));
    expect(screen.getByTestId("structure-view-invalid")).toHaveTextContent(/not valid JSON/);
  });

  it("asks for a reload when the spec is from a newer format", () => {
    show(b64({ ...SPEC, version: 99 }));
    expect(screen.getByTestId("structure-view-invalid")).toHaveTextContent(/newer format.*Reload/);
  });

  it("shows loading, then the model's absence on a 404", async () => {
    server.use(http.get(ROUTE, () => HttpResponse.json({ detail: "unknown" }, { status: 404 })));
    show(b64(SPEC));
    expect(screen.getByText(/loading structure AF-TEST-F1-model_v6/)).toBeInTheDocument();
    expect(await screen.findByText(/not in the current protein-structure release/)).toBeInTheDocument();
    expect(createScene).not.toHaveBeenCalled();
  });

  it("says structures are unavailable on a 503", async () => {
    server.use(http.get(ROUTE, () => HttpResponse.json({ detail: "no release" }, { status: 503 })));
    show(b64(SPEC));
    expect(await screen.findByText(/not available on this server right now/)).toBeInTheDocument();
  });

  it("hands the PDB text and the parsed spec to the scene, and reports what was not drawn", async () => {
    server.use(http.get(ROUTE, () => HttpResponse.text("ATOM      1", { headers: { "Content-Type": "chemical/x-pdb" } })));
    createScene.mockResolvedValueOnce({
      highlighted: [5],
      colourTheme: "plddt-confidence",
      sphereDrawn: true,
      plddtLegend: [{ name: "Very High", colour: "#0053d6" }],
      dispose: vi.fn(),
    });
    show(b64(SPEC));
    const legend = await screen.findByTestId("structure-legend");
    expect(createScene).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      "ATOM      1",
      expect.objectContaining({ modelFileId: "AF-TEST-F1-model_v6" }),
      expect.objectContaining({ onHover: expect.any(Function), onContextLost: expect.any(Function) }),
    );
    expect(screen.getByTestId("structure-canvas")).toHaveAttribute("data-highlighted", "5");
    expect(legend).toHaveTextContent("very high (> 90)");
    expect(legend).toHaveTextContent("case");
    expect(legend).toHaveTextContent("within 8 Å of residue 5");
    expect(legend).toHaveTextContent("1 of 2 listed residues are outside this model");
  });

  const READY = {
    highlighted: [5, 900],
    colourTheme: "plddt-confidence",
    sphereDrawn: true,
    regions: [],
    plddtLegend: [],
  };

  it("shows what the pointer is over, as the scene reports it", async () => {
    server.use(http.get(ROUTE, () => HttpResponse.text("ATOM      1")));
    createScene.mockResolvedValueOnce({ ...READY, dispose: vi.fn() });
    show(b64(SPEC));
    await screen.findByTestId("structure-legend");
    expect(screen.getByTestId("structure-hint")).toHaveTextContent("Ctrl or ⌘ + scroll to zoom");
    const events = createScene.mock.lastCall?.[3];
    act(() => events.onHover("ALA 5 · p.A5V"));
    expect(screen.getByTestId("structure-hover")).toHaveTextContent("ALA 5 · p.A5V");
    act(() => events.onHover(null));
    expect(screen.queryByTestId("structure-hover")).toBeNull();
  });

  describe("labelled residues in the legend", () => {
    const LABELLED = {
      ...SPEC,
      residues: [
        { file_position: 600, label: "p.V600E", role: "case" },
        { file_position: 601, label: "hotspot", colour: "#00aa00" },
        { file_position: 602 },
        { file_position: 900, label: "p.X900Y" },
      ],
    };
    const draw = async () => {
      server.use(http.get(ROUTE, () => HttpResponse.text("ATOM      1")));
      const emphasise = vi.fn(async (positions: number[], marker?: boolean) => ({
        positions,
        marker: positions.length > 0 && marker !== false,
      }));
      const focus = vi.fn();
      createScene.mockResolvedValueOnce({ ...READY, highlighted: [600, 601, 602], emphasise, focus, dispose: vi.fn() });
      show(b64(LABELLED));
      await screen.findByTestId("structure-legend");
      return { emphasise, focus, events: createScene.mock.lastCall?.[3] };
    };

    it("lists each labelled residue the model holds, with the position where the label has none", async () => {
      await draw();
      const entries = screen.getAllByTestId("structure-legend-entry");
      expect(entries.map((e) => e.textContent)).toEqual(["p.V600E", "hotspot · 601"]);
      expect(entries.map((e) => e.getAttribute("data-positions"))).toEqual(["600", "601"]);
    });

    it("emphasises an entry's residues on hover and on focus, and clears on leave and blur", async () => {
      const { emphasise, focus } = await draw();
      const [first, second] = screen.getAllByTestId("structure-legend-entry");
      const canvas = screen.getByTestId("structure-canvas");

      fireEvent.mouseEnter(first);
      expect(emphasise).toHaveBeenLastCalledWith([600], true);
      await vi.waitFor(() => expect(canvas).toHaveAttribute("data-emphasised", "600"));
      expect(canvas).toHaveAttribute("data-emphasis-marker", "true");
      fireEvent.mouseLeave(first);
      expect(emphasise).toHaveBeenLastCalledWith([], true);
      await vi.waitFor(() => expect(canvas).not.toHaveAttribute("data-emphasised"));

      act(() => second.focus());
      expect(emphasise).toHaveBeenLastCalledWith([601], true);
      act(() => second.blur());
      expect(emphasise).toHaveBeenLastCalledWith([], true);
      // pointing never moves the camera
      expect(focus).not.toHaveBeenCalled();
    });

    it("emphasises the entry under the pointer, else the focused one", async () => {
      const { emphasise } = await draw();
      const [first, second] = screen.getAllByTestId("structure-legend-entry");
      act(() => second.focus());
      fireEvent.mouseEnter(first);
      expect(emphasise).toHaveBeenLastCalledWith([600], true);
      // the pointer leaving one entry gives the emphasis back to the focused one
      fireEvent.mouseLeave(first);
      expect(emphasise).toHaveBeenLastCalledWith([601], true);

      // neither a blur under the pointer nor the pointer leaving the focused entry ends it
      fireEvent.mouseEnter(second);
      const calls = emphasise.mock.calls.length;
      act(() => second.blur());
      act(() => second.focus());
      fireEvent.mouseLeave(second);
      expect(emphasise.mock.calls.length).toBe(calls);
      act(() => second.blur());
      expect(emphasise).toHaveBeenLastCalledWith([], true);
    });

    it("drops the emphasis when the scene says the pointer took it over, and gives it again when asked", async () => {
      const { emphasise, events } = await draw();
      const [first, second] = screen.getAllByTestId("structure-legend-entry");
      const canvas = screen.getByTestId("structure-canvas");
      act(() => second.focus());
      await vi.waitFor(() => expect(canvas).toHaveAttribute("data-emphasised", "601"));
      act(() => events.onEmphasisEnd());
      expect(canvas).not.toHaveAttribute("data-emphasised");
      expect(canvas).not.toHaveAttribute("data-emphasis-marker");
      // the scene has cleared it already
      const calls = emphasise.mock.calls.length;
      act(() => second.blur());
      expect(emphasise.mock.calls.length).toBe(calls);

      // the still-focused entry is emphasised again once the pointer has been to another and left
      act(() => second.focus());
      act(() => events.onEmphasisEnd());
      fireEvent.mouseEnter(first);
      fireEvent.mouseLeave(first);
      expect(emphasise).toHaveBeenLastCalledWith([601], true);
      await vi.waitFor(() => expect(canvas).toHaveAttribute("data-emphasised", "601"));
    });

    it("ignores the answer to an emphasis the scene ended while it was being built", async () => {
      const { emphasise, events } = await draw();
      const [first] = screen.getAllByTestId("structure-legend-entry");
      let answer: (held: { positions: number[]; marker: boolean }) => void = () => {};
      emphasise.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
      fireEvent.mouseEnter(first);
      act(() => events.onEmphasisEnd());
      await act(async () => answer({ positions: [600], marker: true }));
      expect(screen.getByTestId("structure-canvas")).not.toHaveAttribute("data-emphasised");
    });

    it("shows the latest emphasis when an earlier answer arrives after it", async () => {
      const { emphasise } = await draw();
      const [first] = screen.getAllByTestId("structure-legend-entry");
      let answerHover: (held: { positions: number[]; marker: boolean }) => void = () => {};
      emphasise.mockImplementationOnce(() => new Promise((resolve) => (answerHover = resolve)));
      fireEvent.mouseEnter(first);
      fireEvent.mouseLeave(first);
      await act(async () => answerHover({ positions: [600], marker: true }));
      expect(screen.getByTestId("structure-canvas")).not.toHaveAttribute("data-emphasised");
    });

    it("centres the camera on a clicked entry, and returns to the whole model on a second click", async () => {
      const { focus } = await draw();
      const [first, second] = screen.getAllByTestId("structure-legend-entry");
      fireEvent.click(first);
      expect(focus).toHaveBeenLastCalledWith([600]);
      expect(first).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(second);
      expect(focus).toHaveBeenLastCalledWith([601]);
      expect(first).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(second);
      expect(focus).toHaveBeenLastCalledWith([]);
      expect(second).toHaveAttribute("aria-pressed", "false");
    });

    it("drops the marker while the pointed-at entry is the centred one", async () => {
      const { emphasise } = await draw();
      const [first, second] = screen.getAllByTestId("structure-legend-entry");
      const canvas = screen.getByTestId("structure-canvas");
      fireEvent.mouseEnter(first);
      fireEvent.click(first);
      expect(emphasise).toHaveBeenLastCalledWith([600], false);
      await vi.waitFor(() => expect(canvas).toHaveAttribute("data-emphasis-marker", "false"));
      expect(canvas).toHaveAttribute("data-emphasised", "600");
      fireEvent.mouseLeave(first);
      fireEvent.mouseEnter(first);
      expect(emphasise).toHaveBeenLastCalledWith([600], false);
      // another entry is not the centred one, and the first is again once the view is back
      fireEvent.mouseEnter(second);
      expect(emphasise).toHaveBeenLastCalledWith([601], true);
      fireEvent.click(first);
      expect(emphasise).toHaveBeenLastCalledWith([600], true);
    });

    it("marks the entry of the residue the pointer is over in the scene", async () => {
      const { events } = await draw();
      const [first, second] = screen.getAllByTestId("structure-legend-entry");
      act(() => events.onHover("LYS 601 · hotspot", 601));
      expect(second).toHaveAttribute("data-marked");
      expect(first).not.toHaveAttribute("data-marked");
      // a drawn residue with no label has no entry to mark
      act(() => events.onHover("GLY 602", 602));
      expect(screen.getByTestId("structure-legend").querySelector("[data-marked]")).toBeNull();
      act(() => events.onHover(null, null));
      expect(second).not.toHaveAttribute("data-marked");
    });
  });

  describe("regions in the legend", () => {
    const WITH_REGIONS = {
      ...SPEC,
      residues: [
        { file_position: 20, label: "p.S20L", role: "case" },
        { file_position: 70, label: "p.V70M", role: "control" },
      ],
      regions: [
        { name: "EF-hand 1", start: 10, end: 30, colour: "#17becf" },
        { name: "linker", start: 25, end: 40 },
        { name: "tail", start: 90, end: 120 },
        { name: "elsewhere", start: 500, end: 600, colour: "#000000" },
        { name: "site", start: 70, end: 70 },
      ],
    };
    const range = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, i) => first + i);
    // a 94-residue model: the tail is partly outside it, "elsewhere" wholly
    const HELD = [range(10, 30), range(25, 40), range(90, 94), [], [70]];
    const draw = async (spec: unknown = WITH_REGIONS, regions = HELD) => {
      server.use(http.get(ROUTE, () => HttpResponse.text("ATOM      1")));
      const emphasise = vi.fn(async (positions: number[]) => ({ positions, marker: false }));
      const focus = vi.fn();
      createScene.mockResolvedValueOnce({
        ...READY,
        highlighted: [20, 70],
        regions,
        emphasise,
        focus,
        dispose: vi.fn(),
      });
      show(b64(spec));
      await screen.findByTestId("structure-legend");
      return { emphasise, focus, events: createScene.mock.lastCall?.[3] };
    };
    const texts = () => screen.getAllByTestId("structure-legend-entry").map((e) => e.textContent);

    it("lists the regions the model holds before the residues, each with the range it covers", async () => {
      await draw();
      expect(texts()).toEqual([
        "EF-hand 1 · 10–30",
        "linker · 25–40",
        "tail · 90–94 (of 90–120)",
        "site · 70",
        "p.S20L",
        "p.V70M",
      ]);
      const entries = screen.getAllByTestId("structure-legend-entry");
      expect(entries.map((e) => e.getAttribute("data-kind"))).toEqual([
        "region", "region", "region", "region", "residue", "residue",
      ]);
      expect(entries[2]).toHaveAttribute("data-positions", "90-94");
      // a bar for every region, hollow where the spec gave no colour; a residue has none
      const swatches = screen.getAllByTestId("structure-legend-swatch");
      expect(swatches.map((s) => s.getAttribute("data-painted"))).toEqual(["true", "false", "false", "false"]);
      expect(screen.getByTestId("structure-legend")).toHaveTextContent(
        "1 of 5 regions are outside this model and not shown",
      );
    });

    it("emphasises the part of a region the model holds, and centres on it when clicked", async () => {
      const { emphasise, focus } = await draw();
      const tail = screen.getByRole("button", { name: /^tail/ });
      const canvas = screen.getByTestId("structure-canvas");
      fireEvent.mouseEnter(tail);
      expect(emphasise).toHaveBeenLastCalledWith(range(90, 94), true);
      await vi.waitFor(() => expect(canvas).toHaveAttribute("data-emphasised", "90,91,92,93,94"));
      fireEvent.mouseLeave(tail);
      expect(focus).not.toHaveBeenCalled();

      // a long range is summarised for whoever reads it back
      const hand = screen.getByRole("button", { name: /^EF-hand 1/ });
      act(() => hand.focus());
      await vi.waitFor(() => expect(canvas).toHaveAttribute("data-emphasised", "21 residues 10-30"));
      fireEvent.click(hand);
      expect(focus).toHaveBeenLastCalledWith(range(10, 30));
      expect(hand).toHaveAttribute("aria-pressed", "true");
    });

    it("marks every region holding the residue the pointer is over, beside the residue's own entry", async () => {
      const { events } = await draw();
      const marked = () =>
        screen.getAllByTestId("structure-legend-entry").filter((e) => e.hasAttribute("data-marked")).map((e) => e.textContent);
      act(() => events.onHover("SER 20 · p.S20L", 20));
      expect(marked()).toEqual(["EF-hand 1 · 10–30", "p.S20L"]);
      act(() => events.onHover("GLY 27", 27));
      expect(marked()).toEqual(["EF-hand 1 · 10–30", "linker · 25–40"]);
      act(() => events.onHover("VAL 70 · p.V70M", 70));
      expect(marked()).toEqual(["site · 70", "p.V70M"]);
      act(() => events.onHover("GLY 60", 60));
      expect(marked()).toEqual([]);
      act(() => events.onHover(null, null));
      expect(marked()).toEqual([]);
    });

    it("says how many regions the cap left out", async () => {
      const regions = Array.from({ length: 53 }, (_, i) => ({ name: `d${i}`, start: 500 + i, end: 600 }));
      await draw({ ...WITH_REGIONS, regions: [...WITH_REGIONS.regions.slice(0, 2), ...regions] }, HELD.slice(0, 2));
      expect(texts().filter((t) => t?.includes("·"))).toEqual(["EF-hand 1 · 10–30", "linker · 25–40"]);
      expect(screen.getByTestId("structure-legend")).toHaveTextContent("only the first 50 of 55 regions are shown");
    });
  });

  it("lists the first 40 labelled residues of the spec and says how many it does not list", async () => {
    server.use(http.get(ROUTE, () => HttpResponse.text("ATOM      1")));
    // the second is outside the model: it takes one of the 40 places and gets no entry
    const residues = Array.from({ length: 50 }, (_, i) => ({ file_position: i === 1 ? 900 : i + 1, label: `p.L${i + 1}` }));
    createScene.mockResolvedValueOnce({
      ...READY,
      highlighted: residues.map((r) => r.file_position).filter((p) => p !== 900),
      regions: [[3, 4]],
      dispose: vi.fn(),
    });
    show(b64({ ...SPEC, residues, regions: [{ name: "domain", start: 3, end: 4 }] }));
    const legend = await screen.findByTestId("structure-legend");
    const entries = screen.getAllByTestId("structure-legend-entry").map((e) => e.textContent);
    expect(entries).toHaveLength(1 + 39);
    expect(entries.slice(0, 3)).toEqual(["domain · 3–4", "p.L1", "p.L3"]);
    expect(entries.at(-1)).toBe("p.L40");
    expect(legend).toHaveTextContent("10 more labelled residues are not listed here");
    // a label past the cap is still what the scene's hover text carries
    expect(createScene.mock.lastCall?.[2].residues).toHaveLength(50);
  });

  it("says so when the browser drops the WebGL context, and draws again on request", async () => {
    server.use(http.get(ROUTE, () => HttpResponse.text("ATOM      1")));
    const dispose = vi.fn();
    createScene.mockResolvedValueOnce({ ...READY, dispose });
    show(b64(SPEC));
    await screen.findByTestId("structure-legend");
    const calls = createScene.mock.calls.length;
    act(() => createScene.mock.lastCall?.[3].onContextLost());
    expect(screen.getByText(/released this structure's 3D drawing context/)).toBeInTheDocument();
    expect(dispose).toHaveBeenCalled();
    expect(screen.queryByTestId("structure-legend")).toBeNull();

    createScene.mockResolvedValueOnce({ ...READY, dispose: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Show again" }));
    expect(await screen.findByTestId("structure-legend")).toBeInTheDocument();
    expect(createScene.mock.calls.length).toBe(calls + 1);
  });

  it("says what the caps left out", async () => {
    server.use(http.get(ROUTE, () => HttpResponse.text("ATOM      1")));
    const residues = Array.from({ length: 2010 }, (_, i) => ({ file_position: i + 1, label: `L${i}` }));
    createScene.mockResolvedValueOnce({ ...READY, highlighted: residues.map((r) => r.file_position), dispose: vi.fn() });
    show(b64({ ...SPEC, residues }));
    const legend = await screen.findByTestId("structure-legend");
    expect(legend).toHaveTextContent("only the first 2,000 of 2,010 listed residues are drawn");
    expect(legend).toHaveTextContent("1,960 more labelled residues are not listed here");
    expect(screen.getAllByTestId("structure-legend-entry")).toHaveLength(40);
  });

  it("refuses a spec over 1 MB without decoding it", () => {
    const decode = vi.spyOn(globalThis, "atob");
    show("A".repeat(1_400_000));
    expect(screen.getByTestId("structure-view-invalid")).toHaveTextContent("larger than 1 MB");
    expect(decode).not.toHaveBeenCalled();
    decode.mockRestore();
  });

  it("names the source of an AlphaFold DB model and of an AlphaFold Server one", () => {
    server.use(http.get("*/api/v1/protein_structure/structure/*", () => new Promise(() => {})));
    show(b64(SPEC));
    expect(screen.getByTestId("structure-footer")).toHaveTextContent(
      /Predicted structure from the AlphaFold Protein Structure Database, © DeepMind Technologies Limited, CC-BY 4\.0\./,
    );
    expect(screen.getByTestId("structure-footer")).not.toHaveTextContent(/Jumper|Nature/);
    cleanup();
    show(b64({ ...SPEC, model_file_id: "AF3-TEST-F1-model_v6" }));
    expect(screen.getByTestId("structure-footer")).toHaveTextContent(
      "Predicted structure: AF3 (AlphaFold Server, generated by the Finucane lab).",
    );
  });

  it.each([
    ["an invalid spec", () => b64({ ...SPEC, model_file_id: undefined }), undefined],
    ["text that is not JSON", () => b64("not json"), undefined],
    ["a newer version", () => b64({ ...SPEC, version: 99 }), undefined],
    ["a missing model", () => b64(SPEC), 404],
    ["no release", () => b64(SPEC), 503],
  ])("offers the spec as a download for %s", async (_what, data, status) => {
    if (status) {
      server.use(http.get(ROUTE, () => HttpResponse.json({ detail: "x" }, { status })));
    }
    show(data());
    if (status) await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Download the view spec" }));
    expect(downloadBlob).toHaveBeenLastCalledWith(expect.any(Uint8Array), "gene1.structure-view.json", "application/json");
  });

  it("offers the spec as a download beside a drawn structure and with no WebGL", async () => {
    server.use(http.get(ROUTE, () => HttpResponse.text("ATOM      1")));
    const { WebGLUnavailableError } = await import("./molstarScene");
    createScene.mockRejectedValueOnce(new WebGLUnavailableError("no context"));
    show(b64(SPEC));
    await screen.findByText(/could not start WebGL/);
    expect(screen.getByRole("button", { name: "Download the view spec" })).toBeInTheDocument();
  });

  it("offers the model and a PyMOL script once the model has arrived, and says what the script adds", async () => {
    server.use(http.get(ROUTE, () => HttpResponse.text("ATOM      1")));
    createScene.mockResolvedValueOnce({ ...READY, dispose: vi.fn() });
    show(b64(SPEC));
    fireEvent.click(await screen.findByRole("button", { name: "Download the model (PDB)" }));
    expect(downloadBlob).toHaveBeenLastCalledWith("ATOM      1", "AF-TEST-F1-model_v6.pdb", "chemical/x-pdb");
    fireEvent.click(screen.getByRole("button", { name: "Download the PyMOL script (.pml)" }));
    expect(downloadBlob).toHaveBeenLastCalledWith(
      expect.stringContaining("load AF-TEST-F1-model_v6.pdb, structure\n"),
      "AF-TEST-F1-model_v6.pml",
      "text/plain",
    );
    expect(screen.getByTestId("structure-footer")).toHaveTextContent(
      /the \.pml script, saved beside it and opened in PyMOL, adds this view's colouring, highlighted residues and labels/,
    );
  });

  it("offers neither where the model is missing", async () => {
    server.use(http.get(ROUTE, () => new HttpResponse(null, { status: 404 })));
    show(b64(SPEC));
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Download the model (PDB)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download the PyMOL script (.pml)" })).toBeNull();
  });

  it("explains a browser with no WebGL", async () => {
    server.use(http.get(ROUTE, () => HttpResponse.text("ATOM      1")));
    const { WebGLUnavailableError } = await import("./molstarScene");
    createScene.mockRejectedValueOnce(new WebGLUnavailableError("no context"));
    show(b64(SPEC));
    expect(await screen.findByText(/could not start WebGL/)).toBeInTheDocument();
  });

  it("gives the chat's scene no residue callback and no live selection", async () => {
    server.use(http.get(ROUTE, () => HttpResponse.text("ATOM      1")));
    const setLive = vi.fn();
    createScene.mockResolvedValueOnce({ ...READY, setLive, dispose: vi.fn() });
    show(b64(SPEC));
    await screen.findByTestId("structure-legend");
    expect(Object.keys(createScene.mock.lastCall?.[3]).sort()).toEqual(["onContextLost", "onEmphasisEnd", "onHover"]);
    expect(setLive).not.toHaveBeenCalled();
    expect(screen.getByTestId("structure-canvas")).not.toHaveAttribute("data-live");
  });

  describe("linked to a host page", () => {
    const HOST_SPEC: ViewSpec = {
      version: 1,
      modelFileId: "AF-TEST-F1-model_v6",
      gene: "GENE1",
      residues: [],
      regions: [],
      colourMode: "plddt",
      omitted: { residues: 0, regions: 0 },
    };
    const host = (props: Partial<Parameters<typeof StructureView>[0]>) => (
      <QueryClientProvider client={client}>
        <StructureView spec={HOST_SPEC} {...props} />
      </QueryClientProvider>
    );
    const client = new QueryClient();

    it("updates the live selection on the running scene instead of building another", async () => {
      server.use(http.get(ROUTE, () => HttpResponse.text("ATOM      1")));
      const setLive = vi.fn(async (positions: number[]) => {
        const held = positions.filter((p) => p < 100);
        return { positions: held, drawn: held.length > 50 ? "cartoon" : held.length > 0 ? "atoms" : "none" };
      });
      createScene.mockResolvedValueOnce({ ...READY, highlighted: [], setLive, dispose: vi.fn() });
      const built = createScene.mock.calls.length;
      const view = render(host({ live: { positions: [], focus: false }, onResidue: vi.fn() }));
      await screen.findByTestId("structure-legend");
      expect(setLive).toHaveBeenLastCalledWith([], false);

      view.rerender(host({ live: { positions: [43, 900], focus: true }, onResidue: vi.fn() }));
      await vi.waitFor(() =>
        expect(screen.getByTestId("structure-canvas")).toHaveAttribute("data-live", "43"),
      );
      expect(setLive).toHaveBeenLastCalledWith([43, 900], true);
      expect(screen.getByTestId("structure-canvas")).toHaveAttribute("data-live-drawn", "atoms");

      // a long selection is summarised, not listed, and the legend says how it is shown
      const range = Array.from({ length: 60 }, (_, i) => i + 10);
      view.rerender(host({ live: { positions: range, focus: true }, onResidue: vi.fn() }));
      await vi.waitFor(() =>
        expect(screen.getByTestId("structure-canvas")).toHaveAttribute("data-live", "60 residues 10-69"),
      );
      expect(screen.getByTestId("structure-canvas")).toHaveAttribute("data-live-drawn", "cartoon");
      expect(screen.getByTestId("structure-legend")).toHaveTextContent(
        "the 60 selected residues are shown by colouring the cartoon; a selection of up to 50 residues is drawn as atoms",
      );
      expect(createScene.mock.calls.length).toBe(built + 1);
      expect(screen.getByTestId("structure-footer")).not.toHaveTextContent("Download the view spec");
    });

    it("passes residue hovers and clicks to the host's current handler", async () => {
      server.use(http.get(ROUTE, () => HttpResponse.text("ATOM      1")));
      createScene.mockResolvedValueOnce({ ...READY, setLive: vi.fn(async () => ({ positions: [], drawn: "none" })), dispose: vi.fn() });
      const first = vi.fn();
      const second = vi.fn();
      const built = createScene.mock.calls.length;
      const view = render(host({ onResidue: first }));
      await screen.findByTestId("structure-legend");
      view.rerender(host({ onResidue: second }));
      const events = createScene.mock.lastCall?.[3];
      act(() => events.onResidue("click", 43));
      act(() => events.onResidue("hover", null));
      expect(first).not.toHaveBeenCalled();
      expect(second.mock.calls).toEqual([
        ["click", 43],
        ["hover", null],
      ]);
      expect(createScene.mock.calls.length).toBe(built + 1);
    });
  });
});
