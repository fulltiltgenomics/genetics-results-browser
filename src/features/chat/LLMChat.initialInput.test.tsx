import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// mock useSchema so LLMChat doesn't fire a network request on mount (it's only used to build the
// view-name linkify plugin). we only care that initialInput prefills the input draft here.
vi.mock("./schemaApi", () => ({
  useSchema: () => ({ data: undefined }),
}));

import { LLMChat } from "./LLMChat";

describe("LLMChat initialInput (annotation -> chat seeding)", () => {
  it("prefills the input draft with initialInput without auto-sending", () => {
    const onMessagesChange = vi.fn();
    const seed = "Explain variant 19:44908684:T:C (rs429358, APOE, missense variant).";
    render(<LLMChat initialInput={seed} onMessagesChange={onMessagesChange} />);

    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textbox.value).toBe(seed);

    // no message was sent — only the empty initial messages notification fired
    expect(onMessagesChange).toHaveBeenCalledWith([]);
  });

  it("starts empty when no initialInput is given", () => {
    render(<LLMChat />);
    const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textbox.value).toBe("");
  });
});
