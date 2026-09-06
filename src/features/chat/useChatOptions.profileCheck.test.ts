/**
 * What the server says the selected tool profile resolves to, and how a stored value is read.
 *
 * The probe is no longer a correctness mechanism. It existed because the two ends resolved a value
 * neither of them recognised in OPPOSITE directions — the browser to "no profile", which server-side
 * was the full surface, and the server to a general-only one. Both now resolve everything but
 * "code" to the no-code surface, so nothing the browser sends can mean two things and the only
 * thing left to ask for is the size of the surface, which the control shows as a caption.
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

describe("the size of the surface the selected profile resolves to", () => {
  beforeEach(() => {
    getStoredChatOptions.mockReset();
    saveChatOption.mockClear();
    fetchResolvedToolProfile.mockReset();
    getStoredChatOptions.mockResolvedValue({
      verbosity: "brief",
      literatureBackend: "perplexity",
      toolProfile: "nocode",
    });
    fetchResolvedToolProfile.mockResolvedValue(null);
  });

  it("records the resolved count for the profile the user selected", async () => {
    fetchResolvedToolProfile.mockResolvedValue({ known: true, count: 18 });
    const store = await freshStore();
    await store.getState().load();

    store.getState().setToolProfile("code");
    await settle();

    expect(fetchResolvedToolProfile).toHaveBeenCalledWith("code");
    expect(store.getState().profileChecks.code).toEqual({ known: true, count: 18 });
    expect(store.getState().toolProfile).toBe("code");
  });

  // the caption is absent rather than guessed at: an unreachable or older backend says nothing
  // about a preference that works either way
  it("records NOTHING when the check cannot be answered", async () => {
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

    store.getState().setToolProfile("code");
    await settle();

    expect(store.getState().profileChecks).toEqual({});
  });

  // the caption has to appear for what the controls already show, not only for a fresh click
  it("checks the profile restored from the user's stored settings", async () => {
    fetchResolvedToolProfile.mockResolvedValue({ known: true, count: 62 });
    const store = await freshStore();
    await store.getState().load();
    await settle();

    expect(fetchResolvedToolProfile).toHaveBeenCalledWith("nocode");
    expect(store.getState().profileChecks.nocode).toEqual({ known: true, count: 62 });
  });

  // opening a conversation is the other way a profile reaches the controls without a click
  it("checks the profile a conversation was opened on", async () => {
    fetchResolvedToolProfile.mockResolvedValue({ known: true, count: 18 });
    const store = await freshStore();
    await store.getState().load();
    await settle();

    store.getState().applyFromConversation({ toolProfile: "code" });
    await settle();

    expect(store.getState().profileChecks.code).toEqual({ known: true, count: 18 });
  });

  it("asks once per profile however often it is selected", async () => {
    fetchResolvedToolProfile.mockResolvedValue({ known: true, count: 18 });
    const store = await freshStore();
    await store.getState().load();
    await settle();

    store.getState().setToolProfile("code");
    await settle();
    store.getState().setToolProfile("nocode");
    await settle();
    store.getState().setToolProfile("code");
    await settle();

    expect(fetchResolvedToolProfile.mock.calls.map(([p]) => p)).toEqual(["nocode", "code"]);
  });
});

describe("isPlausibleToolProfile", () => {
  // the bound on what a profile string is allowed to become downstream: today the probe URL
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
    // the sentinel an older client wrote for "no profile selected", never a name to ask about
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

  it("reads a stored code as code execution", async () => {
    serve("code");
    await expect((await real())()).resolves.toMatchObject({ toolProfile: "code" });
    vi.unstubAllGlobals();
  });

  // every value an older client could have written, plus corruption and a name from a build this
  // one predates: all of them are what the server resolves to the no-code surface
  it.each([
    ["a legacy api row", "api"],
    ["a legacy bigquery row", "bigquery"],
    ["a legacy rag row", "rag"],
    ["the all sentinel", "all"],
    ["a profile only some other build knows", "codex"],
    ["a missing setting", undefined],
    ["an explicit null", null],
    ["junk", "../x"],
    ["a number", 7],
  ])("reads %s as no code execution", async (_label, value) => {
    serve(value);
    await expect((await real())()).resolves.toMatchObject({ toolProfile: "nocode" });
    vi.unstubAllGlobals();
  });
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
        json: () => Promise.resolve({ known_profile: true, count: 18, names: [] }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const probe = await realFetchResolvedToolProfile();
    await expect(probe("code")).resolves.toEqual({ known: true, count: 18 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/tools/resolved?tool_profile=code");
    expect(init.credentials).toBe("include");
    vi.unstubAllGlobals();
  });

  // no reachable backend answers false for a value this build sends — the endpoint shipped after
  // `nocode` did — but a false is passed through so the caller can withhold a count it cannot trust
  it("reports known:false when the server does not recognise the value", async () => {
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
    await expect(probe("nocode")).resolves.toEqual({ known: false, count: 18 });
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
