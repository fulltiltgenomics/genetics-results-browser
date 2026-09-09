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

async function startTurn(projectId?: string | null) {
  render(<LLMChat projectId={projectId} />);
  const textbox = screen.getByRole("textbox");
  fireEvent.change(textbox, { target: { value: "what did we discuss last time?" } });
  fireEvent.submit(textbox.closest("form")!);
  await waitFor(() => expect(emit).toBeDefined());
}

const CHIP_TEXT = "Used IBD memory";

describe("LLMChat memory chip", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    emit = undefined;
    finish = undefined;
  });

  it("renders with the project's name and opens the memory dialog for that project", async () => {
    await startTurn("proj-1");

    await act(async () => {
      emit!({ type: "memory", project: "IBD", sessions: 2, chars: 340 });
    });
    await act(async () => {
      emit!({ type: "content", content: "Last time you asked about APOE." });
    });

    const chip = screen.getByText(CHIP_TEXT);
    expect(chip).toBeTruthy();

    fireEvent.click(chip);
    // MemoryDialog is a SideSheet titled "Memory" — opening it does not depend on the
    // fetch it kicks off resolving
    expect(await screen.findByText("Memory")).toBeTruthy();

    await act(async () => {
      emit!({ type: "done", message_content: [{ type: "text", text: "x" }] });
      finish!();
    });
  });

  it("is absent from a turn with no memory event", async () => {
    await startTurn("proj-1");

    await act(async () => {
      emit!({ type: "content", content: "Hello there." });
      emit!({ type: "done", message_content: [{ type: "text", text: "Hello there." }] });
      finish!();
    });

    await waitFor(() => expect(screen.getByText(/Hello there/)).toBeTruthy());
    expect(screen.queryByText(CHIP_TEXT)).toBeNull();
  });

  it("never appears without a projectId, even if a memory event somehow arrives", async () => {
    await startTurn(undefined);

    await act(async () => {
      emit!({ type: "memory", project: "IBD", sessions: 2, chars: 340 });
      emit!({ type: "content", content: "Hello there." });
      emit!({ type: "done", message_content: [{ type: "text", text: "Hello there." }] });
      finish!();
    });

    await waitFor(() => expect(screen.getByText(/Hello there/)).toBeTruthy());
    expect(screen.queryByText(CHIP_TEXT)).toBeNull();
    expect(screen.queryByText(/Using your recent conversations/)).toBeNull();
  });

  it("disappears if the session becomes unfiled after the memory event set usedMemory", async () => {
    const { rerender } = render(<LLMChat projectId="proj-1" />);
    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "what did we discuss last time?" } });
    fireEvent.submit(textbox.closest("form")!);
    await waitFor(() => expect(emit).toBeDefined());

    await act(async () => {
      emit!({ type: "memory", project: "IBD", sessions: 2, chars: 340 });
      emit!({ type: "content", content: "Last time you asked about APOE." });
      emit!({ type: "done", message_content: [{ type: "text", text: "x" }] });
      finish!();
    });

    expect(await screen.findByText(CHIP_TEXT)).toBeTruthy();

    rerender(<LLMChat projectId={null} />);

    expect(screen.queryByText(CHIP_TEXT)).toBeNull();
  });

  it("ignores an unknown SSE event type without error", async () => {
    await startTurn("proj-1");

    await act(async () => {
      emit!({ type: "some_future_event", payload: "unhandled" });
      emit!({ type: "content", content: "still works" });
      emit!({ type: "done", message_content: [{ type: "text", text: "still works" }] });
      finish!();
    });

    await waitFor(() => expect(screen.getByText(/still works/)).toBeTruthy());
    expect(screen.queryByText(CHIP_TEXT)).toBeNull();
  });
});
