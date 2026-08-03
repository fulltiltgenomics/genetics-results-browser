import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("./schemaApi", () => ({
  useSchema: () => ({ data: undefined }),
}));

// jsdom doesn't implement scrollIntoView, which the autoscroll effect calls on every render
Element.prototype.scrollIntoView = vi.fn();

// jsdom's Blob has no text(); without it every data file reads as "(failed to read)"
if (!Blob.prototype.text) {
  Blob.prototype.text = function (this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(this);
    });
  };
}

// capture what actually goes to /v1/chat and drive a minimal stream to completion
const sentBodies: any[] = [];
vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: vi.fn(async (_url: string, init: any) => {
    sentBodies.push(JSON.parse(init.body));
    await init.onopen({
      ok: true,
      headers: { get: () => "text/event-stream" },
    });
    init.onmessage({ data: JSON.stringify({ type: "content", content: "ok" }) });
    init.onmessage({ data: JSON.stringify({ type: "done" }) });
    init.onclose?.();
  }),
}));

import { LLMChat } from "./LLMChat";
import type { PendingAttachment } from "./chat.types";

const TSV_CONTENT = "variant\tpip\n1:100673223:G:A\t0.91\n";

const makeTsvAttachment = (): PendingAttachment => ({
  id: crypto.randomUUID(),
  name: "variants.tsv",
  size: TSV_CONTENT.length,
  type: "tsv",
  mimeType: "text/tab-separated-values",
  status: "pending",
  file: new File([TSV_CONTENT], "variants.tsv", { type: "text/tab-separated-values" }),
});

const bodyText = (body: any) => JSON.stringify(body.messages);

const submit = () => {
  const form = screen.getByRole("textbox").closest("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form!);
};

describe("LLMChat data-file attachment replay", () => {
  beforeEach(() => {
    sentBodies.length = 0;
  });

  it("inlines the file contents on the turn that sends it", async () => {
    render(<LLMChat initialAttachments={[makeTsvAttachment()]} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "what are these?" } });
    submit();

    await waitFor(() => expect(sentBodies).toHaveLength(1));
    expect(bodyText(sentBodies[0])).toContain("[File: variants.tsv]");
    expect(bodyText(sentBodies[0])).toContain("1:100673223:G:A");
  });

  // regression: replaying only image blocks dropped an attached TSV from every turn
  // after the first, so follow-up questions were answered without the data
  it("replays the file contents on the following turn", async () => {
    render(<LLMChat initialAttachments={[makeTsvAttachment()]} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "what are these?" } });
    submit();
    await waitFor(() => expect(sentBodies).toHaveLength(1));

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "any in FinnGen?" } });
    submit();
    await waitFor(() => expect(sentBodies).toHaveLength(2));

    const replay = bodyText(sentBodies[1]);
    expect(replay).toContain("any in FinnGen?");
    expect(replay).toContain("[File: variants.tsv]");
    expect(replay).toContain("1:100673223:G:A");
  });
});
