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

import StructureViewer from "./StructureViewer";

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
      labelsDrawn: 1,
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
    labelsDrawn: 1,
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
    expect(legend).toHaveTextContent("only the first 40 of 2000 labels are drawn");
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
      /Predicted structure from the AlphaFold Protein Structure Database.*CC-BY 4\.0.*Jumper et al/,
    );
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

  it("explains a browser with no WebGL", async () => {
    server.use(http.get(ROUTE, () => HttpResponse.text("ATOM      1")));
    const { WebGLUnavailableError } = await import("./molstarScene");
    createScene.mockRejectedValueOnce(new WebGLUnavailableError("no context"));
    show(b64(SPEC));
    expect(await screen.findByText(/could not start WebGL/)).toBeInTheDocument();
  });
});
