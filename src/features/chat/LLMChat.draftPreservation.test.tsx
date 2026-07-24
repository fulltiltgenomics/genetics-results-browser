import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// mock useSchema so LLMChat doesn't fire a network request on mount (it's only used to build the
// view-name linkify plugin)
vi.mock("./schemaApi", () => ({
  useSchema: () => ({ data: undefined }),
}));

import { LLMChat } from "./LLMChat";
import type { PendingAttachment } from "./chat.types";

const makeAttachment = (name: string): PendingAttachment => ({
  id: crypto.randomUUID(),
  name,
  size: 42,
  type: "tsv",
  mimeType: "text/tab-separated-values",
  status: "pending",
  file: new File(["a\tb\n1\t2\n"], name, { type: "text/tab-separated-values" }),
});

describe("LLMChat draft preservation (conversation switching)", () => {
  it("restores pending attachments from initialAttachments", () => {
    const attachment = makeAttachment("variants.tsv");
    render(<LLMChat initialInput="what about these?" initialAttachments={[attachment]} />);

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("what about these?");
    expect(screen.getByText("variants.tsv")).toBeDefined();
  });

  it("reports draft changes via onDraftChange as the user types", async () => {
    const onDraftChange = vi.fn();
    render(<LLMChat onDraftChange={onDraftChange} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "unsent draft" } });

    await waitFor(() => {
      expect(onDraftChange).toHaveBeenCalledWith("unsent draft", []);
    });
  });

  it("reports the restored draft back on mount so the parent stays in sync", async () => {
    const onDraftChange = vi.fn();
    const attachment = makeAttachment("data.tsv");
    render(
      <LLMChat
        initialInput="draft text"
        initialAttachments={[attachment]}
        onDraftChange={onDraftChange}
      />,
    );

    await waitFor(() => {
      expect(onDraftChange).toHaveBeenCalledWith("draft text", [attachment]);
    });
  });
});
