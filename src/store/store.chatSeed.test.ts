import { describe, it, expect, beforeEach } from "vitest";
import { useChatSeedStore } from "./store.chatSeed";

// the chatSeed store backs the annotation -> chat hand-off (refactor.md §9): a one-shot prefill
// that ChatPage consumes exactly once on mount. these tests pin the set/consume/clear contract.

describe("chatSeed store", () => {
  beforeEach(() => {
    useChatSeedStore.setState({ chatSeed: undefined });
  });

  it("starts empty", () => {
    expect(useChatSeedStore.getState().chatSeed).toBeUndefined();
    expect(useChatSeedStore.getState().consumeChatSeed()).toBeUndefined();
  });

  it("stores a seed via setChatSeed", () => {
    useChatSeedStore.getState().setChatSeed("Explain variant 19:44908684:T:C.");
    expect(useChatSeedStore.getState().chatSeed).toBe("Explain variant 19:44908684:T:C.");
  });

  it("consumeChatSeed returns the seed and clears it (one-shot)", () => {
    useChatSeedStore.getState().setChatSeed("Summarize APOE.");
    const first = useChatSeedStore.getState().consumeChatSeed();
    expect(first).toBe("Summarize APOE.");
    // cleared so it can't reappear on a later consume/mount
    expect(useChatSeedStore.getState().chatSeed).toBeUndefined();
    expect(useChatSeedStore.getState().consumeChatSeed()).toBeUndefined();
  });
});
