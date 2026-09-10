import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import ChatPage from "./ChatPage";

// the chat surface itself is irrelevant to filing, but the lazy creation path runs through it:
// the stub exposes the two props filing depends on — the session it creates on the first send,
// and the project it is told the conversation belongs to
vi.mock("./LLMChat", () => ({
  LLMChat: (props: {
    onEnsureSession?: () => Promise<string | null>;
    onMessagesChange?: (messages: unknown[]) => void;
    projectId?: string | null;
  }) => (
    <div>
      <button onClick={() => void props.onEnsureSession?.()}>send</button>
      <button onClick={() => props.onMessagesChange?.([{ id: "m1", role: "user", content: "hi" }])}>
        type
      </button>
      <span data-testid="llm-project">{String(props.projectId)}</span>
    </div>
  ),
}));
vi.mock("../page/McpTokenDialog", () => ({ default: () => null }));
vi.mock("./DatasetsDialog", () => ({ DatasetsDialog: () => null }));
vi.mock("./ToolsDialog", () => ({ ToolsDialog: () => null }));
vi.mock("./SchemaDrawer", () => ({ SchemaDrawer: () => null }));
vi.mock("./SessionRating", () => ({ SessionRating: () => null }));
vi.mock("./FeedbackDialog", () => ({ FeedbackDialog: () => null }));
vi.mock("./AboutDialog", () => ({ AboutDialog: () => null }));
vi.mock("./MemoryDialog", () => ({ MemoryDialog: () => null }));
vi.mock("./schemaApi", () => ({ useSchema: () => ({ data: undefined }) }));

const now = "2026-09-09T00:00:00Z";

const wireProject = (id: string, name: string) => ({
  id,
  name,
  created_at: now,
  updated_at: now,
  last_activity_at: now,
  session_count: 0,
});

const wireSession = (id: string, title: string, projectId: string | null) => ({
  id,
  title,
  created_at: now,
  updated_at: now,
  project_id: projectId,
});

let createBodies: unknown[] = [];
let moveBodies: Array<{ sessionId: string; body: unknown }> = [];
let deletedIds: string[] = [];

const baseHandlers = (sessions: ReturnType<typeof wireSession>[]) => [
  http.get("*/v1/chat/sessions", () => HttpResponse.json(sessions)),
  http.get("*/v1/projects", () =>
    HttpResponse.json([wireProject("p1", "IBD"), wireProject("p2", "pQTL network")]),
  ),
  http.get("*/v1/projects/:projectId/sessions", ({ params }) =>
    HttpResponse.json(sessions.filter((s) => s.project_id === params.projectId)),
  ),
  http.get("*/v1/chat/sessions/:sessionId", ({ params }) =>
    HttpResponse.json({
      ...wireSession(params.sessionId as string, "APOE and lipids", null),
      is_owner: true,
      shared: false,
      messages: [],
    }),
  ),
  http.post("*/v1/chat/sessions", async ({ request }) => {
    const body = (await request.json()) as { project_id?: string };
    createBodies.push(body);
    return HttpResponse.json(wireSession("s-new", "New Chat", body.project_id ?? null));
  }),
  http.delete("*/v1/chat/sessions/:sessionId", ({ params }) => {
    deletedIds.push(params.sessionId as string);
    return HttpResponse.json({ ok: true });
  }),
  http.put("*/v1/chat/sessions/:sessionId/project", async ({ params, request }) => {
    moveBodies.push({ sessionId: params.sessionId as string, body: await request.json() });
    return HttpResponse.json({ ok: true });
  }),
];

const renderChatPage = (initialEntry = "/chat") =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:sessionId" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  createBodies = [];
  moveBodies = [];
  deletedIds = [];
});

describe("ChatPage discards an empty eager chat", () => {
  // the sidebar's New Chat button carries the same text as an untitled row, so rows are
  // looked up inside their project section
  const section = (container: HTMLElement, id: string) =>
    container.querySelector(`[data-project-id="${id}"]`) as HTMLElement;

  it("deletes the chat created by a project's + when another conversation is opened", async () => {
    server.use(...baseHandlers([wireSession("s1", "APOE and lipids", null)]));
    const { container } = renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "New chat in IBD" }));
    await waitFor(() => expect(createBodies).toHaveLength(1));
    await waitFor(() => expect(within(section(container, "p1")).getByText("New Chat")).toBeInTheDocument());

    fireEvent.click(screen.getByText("APOE and lipids"));
    await waitFor(() => expect(deletedIds).toEqual(["s-new"]));
    await waitFor(() =>
      expect(within(section(container, "p1")).queryByText("New Chat")).not.toBeInTheDocument(),
    );
  });

  it("deletes it when yet another new chat is started, and keeps the new one", async () => {
    server.use(...baseHandlers([wireSession("s1", "APOE and lipids", null)]));
    const { container } = renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "New chat in IBD" }));
    await waitFor(() => expect(createBodies).toHaveLength(1));
    fireEvent.click(await screen.findByRole("button", { name: "New chat in IBD" }));
    await waitFor(() => expect(createBodies).toHaveLength(2));
    expect(deletedIds).toEqual(["s-new"]);

    // the second one is still in place and is not deleted by being re-selected
    const row = await waitFor(() => within(section(container, "p1")).getByText("New Chat"));
    fireEvent.click(row);
    expect(deletedIds).toEqual(["s-new"]);
  });

  it("keeps a chat once something has been typed into it", async () => {
    server.use(...baseHandlers([wireSession("s1", "APOE and lipids", null)]));
    const { container } = renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "New chat in IBD" }));
    await waitFor(() => expect(createBodies).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "type" }));

    fireEvent.click(screen.getByText("APOE and lipids"));
    await screen.findByText("APOE and lipids");
    expect(deletedIds).toEqual([]);
    expect(within(section(container, "p1")).getByText("New Chat")).toBeInTheDocument();
  });
});

describe("ChatPage new chat in a project", () => {
  it("sends the section's project on the create request", async () => {
    server.use(...baseHandlers([wireSession("s1", "APOE and lipids", null)]));
    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "New chat in IBD" }));
    await waitFor(() => expect(createBodies).toHaveLength(1));
    expect(createBodies[0]).toMatchObject({ project_id: "p1" });
  });

  it("inherits the current project on the plain New Chat button, and follows the caret", async () => {
    server.use(...baseHandlers([wireSession("s1", "APOE and lipids", null)]));
    renderChatPage();

    // "+" in a section sets the current project; the New Chat button then inherits it
    fireEvent.click(await screen.findByRole("button", { name: "New chat in pQTL network" }));
    await waitFor(() => expect(createBodies).toHaveLength(1));
    expect(await screen.findByText("Project: pQTL network")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "New Chat" })[0]);
    await waitFor(() => expect(createBodies).toHaveLength(2));
    expect(createBodies[1]).toMatchObject({ project_id: "p2" });

    // the caret switches it back to unfiled
    fireEvent.click(screen.getByRole("button", { name: "Choose project for new chat" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "No project" }));
    fireEvent.click(screen.getAllByRole("button", { name: "New Chat" })[0]);
    await waitFor(() => expect(createBodies).toHaveLength(3));
    expect((createBodies[2] as { project_id?: string }).project_id).toBeUndefined();
  });

  it("files an unfiled conversation from the row menu", async () => {
    server.use(...baseHandlers([wireSession("s1", "APOE and lipids", null)]));
    renderChatPage();

    const row = await screen.findByText("APOE and lipids");
    fireEvent.mouseEnter(row);
    fireEvent.click(screen.getByRole("button", { name: "conversation menu: APOE and lipids" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "IBD" }));

    await waitFor(() => expect(moveBodies).toHaveLength(1));
    expect(moveBodies[0]).toEqual({ sessionId: "s1", body: { project_id: "p1" } });
  });

  it("unfiles a filed conversation from the row menu", async () => {
    server.use(...baseHandlers([wireSession("s1", "IBD fine-mapping", "p1")]));
    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "Project: IBD" }));
    const row = await screen.findByText("IBD fine-mapping");
    fireEvent.mouseEnter(row);
    fireEvent.click(screen.getByRole("button", { name: "conversation menu: IBD fine-mapping" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Unfile" }));

    await waitFor(() => expect(moveBodies).toHaveLength(1));
    expect(moveBodies[0]).toEqual({ sessionId: "s1", body: { project_id: null } });
  });

  it("offers no filing surface in a secret chat", async () => {
    server.use(...baseHandlers([wireSession("s1", "APOE and lipids", null)]));
    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "New chat in IBD" }));
    expect(await screen.findByText("Project: IBD")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Secret Chat" })[0]);
    await screen.findByText("Not Saved");
    expect(screen.queryByText("Project: IBD")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Choose project for new chat" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the project of a deep-linked conversation the session list has not returned", async () => {
    // msw takes the first matching handler, so the detail override has to precede the base one
    server.use(
      http.get("*/v1/chat/sessions/:sessionId", ({ params }) =>
        HttpResponse.json({
          ...wireSession(params.sessionId as string, "IBD fine-mapping", "p1"),
          is_owner: true,
          shared: false,
          messages: [],
        }),
      ),
      ...baseHandlers([]),
    );
    renderChatPage("/chat/s-filed");

    expect(await screen.findByText("Project: IBD")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("llm-project")).toHaveTextContent("p1"));

    fireEvent.click(screen.getAllByRole("button", { name: "New Chat" })[0]);
    await waitFor(() => expect(createBodies).toHaveLength(1));
    expect(createBodies[0]).toMatchObject({ project_id: "p1" });
  });

  it("files a lazily created session into the current project", async () => {
    server.use(...baseHandlers([wireSession("s1", "APOE and lipids", null)]));
    renderChatPage();

    fireEvent.click(await screen.findByRole("button", { name: "Choose project for new chat" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "IBD" }));
    // no session yet: the first send is what creates one
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(createBodies).toHaveLength(1));
    expect(createBodies[0]).toMatchObject({ project_id: "p1" });
  });

  it("puts a conversation back in its project when the move fails", async () => {
    server.use(
      http.get("*/v1/chat/sessions/:sessionId", ({ params }) =>
        HttpResponse.json({
          ...wireSession(params.sessionId as string, "IBD fine-mapping", "p1"),
          is_owner: true,
          shared: false,
          messages: [],
        }),
      ),
      http.put("*/v1/chat/sessions/:sessionId/project", async ({ params, request }) => {
        moveBodies.push({ sessionId: params.sessionId as string, body: await request.json() });
        return HttpResponse.json({ detail: "nope" }, { status: 500 });
      }),
      ...baseHandlers([wireSession("s1", "IBD fine-mapping", "p1")]),
    );
    const { container } = renderChatPage("/chat/s1");
    const section = (id: string) =>
      container.querySelector(`[data-project-id="${id}"]`) as HTMLElement;

    expect(await screen.findByText("Project: IBD")).toBeInTheDocument();
    const row = await waitFor(() => within(section("p1")).getByText("IBD fine-mapping"));

    fireEvent.mouseEnter(row);
    fireEvent.click(screen.getByRole("button", { name: "conversation menu: IBD fine-mapping" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "pQTL network" }));

    await waitFor(() => expect(moveBodies).toHaveLength(1));
    await waitFor(() =>
      expect(within(section("p1")).getByText("IBD fine-mapping")).toBeInTheDocument(),
    );
    expect(section("p2").textContent).not.toContain("IBD fine-mapping");
    expect(screen.getByText("Project: IBD")).toBeInTheDocument();
    expect(screen.getByTestId("llm-project")).toHaveTextContent("p1");
  });

  it("rolls a failed move back to the project of a row only the sidebar caches", async () => {
    // the session list is empty: this row reaches the sidebar from the per-project endpoint,
    // which is the only place its project is known
    server.use(
      http.get("*/v1/chat/sessions/:sessionId", ({ params }) =>
        HttpResponse.json({
          ...wireSession(params.sessionId as string, "IBD fine-mapping", "p1"),
          is_owner: true,
          shared: false,
          messages: [],
        }),
      ),
      http.get("*/v1/projects/p1/sessions", () =>
        HttpResponse.json([wireSession("s1", "IBD fine-mapping", "p1")]),
      ),
      http.put("*/v1/chat/sessions/:sessionId/project", async ({ params, request }) => {
        moveBodies.push({ sessionId: params.sessionId as string, body: await request.json() });
        return HttpResponse.json({ detail: "nope" }, { status: 500 });
      }),
      ...baseHandlers([]),
    );
    const { container } = renderChatPage("/chat/s1");
    const section = (id: string) =>
      container.querySelector(`[data-project-id="${id}"]`) as HTMLElement;

    expect(await screen.findByText("Project: IBD")).toBeInTheDocument();
    const row = await waitFor(() => within(section("p1")).getByText("IBD fine-mapping"));

    fireEvent.mouseEnter(row);
    fireEvent.click(screen.getByRole("button", { name: "conversation menu: IBD fine-mapping" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "pQTL network" }));

    await waitFor(() => expect(moveBodies).toHaveLength(1));
    // the rollback puts it back in IBD, not in the unfiled section it was never in
    await waitFor(() => expect(screen.getByTestId("llm-project")).toHaveTextContent("p1"));
    expect(screen.getByText("Project: IBD")).toBeInTheDocument();
  });

  it("unfiles the open conversation when its project is deleted and its chats are kept", async () => {
    let listed = [wireSession("s1", "IBD fine-mapping", "p1")];
    server.use(
      http.get("*/v1/chat/sessions", () => HttpResponse.json(listed)),
      http.get("*/v1/chat/sessions/:sessionId", ({ params }) =>
        HttpResponse.json({
          ...wireSession(params.sessionId as string, "IBD fine-mapping", "p1"),
          is_owner: true,
          shared: false,
          messages: [],
        }),
      ),
      http.delete("*/v1/projects/p1", () => {
        // the chats survive the project as unfiled conversations
        listed = listed.map((s) => ({ ...s, project_id: null }));
        return HttpResponse.json({ ok: true });
      }),
      ...baseHandlers([wireSession("s1", "IBD fine-mapping", "p1")]),
    );
    renderChatPage("/chat/s1");

    expect(await screen.findByText("Project: IBD")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("llm-project")).toHaveTextContent("p1"));

    fireEvent.click(screen.getByRole("button", { name: "Project menu: IBD" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete project" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep chats" }));

    // the detail still carried the deleted project: the chat surface would keep filing into it
    await waitFor(() => expect(screen.getByTestId("llm-project")).toHaveTextContent("null"));
  });
});
