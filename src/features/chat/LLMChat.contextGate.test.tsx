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

// the transcript view mounts its own form once messages exist, so the textbox is re-queried
// rather than held from the empty state
const submit = (text: string) => {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
};

const usage = (percent: number) => ({
  type: "usage",
  iteration: 1,
  input_tokens: percent * 10_000,
  output_tokens: 10,
  total_input_tokens: 100,
  total_output_tokens: 10,
  context_window: 1_000_000,
  context_percent: percent,
});

async function completeTurn(percent: number) {
  await act(async () => {
    emit!(usage(percent));
    emit!({ type: "done", message_content: [{ type: "text", text: "x" }] });
    finish!();
  });
}

describe("LLMChat context gate", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    emit = undefined;
    finish = undefined;
  });

  it("says nothing while the conversation is small", async () => {
    render(<LLMChat />);
    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "q" } });
    fireEvent.submit(textbox.closest("form")!);
    await waitFor(() => expect(emit).toBeDefined());
    await completeTurn(30);

    expect(screen.queryByText(/context window/)).toBeNull();
  });

  it("advises a new chat past half the window, saying why, and still sends", async () => {
    const onNewChat = vi.fn();
    render(<LLMChat onNewChat={onNewChat} />);
    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "q" } });
    fireEvent.submit(textbox.closest("form")!);
    await waitFor(() => expect(emit).toBeDefined());
    await completeTurn(52);

    expect(screen.getByText(/used 52% of the model's context window/)).toBeTruthy();
    expect(screen.getByText(/slower, costlier and less accurate/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start a new chat" }));
    expect(onNewChat).toHaveBeenCalledTimes(1);

    // advice, not a stop: the next message goes out
    await waitFor(() => expect(screen.getByRole("textbox")).not.toBeDisabled());
    emit = undefined;
    submit("one more");
    await waitFor(() => expect(emit).toBeDefined());
    await completeTurn(60);
  });

  it("refuses to send past 90% and says the model may refuse too", async () => {
    render(<LLMChat onNewChat={() => undefined} />);
    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "q" } });
    fireEvent.submit(textbox.closest("form")!);
    await waitFor(() => expect(emit).toBeDefined());
    await completeTurn(91);

    expect(screen.getByText(/reached 91% of the model's context window/)).toBeTruthy();
    expect(screen.getByText(/may refuse the request outright/)).toBeTruthy();

    await waitFor(() => expect(screen.getByRole("textbox")).not.toBeDisabled());
    emit = undefined;
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "one more" } });
    expect((screen.getByRole("button", { name: "" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(emit).toBeUndefined();
  });

  it("takes the newest reading, so a conversation the server trimmed can fall back under the line", async () => {
    render(<LLMChat />);
    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "q" } });
    fireEvent.submit(textbox.closest("form")!);
    await waitFor(() => expect(emit).toBeDefined());
    await completeTurn(55);
    expect(screen.getByText(/used 55%/)).toBeTruthy();

    await waitFor(() => expect(screen.getByRole("textbox")).not.toBeDisabled());
    emit = undefined;
    submit("again");
    await waitFor(() => expect(emit).toBeDefined());
    await completeTurn(35);
    expect(screen.queryByText(/context window/)).toBeNull();
  });
});
