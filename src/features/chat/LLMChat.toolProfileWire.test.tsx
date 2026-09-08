import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

vi.mock("./schemaApi", () => ({
  useSchema: () => ({ data: undefined }),
}));

// jsdom doesn't implement scrollIntoView, which the autoscroll effect calls on every render
Element.prototype.scrollIntoView = vi.fn();

const sentBodies: any[] = [];
vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: vi.fn(async (_url: string, init: any) => {
    sentBodies.push(JSON.parse(init.body));
    await init.onopen({ ok: true, headers: { get: () => "text/event-stream" } });
    init.onmessage({ data: JSON.stringify({ type: "content", content: "ok" }) });
    init.onmessage({ data: JSON.stringify({ type: "done" }) });
    init.onclose?.();
  }),
}));

import { server } from "../../test/msw/server";
import { LLMChat } from "./LLMChat";
import { saveMessage } from "./chatHistoryApi";
import { useChatOptionsStore } from "./useChatOptions";

// the switch's two states, as the store holds them; `loaded` keeps the settings fetch from
// replacing them mid-test
const selectProfile = (toolProfile: "code" | "nocode") =>
  useChatOptionsStore.setState({
    toolProfile,
    defaultToolProfile: toolProfile,
    profileChecks: {},
    loaded: true,
    userChose: true,
    lastConversation: null,
  });

const submit = () => {
  const form = screen.getByRole("textbox").closest("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form!);
};

// the wire value both write paths carry. The type system says it can only be one of these two,
// but nothing else pins that the switch's off state reaches the server as "nocode" rather than as
// an omitted field or a legacy name
describe("the tool profile on the wire", () => {
  beforeEach(() => {
    sentBodies.length = 0;
  });

  it.each(["nocode", "code"] as const)("sends %s on the chat POST", async (profile) => {
    selectProfile(profile);
    render(<LLMChat />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    submit();

    await waitFor(() => expect(sentBodies).toHaveLength(1));
    expect(sentBodies[0].tool_profile).toBe(profile);
  });

  it.each(["nocode", "code"] as const)("stamps %s on the saved message", async (profile) => {
    const saved: Array<Record<string, unknown>> = [];
    server.use(
      http.post("*/v1/chat/sessions/:sessionId/messages", async ({ request, params }) => {
        const body = (await request.json()) as Record<string, unknown>;
        saved.push(body);
        return HttpResponse.json({
          id: body.id,
          session_id: params.sessionId,
          role: body.role,
          content: body.content,
          created_at: "2026-01-01T00:00:00Z",
        });
      })
    );
    selectProfile(profile);
    const onStreamingComplete = vi.fn();
    render(<LLMChat onStreamingComplete={onStreamingComplete} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    submit();

    await waitFor(() => expect(onStreamingComplete).toHaveBeenCalled());
    const [, assistantMsg, , literatureBackend, toolProfile] = onStreamingComplete.mock
      .calls[0] as any[];

    await saveMessage(
      "session-1",
      assistantMsg.id,
      assistantMsg.role,
      assistantMsg.content,
      null,
      literatureBackend,
      toolProfile
    );

    expect(saved).toHaveLength(1);
    expect(saved[0].tool_profile).toBe(profile);
  });
});
