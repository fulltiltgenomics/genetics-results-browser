/**
 * The selected tool profile is checked against the server that will actually run it
 * (genetics-results-suite-4h6.74).
 *
 * The browser's TOOL_PROFILES and the server's are two hand-maintained lists in two repos that
 * cannot import each other. When they drift, `coerceToolProfile` cannot help — the name IS in the
 * browser's list, so it passes through and the server degrades it to general-only. The user picked
 * a seven-tool surface and silently gets a different arm. `GET /chat/v1/tools/resolved` is the only
 * thing that can tell the two apart, and these cases pin that it is asked and that its answer is
 * used in exactly one direction: an explicit `known_profile: false` is a signal, anything else is
 * not.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getStoredChatOptions = vi.fn();
const saveChatOption = vi.fn(() => Promise.resolve());
const fetchResolvedToolProfile = vi.fn();

vi.mock("./chatOptionsApi", async () => {
  const actual = await vi.importActual<typeof import("./chatOptionsApi")>("./chatOptionsApi");
  return { ...actual, getStoredChatOptions, saveChatOption, fetchResolvedToolProfile };
});

// the store caches answers and in-flight checks at module level, so each case needs a fresh one
async function freshStore() {
  vi.resetModules();
  const mod = await import("./useChatOptions");
  return mod.useChatOptionsStore;
}

// lets a fire-and-forget check settle without the store exposing a promise for it
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the server's verdict on the selected tool profile", () => {
  beforeEach(() => {
    getStoredChatOptions.mockReset();
    saveChatOption.mockClear();
    fetchResolvedToolProfile.mockReset();
    getStoredChatOptions.mockResolvedValue({
      verbosity: "brief",
      literatureBackend: "perplexity",
      toolProfile: null,
    });
    fetchResolvedToolProfile.mockResolvedValue(null);
  });

  it("records known_profile:false for a profile this build offers and the server does not", async () => {
    fetchResolvedToolProfile.mockResolvedValue({ known: false, count: 18 });
    const store = await freshStore();
    await store.getState().load();

    store.getState().setToolProfile("code");
    await settle();

    expect(fetchResolvedToolProfile).toHaveBeenCalledWith("code");
    // what the Tools control renders its warning from
    expect(store.getState().profileChecks.code).toEqual({ known: false, count: 18 });
    // the selection itself is untouched: the warning tells the user what the server will do, it
    // does not silently pick something else for them
    expect(store.getState().toolProfile).toBe("code");
    expect(saveChatOption).toHaveBeenCalledWith("chat_tool_profile", "code");
  });

  it("records the resolved count for a profile the server does know", async () => {
    fetchResolvedToolProfile.mockResolvedValue({ known: true, count: 7 });
    const store = await freshStore();
    await store.getState().load();

    store.getState().setToolProfile("code");
    await settle();

    expect(store.getState().profileChecks.code).toEqual({ known: true, count: 7 });
  });

  it("records NOTHING when the check cannot be answered", async () => {
    // an unreachable endpoint, a 5xx, or a backend predating /chat/v1/tools/resolved. None of
    // those is evidence of drift, and the control must look exactly as it did before the check
    // existed rather than accuse a perfectly good profile
    fetchResolvedToolProfile.mockResolvedValue(null);
    const store = await freshStore();
    await store.getState().load();

    store.getState().setToolProfile("code");
    await settle();

    expect(store.getState().profileChecks).toEqual({});
    expect(store.getState().toolProfile).toBe("code");
  });

  it("survives a check that rejects outright", async () => {
    fetchResolvedToolProfile.mockRejectedValue(new Error("boom"));
    const store = await freshStore();
    await store.getState().load();

    expect(() => store.getState().setToolProfile("code")).not.toThrow();
    await settle();

    expect(store.getState().profileChecks).toEqual({});
    expect(store.getState().toolProfile).toBe("code");
  });

  it("checks a profile restored from the user's stored settings, not only one just clicked", async () => {
    // the drift a user is most likely to hit: they chose the profile weeks ago, it is restored at
    // load, and nothing else ever re-selects it
    getStoredChatOptions.mockResolvedValue({
      verbosity: "brief",
      literatureBackend: "perplexity",
      toolProfile: "code",
    });
    fetchResolvedToolProfile.mockResolvedValue({ known: false, count: 18 });
    const store = await freshStore();

    await store.getState().load();
    await settle();

    expect(fetchResolvedToolProfile).toHaveBeenCalledWith("code");
    expect(store.getState().profileChecks.code).toEqual({ known: false, count: 18 });
  });

  it("never asks about all, which is the absence of a profile", async () => {
    const store = await freshStore();
    await store.getState().load();

    store.getState().setToolProfile(null);
    await settle();

    expect(fetchResolvedToolProfile).not.toHaveBeenCalled();
  });

  it("asks once per profile however often it is selected", async () => {
    fetchResolvedToolProfile.mockResolvedValue({ known: true, count: 7 });
    const store = await freshStore();
    await store.getState().load();

    store.getState().setToolProfile("code");
    store.getState().setToolProfile("code");
    await settle();
    store.getState().setToolProfile("api");
    store.getState().setToolProfile("code");
    await settle();

    expect(fetchResolvedToolProfile.mock.calls.map(([p]) => p)).toEqual(["code", "api"]);
  });
});

/**
 * The OTHER direction of the same drift: a profile the SERVER has and this build does not.
 *
 * `coerceToolProfile` narrows it to `null`, and `null` is not a smaller tool set — server-side it
 * means no filtering at all. A user whose stored `chat_tool_profile` is a server-only name loses
 * the narrow surface they chose and silently gets the full one, with the Tools row saying "All"
 * and the message omitting `tool_profile` entirely. Nothing else can catch it: the value is gone
 * before the resolved-tools probe runs, and the server never receives the string it would warn
 * about. So the stored name is not discarded until the server has been asked about it.
 */
describe("a stored profile only the server knows", () => {
  const storedProfile = (raw: string | null) => ({
    verbosity: "brief" as const,
    literatureBackend: "perplexity" as const,
    toolProfile: null,
    unknownToolProfile: raw,
  });

  beforeEach(() => {
    getStoredChatOptions.mockReset();
    saveChatOption.mockClear();
    fetchResolvedToolProfile.mockReset();
    fetchResolvedToolProfile.mockResolvedValue(null);
  });

  it("keeps a stored name the server confirms, instead of widening the user to All", async () => {
    getStoredChatOptions.mockResolvedValue(storedProfile("nocode"));
    fetchResolvedToolProfile.mockResolvedValue({ known: true, count: 62 });
    const store = await freshStore();

    await store.getState().load();
    await settle();

    expect(fetchResolvedToolProfile).toHaveBeenCalledWith("nocode");
    // selected, so the control shows it and the next message carries it
    expect(store.getState().toolProfile).toBe("nocode");
    // and it stays the user's default, so a new chat does not silently widen either
    expect(store.getState().defaultToolProfile).toBe("nocode");
    expect(store.getState().profileChecks.nocode).toEqual({ known: true, count: 62 });
    // nothing is written back: the settings row already holds this value
    expect(saveChatOption).not.toHaveBeenCalled();
  });

  it("falls back to All when the server does not know the stored name either", async () => {
    getStoredChatOptions.mockResolvedValue(storedProfile("wat"));
    fetchResolvedToolProfile.mockResolvedValue({ known: false, count: 18 });
    const store = await freshStore();

    await store.getState().load();
    await settle();

    expect(store.getState().toolProfile).toBeNull();
    expect(store.getState().defaultToolProfile).toBeNull();
    expect(store.getState().profileChecks).toEqual({});
  });

  it("falls back to All when the probe cannot be answered", async () => {
    // an old backend, a 5xx, offline. An unanswerable probe must change nothing at all
    getStoredChatOptions.mockResolvedValue(storedProfile("nocode"));
    fetchResolvedToolProfile.mockResolvedValue(null);
    const store = await freshStore();

    await store.getState().load();
    await settle();

    expect(store.getState().toolProfile).toBeNull();
  });

  it("survives an adoption probe that rejects outright", async () => {
    getStoredChatOptions.mockResolvedValue(storedProfile("nocode"));
    fetchResolvedToolProfile.mockRejectedValue(new Error("boom"));
    const store = await freshStore();

    await store.getState().load();
    await settle();

    expect(store.getState().toolProfile).toBeNull();
  });

  it("does not overwrite a pick the user made while the probe was in flight", async () => {
    getStoredChatOptions.mockResolvedValue(storedProfile("nocode"));
    let answer: (value: unknown) => void = () => {};
    fetchResolvedToolProfile.mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const store = await freshStore();

    await store.getState().load();
    store.getState().setToolProfile("code");
    answer({ known: true, count: 62 });
    await settle();

    expect(store.getState().toolProfile).toBe("code");
    expect(store.getState().defaultToolProfile).toBe("code");
  });

  it("does not overwrite the profile of a conversation already on screen", async () => {
    // the stored value is the user's DEFAULT; a conversation carries its own. Adopting into the
    // live control here would misreport what that conversation is running with
    getStoredChatOptions.mockResolvedValue(storedProfile("nocode"));
    fetchResolvedToolProfile.mockResolvedValue({ known: true, count: 62 });
    const store = await freshStore();

    store.getState().applyFromConversation({ toolProfile: "api" });
    await store.getState().load();
    await settle();

    expect(store.getState().toolProfile).toBe("api");
    expect(store.getState().defaultToolProfile).toBe("nocode");
  });

  it("asks about the stored name once, not in a loop", async () => {
    getStoredChatOptions.mockResolvedValue(storedProfile("nocode"));
    fetchResolvedToolProfile.mockResolvedValue({ known: true, count: 62 });
    const store = await freshStore();

    await store.getState().load();
    await settle();
    await store.getState().load();
    await settle();

    expect(fetchResolvedToolProfile.mock.calls.map(([p]) => p)).toEqual(["nocode"]);
  });

  it.each([
    ["an empty value", ""],
    ["a value far too long to be a profile name", "n".repeat(200)],
    ["punctuation that has no business in a URL", "no/code?x=1"],
    ["something that is not a string at all", 42],
  ])("never asks the server about %s", async (_label, junk) => {
    getStoredChatOptions.mockResolvedValue(storedProfile(junk as string));
    const store = await freshStore();

    await store.getState().load();
    await settle();

    expect(fetchResolvedToolProfile).not.toHaveBeenCalled();
    expect(store.getState().toolProfile).toBeNull();
  });
});

describe("isPlausibleToolProfile", () => {
  // the bound on everything an opaque settings value is allowed to become: a probe URL, a radio
  // label, and the tool_profile on the next message
  const real = async () =>
    (await vi.importActual<typeof import("./chatOptionsApi")>("./chatOptionsApi"))
      .isPlausibleToolProfile;

  it.each(["nocode", "code", "some_new_profile", "some-new-profile", "abc123"])(
    "accepts %s",
    async (value) => {
      expect((await real())(value)).toBe(true);
    },
  );

  it.each([
    ["the empty string", ""],
    ["over the length bound", "n".repeat(33)],
    ["a path traversal", "../admin"],
    ["a query string", "code&x=1"],
    ["whitespace", "no code"],
    ["a leading digit", "1code"],
    ["null", null],
    ["a number", 7],
    ["an object", { profile: "code" }],
    // "all" is the sentinel for the ABSENCE of a profile, never a profile to ask the server about
    ["the all sentinel", "all"],
  ])("rejects %s", async (_label, value) => {
    expect((await real())(value)).toBe(false);
  });
});

describe("getStoredChatOptions", () => {
  const real = async () =>
    (await vi.importActual<typeof import("./chatOptionsApi")>("./chatOptionsApi"))
      .getStoredChatOptions;

  const serve = (value: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ chat_tool_profile: { setting_value: value } }),
        }),
      ),
    );

  it("surfaces an unrecognised-but-plausible stored profile instead of dropping it", async () => {
    serve("nocode");
    await expect((await real())()).resolves.toMatchObject({
      toolProfile: null,
      unknownToolProfile: "nocode",
    });
    vi.unstubAllGlobals();
  });

  it("leaves unknownToolProfile null for a profile this build does enumerate", async () => {
    serve("code");
    await expect((await real())()).resolves.toMatchObject({
      toolProfile: "code",
      unknownToolProfile: null,
    });
    vi.unstubAllGlobals();
  });

  it.each([["", "empty"], ["n".repeat(200), "over-long"], ["../x", "junk"], ["all", "the sentinel"]])(
    "leaves unknownToolProfile null for %s (%s)",
    async (value) => {
      serve(value);
      await expect((await real())()).resolves.toMatchObject({ unknownToolProfile: null });
      vi.unstubAllGlobals();
    },
  );
});

describe("fetchResolvedToolProfile", () => {
  // the real function against a stubbed global fetch — the store cases above mock it away
  const realFetchResolvedToolProfile = async () =>
    (await vi.importActual<typeof import("./chatOptionsApi")>("./chatOptionsApi"))
      .fetchResolvedToolProfile;

  it("asks the resolved-tools endpoint with the session cookie", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ known_profile: true, count: 7, names: [] }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const probe = await realFetchResolvedToolProfile();
    await expect(probe("code")).resolves.toEqual({ known: true, count: 7 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/tools/resolved?tool_profile=code");
    expect(init.credentials).toBe("include");
    vi.unstubAllGlobals();
  });

  it("reports known:false when the server says it does not know the profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ known_profile: false, count: 18, names: [] }),
        }),
      ),
    );

    const probe = await realFetchResolvedToolProfile();
    await expect(probe("code")).resolves.toEqual({ known: false, count: 18 });
    vi.unstubAllGlobals();
  });

  it.each([
    ["a network failure", () => Promise.reject(new Error("offline"))],
    ["a 5xx", () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) })],
    ["a 404 from a backend that predates the endpoint", () =>
      Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })],
    ["a body with no known_profile field", () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 7 }) })],
    ["unparseable JSON", () =>
      Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("not json")) })],
  ])("fails quiet on %s", async (_label, responder) => {
    vi.stubGlobal("fetch", vi.fn(responder));

    const probe = await realFetchResolvedToolProfile();
    await expect(probe("code")).resolves.toBeNull();
    vi.unstubAllGlobals();
  });
});
