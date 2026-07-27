import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("./schemaApi", () => ({
  useSchema: () => ({ data: undefined }),
}));

// a stream the test drives event by event
let emit: ((data: unknown) => void) | undefined;
let finish: (() => void) | undefined;

vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: vi.fn(async (_url: string, opts: any) => {
    await opts.onopen({
      ok: true,
      headers: { get: () => "text/event-stream" },
    });
    emit = (data: unknown) => opts.onmessage({ data: JSON.stringify(data) });
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  }),
}));

import { LLMChat } from "./LLMChat";

describe("LLMChat thinking indicator", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    emit = undefined;
    finish = undefined;
  });

  it("reappears when the model goes back to reasoning mid-response", async () => {
    render(<LLMChat />);

    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "a hard question" } });
    fireEvent.submit(textbox.closest("form")!);

    await waitFor(() => expect(emit).toBeDefined());

    // first token clears the pre-response indicator
    await act(async () => {
      emit!({ type: "content", content: "partway through" });
    });
    expect(screen.getByText(/partway through/)).toBeTruthy();
    expect(screen.queryByText("Thinking...")).toBeNull();

    // the model starts reasoning again — this gap used to show nothing at all
    await act(async () => {
      emit!({ type: "thinking" });
    });
    expect(screen.getByText("Thinking...")).toBeTruthy();
    // the streamed text so far stays on screen alongside it
    expect(screen.getByText(/partway through/)).toBeTruthy();

    // and it clears again once tokens resume
    await act(async () => {
      emit!({ type: "content", content: " and done" });
    });
    expect(screen.queryByText("Thinking...")).toBeNull();

    await act(async () => {
      emit!({ type: "done", message_content: [{ type: "text", text: "x" }] });
      finish!();
    });
  });

  it("carries no reasoning text into the transcript", async () => {
    render(<LLMChat />);

    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "q" } });
    fireEvent.submit(textbox.closest("form")!);

    await waitFor(() => expect(emit).toBeDefined());

    await act(async () => {
      emit!({ type: "thinking", content: "internal reasoning" });
    });

    expect(screen.queryByText(/internal reasoning/)).toBeNull();

    await act(async () => {
      finish!();
    });
  });
});
