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
import type { ChatMessage, FileAttachment, PendingAttachment } from "./chat.types";
import { FILE_PREVIEW_MAX_BYTES, MAX_FILE_BLOCK_BYTES, fileReferenceBlock } from "./fileReference";

const TSV_CONTENT = "variant\tpip\n1:100673223:G:A\t0.91\n";

const makeTsvAttachment = (content = TSV_CONTENT): PendingAttachment => ({
  id: crypto.randomUUID(),
  name: "variants.tsv",
  size: content.length,
  type: "tsv",
  mimeType: "text/tab-separated-values",
  status: "pending",
  file: new File([content], "variants.tsv", { type: "text/tab-separated-values" }),
});

// what ChatPage's save resolves to: the same attachments with the ids the upload returned
const uploadingOnUserMessage = () =>
  vi.fn(async (msg: ChatMessage) =>
    (msg.attachments ?? []).map((a): FileAttachment => ({ ...a, serverId: "att-123", status: "uploaded" })),
  );

const bodyText = (body: any) => JSON.stringify(body.messages);

// every "[File: ..." text block in a request, wherever it sits
const fileBlocks = (body: any): string[] =>
  body.messages.flatMap((m: any) =>
    typeof m.content === "string"
      ? m.content.startsWith("[File: ") ? [m.content] : []
      : m.content
          .filter((b: any) => b.type === "text" && b.text.startsWith("[File: "))
          .map((b: any) => b.text),
  );

const utf8Bytes = (s: string) => new Blob([s]).size;

const submit = () => {
  const form = screen.getByRole("textbox").closest("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form!);
};

describe("LLMChat data-file attachment replay", () => {
  beforeEach(() => {
    sentBodies.length = 0;
  });

  it("sends a reference with the uploaded id and a preview on the turn that sends it", async () => {
    render(
      <LLMChat sessionId="s1" onUserMessage={uploadingOnUserMessage()} initialAttachments={[makeTsvAttachment()]} />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "what are these?" } });
    submit();

    await waitFor(() => expect(sentBodies).toHaveLength(1));
    const [block] = fileBlocks(sentBodies[0]);
    expect(block.split("\n")[0]).toBe(
      `[File: variants.tsv] attachment_id=att-123 size=${TSV_CONTENT.length} type=text/tab-separated-values`,
    );
    expect(block).toContain("1:100673223:G:A");
  });

  it("says the upload failed when an upload was attempted and returned no server id", async () => {
    const failingOnUserMessage = vi.fn(async (msg: ChatMessage) => msg.attachments ?? []);
    render(<LLMChat sessionId="s1" onUserMessage={failingOnUserMessage} initialAttachments={[makeTsvAttachment()]} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "what are these?" } });
    submit();

    await waitFor(() => expect(sentBodies).toHaveLength(1));
    expect(fileBlocks(sentBodies[0])[0].split("\n")[0]).toBe(
      "[File: variants.tsv] upload failed - ask the user to re-upload",
    );
  });

  // asking for a re-upload where nothing is ever uploaded would loop forever
  it.each([
    ["a view with no saver", {}],
    ["a secret chat", { sessionId: "s1", isSecretChat: true, onUserMessage: vi.fn(async () => undefined) }],
  ])("says the file is not kept in %s", async (_, props) => {
    render(<LLMChat {...props} initialAttachments={[makeTsvAttachment()]} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "what are these?" } });
    submit();

    await waitFor(() => expect(sentBodies).toHaveLength(1));
    const [block] = fileBlocks(sentBodies[0]);
    expect(block.split("\n")[0]).toBe(
      "[File: variants.tsv] not uploaded (this chat does not keep files) - only the preview below is available",
    );
    expect(block).toContain("1:100673223:G:A");
  });

  // the backend's per-block gate skips string content, so a file-only turn must stay a list
  it("sends a file-only message as list content", async () => {
    render(
      <LLMChat sessionId="s1" onUserMessage={uploadingOnUserMessage()} initialAttachments={[makeTsvAttachment()]} />,
    );

    submit();

    await waitFor(() => expect(sentBodies).toHaveLength(1));
    const last = sentBodies[0].messages.at(-1);
    expect(Array.isArray(last.content)).toBe(true);
    expect(last.content[0].text.startsWith("[File: variants.tsv] attachment_id=att-123")).toBe(true);
  });

  it("labels a CSV with an empty MIME type as text, not binary", async () => {
    const csv = { ...makeTsvAttachment("a,b\n1,2\n"), name: "variants.csv", mimeType: "" };
    render(<LLMChat sessionId="s1" onUserMessage={uploadingOnUserMessage()} initialAttachments={[csv]} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "what?" } });
    submit();

    await waitFor(() => expect(sentBodies).toHaveLength(1));
    expect(fileBlocks(sentBodies[0])[0].split("\n")[0]).toMatch(/ type=text\/csv$/);
  });

  // regression: replaying only image blocks dropped an attached TSV from every turn
  // after the first, so follow-up questions were answered without the data
  it("replays the same reference on the following turn", async () => {
    render(
      <LLMChat sessionId="s1" onUserMessage={uploadingOnUserMessage()} initialAttachments={[makeTsvAttachment()]} />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "what are these?" } });
    submit();
    await waitFor(() => expect(sentBodies).toHaveLength(1));

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "any in FinnGen?" } });
    submit();
    await waitFor(() => expect(sentBodies).toHaveLength(2));

    const replay = bodyText(sentBodies[1]);
    expect(replay).toContain("any in FinnGen?");
    expect(fileBlocks(sentBodies[1])).toEqual(fileBlocks(sentBodies[0]));
  });

  it("sends a 5 MB TSV as a block under the backend's cap", async () => {
    const row = "1:100673223:G:A\t0.91\tsome-gene\t\u00e9\u4e2d\n";
    const big = "variant\tpip\tgene\tnote\n" + row.repeat(Math.ceil((5 * 1024 * 1024) / row.length));
    render(<LLMChat initialAttachments={[makeTsvAttachment(big)]} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "summarise" } });
    submit();

    await waitFor(() => expect(sentBodies).toHaveLength(1));
    const [block] = fileBlocks(sentBodies[0]);
    expect(utf8Bytes(block)).toBeLessThanOrEqual(MAX_FILE_BLOCK_BYTES);
    // header plus at most 20 preview lines
    expect(block.split("\n").length).toBeLessThanOrEqual(21);
  });

  // a message restored from an older client can hold the whole file as its preview; resending
  // it would get every later turn of the conversation 413'd
  it("replays a message carrying a full file body under the cap", async () => {
    const body = "variant\tpip\n" + "1:100673223:G:A\t0.91\n".repeat(300_000);
    const old: ChatMessage = {
      id: "u0",
      role: "user",
      content: "look at this",
      attachments: [
        {
          ...makeTsvAttachment(),
          file: undefined,
          serverId: "att-old",
          status: "uploaded",
          preview: body,
          // the field the full body used to live in is never read
          ...({ textContent: body } as object),
        },
      ],
    };
    render(<LLMChat initialMessages={[old, { id: "a0", role: "assistant", content: "ok" }]} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "and now?" } });
    submit();

    await waitFor(() => expect(sentBodies).toHaveLength(1));
    const [block] = fileBlocks(sentBodies[0]);
    expect(block.startsWith("[File: variants.tsv] attachment_id=att-old")).toBe(true);
    expect(utf8Bytes(block)).toBeLessThanOrEqual(MAX_FILE_BLOCK_BYTES);
    expect(utf8Bytes(bodyText(sentBodies[0]))).toBeLessThan(16 * 1024);
  });

  it("replays a restored message with a server id and no preview as the header alone", async () => {
    const old: ChatMessage = {
      id: "u0",
      role: "user",
      content: "look at this",
      attachments: [{ ...makeTsvAttachment(), file: undefined, serverId: "att-old", status: "uploaded" }],
    };
    render(<LLMChat sessionId="s1" onUserMessage={uploadingOnUserMessage()} initialMessages={[old, { id: "a0", role: "assistant", content: "ok" }]} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "and now?" } });
    submit();

    await waitFor(() => expect(sentBodies).toHaveLength(1));
    expect(fileBlocks(sentBodies[0])).toEqual([
      `[File: variants.tsv] attachment_id=att-old size=${TSV_CONTENT.length} type=text/tab-separated-values`,
    ]);
  });
});

describe("fileReferenceBlock", () => {
  it("cuts a preview of 4-byte code points at the byte bound without splitting one", () => {
    // 2048 is a multiple of 4, so an odd prefix shifts the cut into the middle of a character
    const preview = "x" + "\u{1F9EC}".repeat(2000);
    const block = fileReferenceBlock(
      { name: "dna.tsv", size: 1, type: "tsv", mimeType: "", serverId: "att-1", preview },
      true,
    );
    const body = block.slice(block.indexOf("\n") + 1);
    expect(utf8Bytes(body)).toBeLessThanOrEqual(FILE_PREVIEW_MAX_BYTES);
    expect(utf8Bytes(body)).toBeGreaterThan(FILE_PREVIEW_MAX_BYTES - 4);
    expect(body).not.toContain("\uFFFD");
    expect(/[\uD800-\uDBFF]$/.test(body)).toBe(false);
    expect(utf8Bytes(block)).toBeLessThanOrEqual(MAX_FILE_BLOCK_BYTES);
  });
});
