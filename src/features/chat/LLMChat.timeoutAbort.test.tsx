import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("./schemaApi", () => ({
  useSchema: () => ({ data: undefined }),
}));

// stand in for the SSE transport: open, emit one content chunk, then hang until the
// component's inactivity timer aborts us — which is exactly the shape of a server
// that goes quiet mid-response.
vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: vi.fn(async (_url: string, opts: any) => {
    await opts.onopen({
      ok: true,
      headers: { get: () => "text/event-stream" },
    });
    opts.onmessage({
      data: JSON.stringify({ type: "content", content: "partial answer" }),
    });
    await new Promise((_resolve, reject) => {
      opts.signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  }),
}));

import { LLMChat } from "./LLMChat";

const INACTIVITY_MS = 90_000;

function send(text: string) {
  const textbox = screen.getByRole("textbox");
  fireEvent.change(textbox, { target: { value: text } });
  fireEvent.submit(textbox.closest("form")!);
}

describe("LLMChat inactivity-timeout abort", () => {
  beforeEach(() => {
    // jsdom has no layout, and rendering messages triggers the autoscroll effect
    Element.prototype.scrollIntoView = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists the partial response and offers to continue", async () => {
    const onStreamingComplete = vi.fn();
    render(<LLMChat onStreamingComplete={onStreamingComplete} />);

    send("why does this truncate?");

    // let the stream open and deliver its one chunk
    await waitFor(() => expect(screen.getByText(/partial answer/)).toBeTruthy());

    await vi.advanceTimersByTimeAsync(INACTIVITY_MS + 1_000);

    // the partial has to be handed to the persistence callback, or it is lost on reload
    await waitFor(() => expect(onStreamingComplete).toHaveBeenCalled());
    const assistantMsg = onStreamingComplete.mock.calls[0][1];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toContain("partial answer");

    // and the turn is resumable, the same as a manually stopped one
    await waitFor(() =>
      expect(screen.getByText(/Server stopped responding/)).toBeTruthy()
    );
    // the continue button renders MUI's PlayArrow (imported as ContinueIcon)
    expect(screen.getByTestId("PlayArrowIcon")).toBeTruthy();
  });
});
