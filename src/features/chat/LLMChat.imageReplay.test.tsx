import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("./schemaApi", () => ({
  useSchema: () => ({ data: undefined }),
}));

Element.prototype.scrollIntoView = vi.fn();

// a plot's worth of base64: big enough that resending it is what exhausts the context
const PLOT_BASE64 = "iVBORw0KGgo=".repeat(400);

const sentBodies: any[] = [];
// a turn that is stopped, or whose connection drops, never delivers `done` — and so never
// delivers the image-free content_json either
let sendDone = true;
vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: vi.fn(async (_url: string, init: any) => {
    sentBodies.push(JSON.parse(init.body));
    await init.onopen({ ok: true, headers: { get: () => "text/event-stream" } });
    init.onmessage({ data: JSON.stringify({ type: "content", content: "Here is the plot." }) });
    init.onmessage({
      data: JSON.stringify({
        type: "image",
        image_data: PLOT_BASE64,
        image_format: "png",
        image_alt: "locuszoom.png",
      }),
    });
    if (sendDone) {
      init.onmessage({
        data: JSON.stringify({
          type: "done",
          message_content: [{ type: "text", text: "Here is the plot." }],
          tool_results: [{ type: "tool_result", tool_use_id: "ra-1", content: '{"ok": true}' }],
        }),
      });
    }
    init.onclose?.();
  }),
}));

import { LLMChat } from "./LLMChat";

const submit = (text: string) => {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
};

describe("LLMChat generated-image replay", () => {
  beforeEach(() => {
    sentBodies.length = 0;
    sendDone = true;
  });

  // regression: contentJson was attached only to the copy handed to the save path, so the
  // live transcript replayed `content` — whose [IMAGE:...] marker carries the whole plot as
  // base64. That cost ~180k tokens per plotted turn and hit the model's context limit in
  // six turns; a reloaded session was fine, because it comes back with contentJson set.
  it("does not resend a generated plot's base64 on the next turn", async () => {
    render(<LLMChat />);

    submit("draw a locus plot");
    await waitFor(() => expect(sentBodies).toHaveLength(1));

    submit("now zoom in");
    await waitFor(() => expect(sentBodies).toHaveLength(2));

    const replay = JSON.stringify(sentBodies[1].messages);
    expect(replay).not.toContain(PLOT_BASE64.slice(0, 200));
    expect(replay).not.toContain("[IMAGE:");
    // the turn itself still replays: its prose, its tool results, and the new question
    expect(replay).toContain("Here is the plot.");
    expect(replay).toContain("ra-1");
    expect(replay).toContain("now zoom in");
  });

  it("keeps the plot in the transcript the user sees", async () => {
    render(<LLMChat />);

    submit("draw a locus plot");
    await waitFor(() => expect(sentBodies).toHaveLength(1));

    const img = (await screen.findByRole("img")) as HTMLImageElement;
    expect(img.src).toBe(`data:image/png;base64,${PLOT_BASE64}`);
  });
  // the turn that opened the failing session ended this way: its content was stored
  // truncated mid-sentence with content_json NULL, so it replayed as base64 from then on
  it("does not resend the base64 of a turn that never delivered `done`", async () => {
    sendDone = false;
    render(<LLMChat />);

    submit("draw a locus plot");
    await waitFor(() => expect(sentBodies).toHaveLength(1));

    sendDone = true;
    submit("now zoom in");
    await waitFor(() => expect(sentBodies).toHaveLength(2));

    const replay = JSON.stringify(sentBodies[1].messages);
    expect(replay).not.toContain(PLOT_BASE64.slice(0, 200));
    expect(replay).not.toContain("[IMAGE:");
    // the turn is still replayed — its prose and the fact that a plot was shown
    expect(replay).toContain("Here is the plot.");
    expect(replay).toContain("image shown to the user: locuszoom.png");
  });
});
