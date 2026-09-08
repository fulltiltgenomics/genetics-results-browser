import { beforeEach, describe, expect, it, vi } from "vitest";

const getStoredChatOptions = vi.fn();
const saveChatOption = vi.fn(() => Promise.resolve());
// selecting a profile asks the server how big the surface is; stubbed to "no answer" here so these
// cases stay about persistence and hermetic. The probe itself is covered in
// useChatOptions.profileCheck.test.ts
const fetchResolvedToolProfile = vi.fn(() => Promise.resolve(null));

vi.mock("./chatOptionsApi", async () => {
  const actual = await vi.importActual<typeof import("./chatOptionsApi")>("./chatOptionsApi");
  return { ...actual, getStoredChatOptions, saveChatOption, fetchResolvedToolProfile };
});

// the store keeps module-level flags, so each case needs a fresh module instance
async function freshStore() {
  vi.resetModules();
  const mod = await import("./useChatOptions");
  return mod.useChatOptionsStore;
}

describe("chat options persistence", () => {
  beforeEach(() => {
    getStoredChatOptions.mockReset();
    saveChatOption.mockClear();
    getStoredChatOptions.mockResolvedValue({
      verbosity: "detailed",
      literatureBackend: "europepmc",
      toolProfile: "code",
    });
  });

  it("loads the user's stored options as both the current value and the default", async () => {
    const store = await freshStore();
    await store.getState().load();
    expect(store.getState().verbosity).toBe("detailed");
    expect(store.getState().defaultVerbosity).toBe("detailed");
  });

  it("persists an explicit pick as the new default", async () => {
    const store = await freshStore();
    await store.getState().load();
    store.getState().setVerbosity("brief");
    expect(store.getState().defaultVerbosity).toBe("brief");
    expect(saveChatOption).toHaveBeenCalledWith("chat_verbosity", "brief");
  });

  // the rule the user asked for: reading an old conversation must not change what the next new
  // chat starts from
  it("applies a conversation's options without changing the default", async () => {
    const store = await freshStore();
    await store.getState().load();
    store.getState().setVerbosity("brief");

    store.getState().applyFromConversation({
      verbosity: "detailed",
      literatureBackend: "perplexity",
      toolProfile: "nocode",
    });
    expect(store.getState().verbosity).toBe("detailed");
    expect(store.getState().defaultVerbosity).toBe("brief");

    store.getState().resetToDefaults();
    expect(store.getState().verbosity).toBe("brief");
  });

  it("falls back to the default for an option the conversation predates", async () => {
    const store = await freshStore();
    await store.getState().load();
    store.getState().applyFromConversation({ verbosity: null, literatureBackend: "perplexity" });
    expect(store.getState().verbosity).toBe("detailed");
    expect(store.getState().literatureBackend).toBe("perplexity");
  });

  it("keeps an unrecognised stored value from emptying the control", async () => {
    getStoredChatOptions.mockResolvedValue({
      verbosity: "brief",
      literatureBackend: "perplexity",
      toolProfile: "nocode",
    });
    const store = await freshStore();
    await store.getState().load();
    store.getState().applyFromConversation({ verbosity: "verbose" });
    expect(store.getState().verbosity).toBe("brief");
  });

  // deep-link race: the conversation resolves before the settings fetch
  it("does not let a late settings load overwrite the conversation on screen", async () => {
    let resolveStored: (v: unknown) => void = () => {};
    getStoredChatOptions.mockReturnValue(
      new Promise((resolve) => {
        resolveStored = resolve;
      }),
    );
    const store = await freshStore();
    const loading = store.getState().load();

    store.getState().applyFromConversation({
      verbosity: "brief",
      literatureBackend: "perplexity",
      toolProfile: "nocode",
    });
    resolveStored({
      verbosity: "detailed",
      literatureBackend: "europepmc",
      toolProfile: "code",
    });
    await loading;

    expect(store.getState().verbosity).toBe("brief");
    // the default still landed, so a new chat picks it up
    expect(store.getState().defaultVerbosity).toBe("detailed");
    store.getState().resetToDefaults();
    expect(store.getState().verbosity).toBe("detailed");
  });

  // same race, but the conversation predates the option: the gap must fall through to the default
  // that arrives late, not to the built-in that was standing in
  it("re-resolves a conversation's missing option against the late default", async () => {
    let resolveStored: (v: unknown) => void = () => {};
    getStoredChatOptions.mockReturnValue(
      new Promise((resolve) => {
        resolveStored = resolve;
      }),
    );
    const store = await freshStore();
    const loading = store.getState().load();

    store.getState().applyFromConversation({ verbosity: null, literatureBackend: null });
    resolveStored({
      verbosity: "detailed",
      literatureBackend: "europepmc",
      toolProfile: "nocode",
    });
    await loading;

    expect(store.getState().verbosity).toBe("detailed");
  });

  it("does not let a late settings load overwrite an explicit pick", async () => {
    let resolveStored: (v: unknown) => void = () => {};
    getStoredChatOptions.mockReturnValue(
      new Promise((resolve) => {
        resolveStored = resolve;
      }),
    );
    const store = await freshStore();
    const loading = store.getState().load();

    store.getState().setVerbosity("brief");
    resolveStored({
      verbosity: "detailed",
      literatureBackend: "europepmc",
      toolProfile: "code",
    });
    await loading;

    expect(store.getState().verbosity).toBe("brief");
    expect(store.getState().defaultVerbosity).toBe("brief");
  });

  it("keeps the built-in defaults when the settings fetch fails", async () => {
    getStoredChatOptions.mockRejectedValue(new Error("boom"));
    const store = await freshStore();
    await store.getState().load();
    expect(store.getState().verbosity).toBe("brief");
    expect(store.getState().literatureBackend).toBe("perplexity");
    expect(store.getState().toolProfile).toBe("nocode");
  });

  it("persists the profile the control sends, without a sentinel for the off state", async () => {
    const store = await freshStore();
    await store.getState().load();
    store.getState().setToolProfile("nocode");
    expect(saveChatOption).toHaveBeenCalledWith("chat_tool_profile", "nocode");
    expect(store.getState().toolProfile).toBe("nocode");
  });
});

// the stored-value path. Only "code" asks for code execution; every value an older client could
// have written — the legacy profile names, the "all" sentinel, NULL, and a name from a build
// nobody here knows — resolves to no code execution, which is what the server does with the same
// value. So the control shows what that conversation actually ran with
describe("tool profiles", () => {
  beforeEach(() => {
    getStoredChatOptions.mockReset();
    saveChatOption.mockClear();
    getStoredChatOptions.mockResolvedValue({
      verbosity: "brief",
      literatureBackend: "perplexity",
      toolProfile: "nocode",
    });
  });

  it.each(["api", "bigquery", "rag", "all", "codex", null, undefined])(
    "restores %s stored on a conversation's last message as no code execution",
    async (stored) => {
      const store = await freshStore();
      await store.getState().load();
      store.getState().applyFromConversation({ toolProfile: stored });
      expect(store.getState().toolProfile).toBe("nocode");
    },
  );

  it("restores code stored on a conversation's last message as code execution", async () => {
    const store = await freshStore();
    await store.getState().load();
    store.getState().applyFromConversation({ toolProfile: "code" });
    expect(store.getState().toolProfile).toBe("code");
    // a conversation's own value must not become the user's default
    expect(store.getState().defaultToolProfile).toBe("nocode");
  });

  it.each(["code", "nocode"] as const)("persists %s as the user's new default", async (profile) => {
    const store = await freshStore();
    await store.getState().load();
    store.getState().setToolProfile(profile);
    expect(store.getState().toolProfile).toBe(profile);
    expect(store.getState().defaultToolProfile).toBe(profile);
    expect(saveChatOption).toHaveBeenCalledWith("chat_tool_profile", profile);
  });

  // what the server serves a user who has never chosen: DEFAULT_TOOL_PROFILE arrives as this
  // setting, so it has to reach the control rather than the built-in default
  it("starts a new chat from the profile the settings endpoint served", async () => {
    getStoredChatOptions.mockResolvedValue({
      verbosity: "brief",
      literatureBackend: "perplexity",
      toolProfile: "code",
    });
    const store = await freshStore();
    await store.getState().load();
    expect(store.getState().toolProfile).toBe("code");
    store.getState().applyFromConversation({ toolProfile: null });
    store.getState().resetToDefaults();
    expect(store.getState().toolProfile).toBe("code");
  });
});
