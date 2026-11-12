import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("./schemaApi", () => ({
  useSchema: () => ({ data: undefined }),
}));

Element.prototype.scrollIntoView = vi.fn();

import { LLMChat } from "./LLMChat";

const imageItem = (bytes: number) => ({
  kind: "file",
  type: "image/png",
  getAsFile: () => new File([new Uint8Array(bytes)], "image.png", { type: "image/png" }),
});
const textItem = { kind: "string", type: "text/plain", getAsFile: () => null };

describe("LLMChat paste", () => {
  // one paste carrying both, so both go through the same attach step: the image with bytes
  // is the control that the paste was delivered at all
  it("does not attach an empty clipboard image", async () => {
    render(<LLMChat />);

    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: { items: [imageItem(0), imageItem(8), textItem] },
    });

    await waitFor(() => expect(screen.getAllByText(/^pasted-image-/)).toHaveLength(1));
    expect(screen.getByText("8 B")).toBeTruthy();
  });
});
