import { create } from "zustand";

// this store implements the annotation -> chat seeding direction (refactor.md §9): annotation-side
// affordances stash a context-rich prompt here, then navigate to /chat which prefills the input.
// TODO(refactor.md §9): the reverse direction — a chat tool that drives the table query/filters so
// the assistant can build a view — is out of scope here; it needs chat-backend tool work.

interface ChatSeedState {
  // a pending prefill for the chat input, set by annotation-side "ask the assistant" affordances
  // and consumed once by ChatPage on mount. deliberately NOT persisted: a seed is a one-shot
  // hand-off tied to a single navigation, so it must not survive reloads or reappear later.
  chatSeed: string | undefined;
  setChatSeed: (seed: string) => void;
  // returns the current seed and clears it so it is used exactly once
  consumeChatSeed: () => string | undefined;
}

export const useChatSeedStore = create<ChatSeedState>((set, get) => ({
  chatSeed: undefined,
  setChatSeed: (seed: string) => set({ chatSeed: seed }),
  consumeChatSeed: () => {
    const seed = get().chatSeed;
    if (seed !== undefined) set({ chatSeed: undefined });
    return seed;
  },
}));
