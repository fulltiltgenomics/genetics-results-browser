import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("./schemaApi", () => ({
  useSchema: () => ({ data: undefined }),
}));

let sentBody: any;
let emit: ((data: unknown) => void) | undefined;
let finish: (() => void) | undefined;

vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: vi.fn(async (_url: string, opts: any) => {
    sentBody = JSON.parse(opts.body);
    await opts.onopen({ ok: true, headers: { get: () => "text/event-stream" } });
    emit = (data: unknown) => opts.onmessage({ data: JSON.stringify(data) });
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  }),
}));

import { LLMChat } from "./LLMChat";

async function send(ui: React.ReactElement) {
  render(ui);
  const textbox = screen.getByRole("textbox");
  fireEvent.change(textbox, { target: { value: "draw a locus plot" } });
  fireEvent.submit(textbox.closest("form")!);
  await waitFor(() => expect(sentBody).toBeDefined());
}

/**
 * `session_id` is not only for persistence: chat-backend makes it the `sid` claim of the
 * per-execution sandbox credential, and `run_analysis` refuses a turn without one
 * (genetics-results-suite-vda). It has to be on the FIRST request, not created after the
 * exchange — which is what left every inline-started chat unable to run code on turn one.
 */
describe("the session id is resolved before the request", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    sentBody = undefined;
    emit = undefined;
    finish = undefined;
  });

  it("creates the session first and sends its id on the very first turn", async () => {
    const onEnsureSession = vi.fn(async () => "sess-created-first");
    await send(<LLMChat onEnsureSession={onEnsureSession} />);

    expect(onEnsureSession).toHaveBeenCalledTimes(1);
    expect(sentBody.session_id).toBe("sess-created-first");
  });

  it("does not create a second session when one already exists", async () => {
    const onEnsureSession = vi.fn(async () => "should-not-be-called");
    await send(<LLMChat sessionId="sess-existing" onEnsureSession={onEnsureSession} />);

    expect(onEnsureSession).not.toHaveBeenCalled();
    expect(sentBody.session_id).toBe("sess-existing");
  });

  it("still answers the turn when the session cannot be created", async () => {
    // every other tool works without a session; refusing the whole turn would be worse than
    // losing persistence for it
    const onEnsureSession = vi.fn(async () => {
      throw new Error("backend down");
    });
    await send(<LLMChat onEnsureSession={onEnsureSession} />);

    expect(sentBody.session_id).toBeNull();
    await act(async () => {
      emit!({ type: "content", content: "answered anyway" });
    });
    expect(screen.getByText(/answered anyway/)).toBeTruthy();
  });
});
