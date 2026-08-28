import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { LLMChat, TOOL_PROFILE_LABELS } from "./LLMChat";
import { TOOL_PROFILES } from "./chat.types";
import { useChatOptionsStore, __resetToolProfileChecks } from "./useChatOptions";
import { useInstructionSetsStore } from "./useInstructionSets";

const SET = {
  id: "set-1",
  name: "Statistician",
  body: "assume fluency",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  body_over_cap: false,
};

// what the user last chose, as the settings endpoint returns it
const serveSettings = (settings: Record<string, string>, puts?: string[]) =>
  server.use(
    http.get("*/v1/llm-config/user/settings", () =>
      HttpResponse.json(
        Object.fromEntries(
          Object.entries(settings).map(([k, v]) => [
            k,
            { id: 1, setting_key: k, setting_value: v, changed_at: "2026-01-01T00:00:00Z" },
          ]),
        ),
      ),
    ),
    http.get("*/v1/llm-config/user/settings/:key", ({ params }) => {
      const value = settings[params.key as string];
      return HttpResponse.json(
        value
          ? { id: 1, setting_key: params.key, setting_value: value, changed_at: "2026-01-01T00:00:00Z" }
          : null,
      );
    }),
    http.put("*/v1/llm-config/user/settings/:key", async ({ params, request }) => {
      const body = (await request.json()) as { setting_value: string };
      puts?.push(`${params.key}=${body.setting_value}`);
      return HttpResponse.json({
        id: 1,
        setting_key: params.key,
        setting_value: body.setting_value,
        changed_at: "2026-01-01T00:00:00Z",
      });
    }),
    http.get("*/v1/llm-config/user/instruction-sets", () => HttpResponse.json([SET])),
  );

// LLMChat pulls the view list through react-query; retries off so a missing handler fails fast
const renderChat = (props: Partial<React.ComponentProps<typeof LLMChat>> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LLMChat {...props} />
    </QueryClientProvider>,
  );

const openOptions = () => fireEvent.click(screen.getByText(/^Options/));

const radio = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;

// the stores are module-level singletons shared across the app, so a test that leaves state behind
// would leak into the next one
const resetStores = () => {
  useChatOptionsStore.setState({
    verbosity: "brief",
    literatureBackend: "perplexity",
    toolProfile: null,
    defaultVerbosity: "brief",
    defaultLiteratureBackend: "perplexity",
    defaultToolProfile: null,
    loaded: false,
    lastConversation: null,
    userChose: false,
  });
  // the server's per-profile verdicts are cached in the store AND in a module-level in-flight set
  __resetToolProfileChecks();
  useInstructionSetsStore.setState({
    sets: [],
    selectedId: null,
    defaultId: null,
    loaded: false,
    conversationApplied: false,
  });
};

describe("LLMChat options", () => {
  beforeEach(() => {
    vi.resetModules();
    resetStores();
    // jsdom has no layout, so the auto-scroll effect would throw once a message renders
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("shows the user's stored options rather than the built-in defaults", async () => {
    serveSettings({
      chat_verbosity: "detailed",
      chat_literature_backend: "europepmc",
      chat_tool_profile: "bigquery",
      selected_instruction_set: SET.id,
    });
    renderChat();
    openOptions();

    await waitFor(() => expect(radio("Detailed").checked).toBe(true));
    expect(radio("Europe PMC").checked).toBe(true);
    expect(radio("Database").checked).toBe(true);
    await waitFor(() =>
      expect(screen.getByLabelText("Instructions")).toHaveTextContent("Statistician"),
    );
  });

  // the Tools control is the only place a profile is picked, and a value missing from it cannot be
  // selected at all while every narrower still resolves it to null — the full tool surface. the
  // label map is exhaustive over ToolProfile, so a new profile is a type error there; this pins
  // that the map and the rendered control agree, and that rag's omission is the only one
  it("offers every labelled profile in the Tools control, and only those", async () => {
    serveSettings({ chat_verbosity: "brief" });
    const { container } = renderChat();
    openOptions();

    await waitFor(() => expect(radio("Brief").checked).toBe(true));
    const rendered = Array.from(container.querySelectorAll('input[type="radio"]'))
      .map((el) => (el as HTMLInputElement).value)
      .filter((v) => v === "all" || (TOOL_PROFILES as readonly string[]).includes(v));
    // "all" is the absence of a profile rather than one of them, so it is not in TOOL_PROFILES
    const expected = ["all", ...TOOL_PROFILES.filter((p) => TOOL_PROFILE_LABELS[p] !== null)];
    expect(rendered).toEqual(expected);
    expect(TOOL_PROFILES.filter((p) => TOOL_PROFILE_LABELS[p] === null)).toEqual(["rag"]);
  });

  // genetics-results-suite-4h6.74: the browser's profile list and the server's are two hand-kept
  // lists in two repos, so this build can offer a name the server no longer knows. Without this the
  // user picks the seven-tool code surface, the server resolves general-only, and nothing says so
  it("warns when the server does not recognise the profile the user selected", async () => {
    serveSettings({ chat_tool_profile: "code" });
    server.use(
      http.get("*/v1/tools/resolved", () =>
        HttpResponse.json({ tool_profile: "code", known_profile: false, count: 18, names: [] }),
      ),
    );
    renderChat();
    openOptions();

    expect(await screen.findByText(/not recognised by the server/)).toBeTruthy();
  });

  // the opposite half: an unreachable endpoint is not evidence of drift, and a warning there would
  // be permanent noise for every user whose backend is simply older or briefly down
  it("says nothing when the resolved-tools endpoint cannot be reached", async () => {
    serveSettings({ chat_tool_profile: "code" });
    server.use(http.get("*/v1/tools/resolved", () => HttpResponse.error()));
    renderChat();
    openOptions();

    await waitFor(() => expect(radio("Code execution").checked).toBe(true));
    expect(screen.queryByText(/not recognised by the server/)).toBeNull();
  });

  // the other drift direction (genetics-results-suite-4h6.74): the stored profile is one the SERVER
  // has and this build does not enumerate. Narrowing it away shows "All", which is the FULL tool
  // surface — the opposite of the narrow one the user stored — so it is kept once the server
  // confirms it, under a label derived from the key because TOOL_PROFILE_LABELS cannot have one
  it("keeps and labels a stored profile only the server knows", async () => {
    serveSettings({ chat_tool_profile: "nocode" });
    renderChat();
    openOptions();

    await waitFor(() => expect(radio("Nocode").checked).toBe(true));
    expect(radio("All").checked).toBe(false);
  });

  it("stays on All when the server does not know the stored profile either", async () => {
    serveSettings({ chat_tool_profile: "nocode" });
    server.use(
      http.get("*/v1/tools/resolved", () =>
        HttpResponse.json({ tool_profile: "nocode", known_profile: false, count: 65, names: [] }),
      ),
    );
    renderChat();
    openOptions();

    await waitFor(() => expect(radio("All").checked).toBe(true));
    expect(screen.queryByRole("radio", { name: "Nocode" })).toBeNull();
  });

  it("persists the code profile picked from the Tools control", async () => {
    const puts: string[] = [];
    serveSettings({ chat_verbosity: "brief" }, puts);
    renderChat();
    openOptions();

    await waitFor(() => expect(radio("All").checked).toBe(true));
    fireEvent.click(radio("Code execution"));

    await waitFor(() => expect(puts).toContain("chat_tool_profile=code"));
    expect(useChatOptionsStore.getState().toolProfile).toBe("code");
  });

  it("saves an explicit pick so it survives to the next session", async () => {
    const puts: string[] = [];
    serveSettings({ chat_verbosity: "brief" }, puts);
    renderChat();
    openOptions();

    await waitFor(() => expect(radio("Brief").checked).toBe(true));
    fireEvent.click(radio("Detailed"));

    await waitFor(() => expect(puts).toContain("chat_verbosity=detailed"));
    expect(radio("Detailed").checked).toBe(true);
  });

  it("summarizes the current selection in the collapsed header", async () => {
    serveSettings({ chat_verbosity: "detailed", selected_instruction_set: SET.id });
    renderChat();

    await waitFor(() => expect(screen.getByText(/detailed, Statistician/)).toBeInTheDocument());
  });

  it("summarizes no selection as no instructions", async () => {
    serveSettings({ chat_verbosity: "brief" });
    renderChat();

    await waitFor(() => expect(screen.getByText(/brief, no instructions/)).toBeInTheDocument());
  });

  describe("the per-message note", () => {
    const message = (id: string, extra: Record<string, unknown>) => ({
      id,
      role: "assistant" as const,
      content: `answer ${id}`,
      ...extra,
    });

    it("names what each answer was produced under", async () => {
      serveSettings({ chat_verbosity: "brief" });
      renderChat({
        initialMessages: [message("a", { verbosity: "detailed", instructionSetId: SET.id })],
      });

      await waitFor(() => expect(screen.getByText("detailed · Statistician")).toBeInTheDocument());
    });

    // the point of stamping the message rather than reading the selector
    it("keeps each turn's own note when the options changed mid-conversation", async () => {
      serveSettings({ chat_verbosity: "brief" });
      renderChat({
        initialMessages: [
          message("a", { verbosity: "brief", instructionSetId: null }),
          message("b", { verbosity: "detailed", instructionSetId: SET.id }),
        ],
      });

      await waitFor(() => expect(screen.getByText("detailed · Statistician")).toBeInTheDocument());
      expect(screen.getByText("brief")).toBeInTheDocument();
    });

    it("says nothing for a message that predates the stamp", async () => {
      serveSettings({ chat_verbosity: "brief" });
      renderChat({ initialMessages: [message("a", { verbosity: null, instructionSetId: null })] });

      await waitFor(() => expect(screen.getByText("answer a")).toBeInTheDocument());
      expect(screen.queryByText(/·/)).not.toBeInTheDocument();
      expect(screen.queryByText("brief")).not.toBeInTheDocument();
    });

    it("omits an instruction set that no longer lists rather than naming it wrongly", async () => {
      serveSettings({ chat_verbosity: "brief" });
      renderChat({
        initialMessages: [message("a", { verbosity: "brief", instructionSetId: "set-archived" })],
      });

      await waitFor(() => expect(screen.getByText("brief")).toBeInTheDocument());
      expect(screen.queryByText(/·/)).not.toBeInTheDocument();
    });

    it("does not label the user's own messages", async () => {
      serveSettings({ chat_verbosity: "brief" });
      renderChat({
        initialMessages: [
          { id: "u", role: "user" as const, content: "question", verbosity: "detailed" },
        ],
      });

      await waitFor(() => expect(screen.getByText("question")).toBeInTheDocument());
      expect(screen.queryByText("detailed")).not.toBeInTheDocument();
    });
  });

  // the reapply path: ChatPage hands a conversation's stored options to the store, and the
  // controls have to follow without the user's own default being rewritten
  it("reflects a conversation's options without changing what a new chat starts from", async () => {
    serveSettings({ chat_verbosity: "brief", chat_literature_backend: "perplexity" });
    renderChat();
    openOptions();
    await waitFor(() => expect(radio("Brief").checked).toBe(true));

    useChatOptionsStore.getState().applyFromConversation({
      verbosity: "detailed",
      literatureBackend: "europepmc",
      toolProfile: null,
    });
    await waitFor(() => expect(radio("Detailed").checked).toBe(true));
    expect(radio("Europe PMC").checked).toBe(true);

    useChatOptionsStore.getState().resetToDefaults();
    await waitFor(() => expect(radio("Brief").checked).toBe(true));
    expect(radio("Perplexity").checked).toBe(true);
  });
});
