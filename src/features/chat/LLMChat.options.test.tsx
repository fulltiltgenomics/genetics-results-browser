import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { LLMChat } from "./LLMChat";
import { useChatOptionsStore } from "./useChatOptions";
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
    // the tool profile still loads into the store but has no control of its own any more
    await waitFor(() =>
      expect(screen.getByLabelText("Instructions")).toHaveTextContent("Statistician"),
    );
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
