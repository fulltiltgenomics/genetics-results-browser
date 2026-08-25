import { beforeEach, describe, expect, it, vi } from "vitest";
import { TOOL_PROFILES } from "./chat.types";

const getStoredChatOptions = vi.fn();
const saveChatOption = vi.fn(() => Promise.resolve());
// selecting or restoring a profile now probes the server; stubbed to "no answer" here so these
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

// the module is mocked above, and a static import of it would run before vi.mock's hoisted factory
const realCoerceToolProfile = async () =>
  (await vi.importActual<typeof import("./chatOptionsApi")>("./chatOptionsApi")).coerceToolProfile;

describe("chat options persistence", () => {
  beforeEach(() => {
    getStoredChatOptions.mockReset();
    saveChatOption.mockClear();
    getStoredChatOptions.mockResolvedValue({
      verbosity: "detailed",
      literatureBackend: "europepmc",
      toolProfile: "api",
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
      toolProfile: null,
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
      toolProfile: null,
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
      toolProfile: null,
    });
    resolveStored({
      verbosity: "detailed",
      literatureBackend: "europepmc",
      toolProfile: "api",
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
      toolProfile: null,
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
      toolProfile: "api",
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
    expect(store.getState().toolProfile).toBeNull();
  });

  it("round-trips the all profile through the sentinel the settings endpoint accepts", async () => {
    const store = await freshStore();
    await store.getState().load();
    store.getState().setToolProfile(null);
    expect(saveChatOption).toHaveBeenCalledWith("chat_tool_profile", "all");
    expect(store.getState().toolProfile).toBeNull();
  });
});

// a profile that some list forgot does not error, it lands on null — which is the FULL tool
// surface, not a smaller one. these cases are driven off TOOL_PROFILES so adding a profile
// without teaching every narrower about it fails here rather than silently running the maximal arm
describe("tool profiles", () => {
  beforeEach(() => {
    getStoredChatOptions.mockReset();
    saveChatOption.mockClear();
    getStoredChatOptions.mockResolvedValue({
      verbosity: "brief",
      literatureBackend: "perplexity",
      toolProfile: null,
    });
  });

  it("lists code alongside the three original profiles", () => {
    expect([...TOOL_PROFILES]).toEqual(["api", "bigquery", "rag", "code"]);
  });

  it.each([...TOOL_PROFILES])("narrows %s read back from the settings endpoint", async (profile) => {
    const coerceToolProfile = await realCoerceToolProfile();
    expect(coerceToolProfile(profile)).toBe(profile);
  });

  it.each([...TOOL_PROFILES])("restores %s stored on a conversation's last message", async (profile) => {
    const store = await freshStore();
    await store.getState().load();
    store.getState().applyFromConversation({ toolProfile: profile });
    expect(store.getState().toolProfile).toBe(profile);
    // a conversation's own value must not become the user's default
    expect(store.getState().defaultToolProfile).toBeNull();
  });

  it.each([...TOOL_PROFILES])("persists %s as the user's new default", async (profile) => {
    const store = await freshStore();
    await store.getState().load();
    store.getState().setToolProfile(profile);
    expect(store.getState().toolProfile).toBe(profile);
    expect(saveChatOption).toHaveBeenCalledWith("chat_tool_profile", profile);
  });

  // pinned rather than implied: null means every tool, so this is the maximal fallback, chosen
  // because the value comes back from rows written by older clients and must not raise
  it("degrades an unrecognised profile to null, i.e. to all tools", async () => {
    const coerceToolProfile = await realCoerceToolProfile();
    expect(coerceToolProfile("codex")).toBeNull();
    expect(coerceToolProfile("")).toBeNull();
    expect(coerceToolProfile(7)).toBeNull();

    const store = await freshStore();
    await store.getState().load();
    store.getState().applyFromConversation({ toolProfile: "codex" });
    expect(store.getState().toolProfile).toBeNull();
  });
});
