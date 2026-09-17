import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";

vi.mock("./schemaApi", () => ({
  useSchema: () => ({ data: undefined }),
}));

/**
 * The turn is the server's: `POST /chat/v1/chat` only subscribes to it, and a connection
 * that ends without `done` is a lost connection, not a finished answer. The mock records
 * every request and lets each test script what the server answers.
 */
interface Call {
  url: string;
  method: string;
  body: any;
}
let calls: Call[];
let script: ((call: Call, opts: any) => Promise<void>) | undefined;

vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: vi.fn(async (url: string, opts: any) => {
    const call = { url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null };
    calls.push(call);
    await script!(call, opts);
  }),
}));

import { LLMChat } from "./LLMChat";

const open = async (opts: any) =>
  opts.onopen({ ok: true, headers: { get: () => "text/event-stream" } });
const emit = (opts: any, seq: number, data: unknown) =>
  opts.onmessage({ id: String(seq), data: JSON.stringify(data) });
const DONE = { type: "done", message_content: [{ type: "text", text: "x" }], tool_results: null };

function send(text: string) {
  const textbox = screen.getByRole("textbox");
  fireEvent.change(textbox, { target: { value: text } });
  fireEvent.submit(textbox.closest("form")!);
}

describe("server-owned turns", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    calls = [];
    script = undefined;
  });

  it("reattaches from the last sequence number when the stream drops before `done`", async () => {
    script = async (call, opts) => {
      await open(opts);
      if (call.method === "POST") {
        emit(opts, 0, { type: "content", content: "first " });
        emit(opts, 1, { type: "content", content: "half" });
        return; // the connection went away here
      }
      emit(opts, 2, { type: "content", content: ", second half" });
      emit(opts, 3, DONE);
    };
    const onStreamingComplete = vi.fn();
    render(<LLMChat sessionId="s1" onStreamingComplete={onStreamingComplete} />);

    send("go");

    await waitFor(() => expect(onStreamingComplete).toHaveBeenCalled());
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
    const messageId = calls[0].body.message_id;
    expect(calls[1].url).toContain(`/v1/chat/turns/${messageId}/events?from_seq=2`);
    const assistantMsg = onStreamingComplete.mock.calls[0][1];
    expect(assistantMsg.content).toBe("first half, second half");
    expect(assistantMsg.content).not.toContain("incomplete");
    expect(screen.queryByText(/incomplete/)).toBeNull();
  });

  it("reattaches when the connection fails mid-stream with a thrown network error", async () => {
    // what a laptop waking up looks like: fetch rejects the in-flight read with a TypeError
    script = async (call, opts) => {
      await open(opts);
      if (call.method === "POST") {
        emit(opts, 0, { type: "tool_use", id: "tu1", name: "search_genes", input: { query: "APOE" } });
        throw new TypeError("network error");
      }
      emit(opts, 1, { type: "content", content: "APOE is" });
      emit(opts, 2, DONE);
    };
    const onStreamingComplete = vi.fn();
    render(<LLMChat sessionId="s1" onStreamingComplete={onStreamingComplete} />);

    send("Tell me about APOE");

    await waitFor(() => expect(onStreamingComplete).toHaveBeenCalled());
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
    expect(calls[1].url).toContain("from_seq=1");
    expect(onStreamingComplete.mock.calls[0][1].content).toContain("APOE is");
    expect(screen.getByText("Tell me about APOE")).toBeTruthy();
    expect(screen.queryByText(/network error/)).toBeNull();
  });

  it("keeps a saved question on screen when the request never reached the server", async () => {
    script = async (call, opts) => {
      if (call.method === "POST") throw new TypeError("network error");
      await opts.onopen({ ok: false, status: 404, type: "default", headers: { get: () => "application/json" } });
    };
    const onUserMessage = vi.fn(async () => {});
    render(<LLMChat sessionId="s1" onUserMessage={onUserMessage} />);

    send("a question");

    await waitFor(() => expect(screen.getByText(/Could not reach the server/)).toBeTruthy());
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
    expect(screen.getByText("a question")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("attaches to a turn that was already running when the session was opened", async () => {
    script = async (_call, opts) => {
      await open(opts);
      emit(opts, 0, { type: "content", content: "while you were away" });
      emit(opts, 1, DONE);
    };
    const onStreamingComplete = vi.fn();
    render(
      <LLMChat
        sessionId="s1"
        initialMessages={[{ id: "u1", role: "user", content: "the question" }]}
        activeTurn={{ messageId: "t-running" }}
        onStreamingComplete={onStreamingComplete}
      />,
    );

    await waitFor(() => expect(screen.getByText(/while you were away/)).toBeTruthy());
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("/v1/chat/turns/t-running/events?from_seq=0");
    await waitFor(() => expect(onStreamingComplete).toHaveBeenCalled());
    const [userMsg, assistantMsg] = onStreamingComplete.mock.calls[0];
    expect(userMsg.id).toBe("u1");
    expect(assistantMsg.id).toBe("t-running");
    await waitFor(() => expect(screen.getByRole("textbox")).not.toBeDisabled());
  });

  it("does not attach when history already holds the turn's message", async () => {
    script = async () => {
      throw new Error("no request expected");
    };
    render(
      <LLMChat
        sessionId="s1"
        initialMessages={[
          { id: "u1", role: "user", content: "q" },
          { id: "t-done", role: "assistant", content: "a" },
        ]}
        activeTurn={{ messageId: "t-done" }}
      />,
    );
    await waitFor(() => expect(screen.getByRole("textbox")).not.toBeDisabled());
    expect(calls).toHaveLength(0);
  });

  it("hands over to the parent when the server no longer has the turn", async () => {
    script = async (_call, opts) => {
      await opts.onopen({ ok: false, status: 404, type: "default", headers: { get: () => "application/json" } });
    };
    const onResumeUnavailable = vi.fn();
    render(
      <LLMChat
        sessionId="s1"
        initialMessages={[{ id: "u1", role: "user", content: "q" }]}
        activeTurn={{ messageId: "t-gone" }}
        onResumeUnavailable={onResumeUnavailable}
      />,
    );
    await waitFor(() => expect(onResumeUnavailable).toHaveBeenCalledTimes(1));
  });

  it("treats a turn the server reports as cancelled as stopped, not as a lost connection", async () => {
    script = async (_call, opts) => {
      await open(opts);
      emit(opts, 0, { type: "content", content: "partial" });
      emit(opts, 1, { type: "cancelled" });
    };
    const onStreamingComplete = vi.fn();
    render(<LLMChat sessionId="s1" onStreamingComplete={onStreamingComplete} />);

    send("go");

    await waitFor(() => expect(onStreamingComplete).toHaveBeenCalled());
    expect(calls.map((c) => c.method)).toEqual(["POST"]);
    expect(onStreamingComplete.mock.calls[0][1].content).toBe("partial");
    // the continue button renders MUI's PlayArrow (imported as ContinueIcon)
    expect(screen.getByTestId("PlayArrowIcon")).toBeTruthy();
  });

  it("stops the turn server-side, since hanging up no longer does", async () => {
    const cancelled: string[] = [];
    server.use(
      http.post("*/v1/chat/turns/:id/cancel", ({ params }) => {
        cancelled.push(String(params.id));
        return HttpResponse.json({ cancelled: true });
      }),
    );
    script = async (_call, opts) => {
      await open(opts);
      emit(opts, 0, { type: "content", content: "partial" });
      await new Promise<void>((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    };
    render(<LLMChat sessionId="s1" />);

    send("go");
    await waitFor(() => expect(screen.getByText(/partial/)).toBeTruthy());
    fireEvent.click(screen.getByTestId("StopIcon").closest("button")!);

    await waitFor(() => expect(cancelled).toEqual([calls[0].body.message_id]));
    expect(screen.getByTestId("PlayArrowIcon")).toBeTruthy();
  });

  it("saves the user message before the request goes out", async () => {
    const order: string[] = [];
    script = async (_call, opts) => {
      order.push("stream");
      await open(opts);
      emit(opts, 0, DONE);
    };
    const onUserMessage = vi.fn(async (msg: any, sessionId: string | null) => {
      order.push(`save:${msg.role}:${sessionId}`);
    });
    render(<LLMChat sessionId="s1" onUserMessage={onUserMessage} />);

    send("go");

    await waitFor(() => expect(order).toHaveLength(2));
    expect(order).toEqual(["save:user:s1", "stream"]);
  });
});
