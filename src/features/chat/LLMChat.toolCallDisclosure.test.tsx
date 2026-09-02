import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("./schemaApi", () => ({
  useSchema: () => ({ data: undefined }),
}));

let emit: ((data: unknown) => void) | undefined;
let finish: (() => void) | undefined;

vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: vi.fn(async (_url: string, opts: any) => {
    await opts.onopen({ ok: true, headers: { get: () => "text/event-stream" } });
    emit = (data: unknown) => opts.onmessage({ data: JSON.stringify(data) });
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  }),
}));

import { LLMChat } from "./LLMChat";

const CODE = `from genetics_mcp_server import sdk as g
LEAD = "22:23828809:T:G"   # colons, brackets [ ] and newlines
ss = g.summary_stats(region="22:23578809-24078809")
print(ss.head())`;

async function startTurn() {
  render(<LLMChat />);
  const textbox = screen.getByRole("textbox");
  fireEvent.change(textbox, { target: { value: "draw a locus plot" } });
  fireEvent.submit(textbox.closest("form")!);
  await waitFor(() => expect(emit).toBeDefined());
}

describe("tool calls in the transcript", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    emit = undefined;
    finish = undefined;
  });

  it("collapses the call and expands to the WHOLE script", async () => {
    await startTurn();
    await act(async () => {
      emit!({ type: "tool_use", id: "ra-1", name: "run_analysis", input: { code: CODE } });
    });

    // collapsed: the tool is named and sized, and the script is not in the transcript
    expect(screen.getByText("run_analysis")).toBeTruthy();
    expect(screen.getByText(`${CODE.length.toLocaleString()} chars`)).toBeTruthy();
    expect(screen.queryByText(/summary_stats/)).toBeNull();

    fireEvent.click(screen.getByText("run_analysis"));

    // expanded: every line, untruncated — the thing the 400-char prose marker could not do
    const shown = await screen.findByText(/summary_stats/);
    expect(shown.textContent).toBe(CODE);
    expect(shown.textContent).not.toContain("chars total");
  });

  it("does not leak the marker's base64 into the transcript as prose", async () => {
    await startTurn();
    await act(async () => {
      emit!({ type: "content", content: "Let me run that.\n\n" });
      emit!({ type: "tool_use", id: "ra-1", name: "run_analysis", input: { code: CODE } });
      emit!({ type: "content", content: "\n\nThe lead variant is genome-wide significant." });
    });

    expect(screen.getByText(/Let me run that/)).toBeTruthy();
    expect(screen.getByText(/genome-wide significant/)).toBeTruthy();
    expect(screen.queryByText(/TOOLUSE/)).toBeNull();
  });

  it("attaches the outcome of the script to the call it belongs to", async () => {
    await startTurn();
    await act(async () => {
      emit!({ type: "tool_use", id: "ra-1", name: "run_analysis", input: { code: "print(1)" } });
      emit!({ type: "tool_use", id: "ra-2", name: "run_analysis", input: { code: "print(2)" } });
      emit!({
        type: "script_result",
        tool_use_id: "ra-2",
        ran: true,
        ok: false,
        status: "error",
        exception: "ValueError",
        duration_ms: 4200,
      });
    });

    // only the second call carries an outcome; the first is still just a call
    expect(screen.getByText("ValueError · 4.2s")).toBeTruthy();
    expect(screen.getAllByText("run_analysis")).toHaveLength(2);
  });

  it("renders an image whose artifact name contains the marker's delimiter", async () => {
    await startTurn();
    const data = "aW1hZ2U=".repeat(20);
    await act(async () => {
      emit!({
        type: "image",
        image_data: data,
        image_format: "png",
        image_alt: "locus:22:23828809.png",
      });
    });

    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe(`data:image/png;base64,${data}`);
    // the colons were replaced rather than splitting the marker and spilling base64 as text
    expect(screen.queryByText(/IMAGE:/)).toBeNull();
    expect(img.alt).not.toContain(":");
  });

  it("shows a plot as a figure and not as a link", async () => {
    await startTurn();
    await act(async () => {
      emit!({
        type: "image",
        image_data: "aW1hZ2U=".repeat(20),
        image_format: "png",
        image_alt: "locuszoom.png",
      });
    });

    const img = screen.getByRole("img");
    // the src is a data: URL and a browser refuses one as a top-level navigation, so the
    // click handler this replaces opened a blank tab every time. The affordances that
    // promised it go with it, or the plot still reads as something to click.
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    fireEvent.click(img);
    expect(opened).not.toHaveBeenCalled();
    expect(img.closest("a")).toBeNull();
    expect(img.getAttribute("title")).toBeNull();
    expect((img as HTMLImageElement).style.cursor).toBe("");
    opened.mockRestore();
  });
});
