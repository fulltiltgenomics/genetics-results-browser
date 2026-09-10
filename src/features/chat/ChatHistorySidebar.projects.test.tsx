import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { ChatHistorySidebar } from "./ChatHistorySidebar";
import { ProjectApiError } from "./projectsApi";
import type { ChatSession } from "./chatHistoryApi";
import type { Project } from "./chat.types";

const now = new Date().toISOString();

const project = (id: string, name: string): Project => ({
  id,
  name,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  lastActivityAt: now,
});

const PROJECTS = [project("p1", "IBD"), project("p2", "pQTL network")];

const UNFILED: ChatSession = {
  id: "s-unfiled",
  title: "APOE and lipids",
  createdAt: now,
  updatedAt: now,
  projectId: null,
};

const FILED: ChatSession = {
  id: "s-filed",
  title: "IBD fine-mapping",
  createdAt: now,
  updatedAt: now,
  projectId: "p1",
};

const makeSpies = () => ({
  onSelectSession: vi.fn<(sessionId: string) => void>(),
  onDeleteSession: vi.fn<(sessionId: string) => void | Promise<void>>(),
  onTogglePinSession: vi.fn<(sessionId: string, wasPinned: boolean) => void | Promise<void>>(),
  onNewChatInProject: vi.fn<(projectId: string) => void>(),
  onSelectCurrentProject: vi.fn<(projectId: string | null) => void>(),
  onCreateProject: vi.fn<(name: string) => Promise<Project>>(),
  onRenameProject: vi.fn<(projectId: string, name: string) => Promise<void>>().mockResolvedValue(),
  onDeleteProject: vi
    .fn<(projectId: string, withSessions: boolean) => Promise<void>>()
    .mockResolvedValue(),
  onMoveSession: vi
    .fn<
      (sessionId: string, projectId: string | null, previous: string | null) => Promise<void>
    >()
    .mockResolvedValue(),
  onOpenProjectMemory: vi.fn<(projectId: string) => void>(),
});

type Handlers = Partial<ReturnType<typeof makeSpies>>;

const renderSidebar = (
  sessions: ChatSession[],
  handlers: Handlers = {},
  extra: { isSecretChat?: boolean; currentProjectId?: string | null; projects?: Project[] } = {},
) => {
  const spies = { ...makeSpies(), ...handlers };
  const { container } = render(
    <ChatHistorySidebar
      sessions={sessions}
      activeSessionId={null}
      onNewChat={vi.fn()}
      onNewSecretChat={vi.fn()}
      loading={false}
      projects={extra.projects ?? PROJECTS}
      currentProjectId={extra.currentProjectId ?? null}
      isSecretChat={extra.isSecretChat ?? false}
      {...spies}
    />,
  );
  return { ...spies, container };
};

/** jsdom has no DataTransfer at all, so this is a stand-in rather than a patch — it
 * round-trips the payload the way a real browser's would (Firefox in particular refuses
 * to start a drag at all unless setData was called). */
const makeDataTransfer = () => {
  const store: Record<string, string> = {};
  return {
    setData: vi.fn((type: string, value: string) => {
      store[type] = value;
    }),
    getData: vi.fn((type: string) => store[type] ?? ""),
    effectAllowed: "",
    dropEffect: "",
  } as unknown as DataTransfer;
};

const serveProjectSessions = (byProject: Record<string, ChatSession[]>) =>
  server.use(
    http.get("*/v1/projects/:projectId/sessions", ({ params }) =>
      HttpResponse.json(
        (byProject[params.projectId as string] ?? []).map((s) => ({
          id: s.id,
          title: s.title,
          created_at: s.createdAt,
          updated_at: s.updatedAt,
          project_id: s.projectId,
        })),
      ),
    ),
  );

describe("ChatHistorySidebar project sections", () => {
  it("renders one section per project in the order given, above the unfiled conversations", () => {
    renderSidebar([UNFILED]);

    const headers = screen.getAllByRole("button", { name: /^Project: / });
    expect(headers.map((h) => h.textContent)).toEqual(["IBD", "pQTL network"]);
    expect(screen.getByText("Unfiled")).toBeInTheDocument();
    // the unfiled list keeps its date grouping
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("APOE and lipids")).toBeInTheDocument();
  });

  it("keeps a filed conversation out of the unfiled list", () => {
    renderSidebar([UNFILED, FILED]);
    // collapsed section: the filed chat is not on screen at all
    expect(screen.queryByText("IBD fine-mapping")).not.toBeInTheDocument();
    expect(screen.getByText("APOE and lipids")).toBeInTheDocument();
  });

  it("loads a project's conversations lazily, on the first expand", async () => {
    let calls = 0;
    server.use(
      http.get("*/v1/projects/p1/sessions", () => {
        calls += 1;
        return HttpResponse.json([
          { id: "s-old", title: "Older IBD chat", created_at: now, updated_at: now, project_id: "p1" },
        ]);
      }),
    );
    renderSidebar([UNFILED]);

    expect(calls).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Project: IBD" }));
    expect(await screen.findByText("Older IBD chat")).toBeInTheDocument();
    expect(calls).toBe(1);

    // collapsing and re-expanding reuses the cached list
    fireEvent.click(screen.getByRole("button", { name: "Project: IBD" }));
    fireEvent.click(screen.getByRole("button", { name: "Project: IBD" }));
    await waitFor(() => expect(screen.getByText("Older IBD chat")).toBeInTheDocument());
    expect(calls).toBe(1);
  });

  it("starts a new chat in the project the '+' belongs to", () => {
    const { onNewChatInProject } = renderSidebar([UNFILED]);
    fireEvent.click(screen.getByRole("button", { name: "New chat in pQTL network" }));
    expect(onNewChatInProject).toHaveBeenCalledWith("p2");
  });

  it("picks the project the next new chat lands in", () => {
    const { onSelectCurrentProject } = renderSidebar([UNFILED], {}, { currentProjectId: "p1" });
    expect(screen.getByText("Project: IBD")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Choose project for new chat" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "No project" }));
    expect(onSelectCurrentProject).toHaveBeenCalledWith(null);
  });

  it("hides the filing caption for a secret chat", () => {
    renderSidebar([UNFILED], {}, { isSecretChat: true, currentProjectId: "p1" });
    expect(screen.queryByText("Project: IBD")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Choose project for new chat" }),
    ).not.toBeInTheDocument();
  });
});

describe("ChatHistorySidebar filing a conversation", () => {
  const openRowMenu = (title: string) => {
    fireEvent.mouseEnter(screen.getByText(title));
    fireEvent.click(screen.getByRole("button", { name: `conversation menu: ${title}` }));
  };

  it("moves an unfiled conversation into a project", async () => {
    const { onMoveSession } = renderSidebar([UNFILED]);
    openRowMenu("APOE and lipids");

    expect(screen.queryByRole("menuitem", { name: "Unfile" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "IBD" }));
    await waitFor(() => expect(onMoveSession).toHaveBeenCalledWith("s-unfiled", "p1", null));
  });

  it("unfiles a filed conversation and offers only the other projects", async () => {
    serveProjectSessions({ p1: [FILED] });
    const { onMoveSession } = renderSidebar([FILED]);
    fireEvent.click(screen.getByRole("button", { name: "Project: IBD" }));
    await screen.findByText("IBD fine-mapping");

    openRowMenu("IBD fine-mapping");
    expect(screen.queryByRole("menuitem", { name: "IBD" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Unfile" }));
    await waitFor(() => expect(onMoveSession).toHaveBeenCalledWith("s-filed", null, "p1"));
  });

  it("creates the destination project from inside the move menu, then files into it", async () => {
    const created = project("p3", "Metabolomics");
    const onCreateProject = vi.fn().mockResolvedValue(created);
    const { onMoveSession } = renderSidebar([UNFILED], { onCreateProject });
    openRowMenu("APOE and lipids");

    fireEvent.click(screen.getByRole("menuitem", { name: "New project…" }));
    const field = screen.getByLabelText("New project name for move");
    fireEvent.change(field, { target: { value: "Metabolomics" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(onCreateProject).toHaveBeenCalledWith("Metabolomics"));
    await waitFor(() => expect(onMoveSession).toHaveBeenCalledWith("s-unfiled", "p3", null));
  });
});

describe("ChatHistorySidebar project management", () => {
  it("creates a project from the inline field, with no dialog", async () => {
    const onCreateProject = vi.fn().mockResolvedValue(project("p3", "Metabolomics"));
    renderSidebar([UNFILED], { onCreateProject });

    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    const field = screen.getByLabelText("New project name");
    fireEvent.change(field, { target: { value: "Metabolomics" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(onCreateProject).toHaveBeenCalledWith("Metabolomics"));
    await waitFor(() =>
      expect(screen.queryByLabelText("New project name")).not.toBeInTheDocument(),
    );
  });

  it("shows the server's cap message inline and keeps the field open", async () => {
    const onCreateProject = vi
      .fn()
      .mockRejectedValue(new ProjectApiError(400, "At most 20 projects per user"));
    renderSidebar([UNFILED], { onCreateProject });

    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    const field = screen.getByLabelText("New project name");
    fireEvent.change(field, { target: { value: "Metabolomics" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(await screen.findByText("At most 20 projects per user")).toBeInTheDocument();
    expect(screen.getByLabelText("New project name")).toBeInTheDocument();
  });

  it("renames a project inline from its header menu", async () => {
    const { onRenameProject } = renderSidebar([UNFILED]);
    fireEvent.click(screen.getByRole("button", { name: "Project menu: IBD" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const field = screen.getByLabelText("Rename project: IBD");
    fireEvent.change(field, { target: { value: "IBD genetics" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(onRenameProject).toHaveBeenCalledWith("p1", "IBD genetics"));
  });

  it("opens the project's memory from its header menu", () => {
    const { onOpenProjectMemory } = renderSidebar([UNFILED]);
    fireEvent.click(screen.getByRole("button", { name: "Project menu: IBD" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Project memory" }));
    expect(onOpenProjectMemory).toHaveBeenCalledWith("p1");
  });

  it("deletes a project in two steps, keeping its chats", async () => {
    serveProjectSessions({});
    const { onDeleteProject } = renderSidebar([UNFILED]);
    fireEvent.click(screen.getByRole("button", { name: "Project menu: IBD" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete project" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/will be deleted/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep chats" }));
    await waitFor(() => expect(onDeleteProject).toHaveBeenCalledWith("p1", false));
  });

  it("deletes a project together with its chats on the second choice", async () => {
    serveProjectSessions({});
    const { onDeleteProject } = renderSidebar([UNFILED]);
    fireEvent.click(screen.getByRole("button", { name: "Project menu: IBD" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete project" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete chats too" }));
    await waitFor(() => expect(onDeleteProject).toHaveBeenCalledWith("p1", true));
  });
});

describe("ChatHistorySidebar cached project rows", () => {
  const CACHED = { id: "s-old", title: "Older IBD chat", created_at: now, updated_at: now, project_id: "p1" };

  it("drops a deleted conversation the cache is the only source of", async () => {
    let stored = [CACHED];
    server.use(http.get("*/v1/projects/p1/sessions", () => HttpResponse.json(stored)));
    const onDeleteSession = vi.fn(async (sessionId: string) => {
      stored = stored.filter((s) => s.id !== sessionId);
    });
    renderSidebar([UNFILED], { onDeleteSession });

    fireEvent.click(screen.getByRole("button", { name: "Project: IBD" }));
    fireEvent.mouseEnter(await screen.findByText("Older IBD chat"));
    fireEvent.click(screen.getByRole("button", { name: "delete conversation: Older IBD chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDeleteSession).toHaveBeenCalledWith("s-old"));
    await waitFor(() => expect(screen.queryByText("Older IBD chat")).not.toBeInTheDocument());
  });

  it("moves the star on a conversation only the cache knows about", async () => {
    server.use(http.get("*/v1/projects/p1/sessions", () => HttpResponse.json([CACHED])));
    const { onTogglePinSession } = renderSidebar([UNFILED]);

    fireEvent.click(screen.getByRole("button", { name: "Project: IBD" }));
    fireEvent.mouseEnter(await screen.findByText("Older IBD chat"));
    fireEvent.click(screen.getByRole("button", { name: "pin conversation: Older IBD chat" }));

    expect(onTogglePinSession).toHaveBeenCalledWith("s-old", false);
    expect(
      await screen.findByRole("button", { name: "unpin conversation: Older IBD chat" }),
    ).toBeInTheDocument();
  });
});

describe("ChatHistorySidebar project errors", () => {
  it("shows a failed rename at the rename field, and never under the next field", async () => {
    const onRenameProject = vi
      .fn()
      .mockRejectedValue(new ProjectApiError(409, "A project with that name exists"));
    renderSidebar([UNFILED], { onRenameProject });

    fireEvent.click(screen.getByRole("button", { name: "Project menu: IBD" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(screen.getByText("Enter to save, Esc to cancel")).toBeInTheDocument();

    const field = screen.getByLabelText("Rename project: IBD");
    fireEvent.change(field, { target: { value: "IBD genetics" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(await screen.findByText("A project with that name exists")).toBeInTheDocument();
    // the field stays open on failure, and Esc leaves nothing behind
    fireEvent.keyDown(screen.getByLabelText("Rename project: IBD"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.queryByText("A project with that name exists")).not.toBeInTheDocument();
  });

  it("keeps the delete dialog open and says why the delete failed", async () => {
    serveProjectSessions({});
    const onDeleteProject = vi.fn().mockRejectedValue(new ProjectApiError(500, "Server error"));
    renderSidebar([UNFILED], { onDeleteProject });

    fireEvent.click(screen.getByRole("button", { name: "Project menu: IBD" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete project" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep chats" }));

    expect(await screen.findByText("Server error")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("counts the chats in the delete dialog once the project's list is known", async () => {
    serveProjectSessions({ p1: [FILED] });
    renderSidebar([UNFILED]);

    fireEvent.click(screen.getByRole("button", { name: "Project: IBD" }));
    await screen.findByText("IBD fine-mapping");
    fireEvent.click(screen.getByRole("button", { name: "Project menu: IBD" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete project" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Its 1 chat can be kept/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Deleting them is permanent/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Delete 1 chat too" })).toBeInTheDocument();
  });

  it("counts the chats of a collapsed project when the delete dialog opens", async () => {
    serveProjectSessions({ p1: [FILED] });
    renderSidebar([UNFILED]);

    // the section is never expanded: the dialog has to fetch the list itself
    fireEvent.click(screen.getByRole("button", { name: "Project menu: IBD" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete project" }));

    expect(await screen.findByText(/Its 1 chat can be kept/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete 1 chat too" })).toBeInTheDocument();
  });

  it("says a project has no chats once an empty list is known", async () => {
    serveProjectSessions({ p1: [] });
    renderSidebar([UNFILED]);

    fireEvent.click(screen.getByRole("button", { name: "Project menu: IBD" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete project" }));

    expect(await screen.findByText(/It has no chats/)).toBeInTheDocument();
  });

  it("collapses to Cancel / Delete when the project has no chats to keep", async () => {
    serveProjectSessions({ p1: [] });
    renderSidebar([UNFILED]);

    fireEvent.click(screen.getByRole("button", { name: "Project menu: IBD" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete project" }));

    await screen.findByText(/It has no chats/);
    expect(screen.queryByRole("button", { name: "Keep chats" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("puts the star back when pinning a cached conversation fails", async () => {
    const CACHED = { id: "s-old", title: "Older IBD chat", created_at: now, updated_at: now, project_id: "p1" };
    server.use(http.get("*/v1/projects/p1/sessions", () => HttpResponse.json([CACHED])));
    let fail: (err: Error) => void = () => {};
    const onTogglePinSession = vi.fn(
      () => new Promise<void>((_resolve, reject) => (fail = reject)),
    );
    renderSidebar([UNFILED], { onTogglePinSession });

    fireEvent.click(screen.getByRole("button", { name: "Project: IBD" }));
    fireEvent.mouseEnter(await screen.findByText("Older IBD chat"));
    fireEvent.click(screen.getByRole("button", { name: "pin conversation: Older IBD chat" }));

    // optimistic while the request is in flight, back to unpinned when it fails
    expect(
      await screen.findByRole("button", { name: "unpin conversation: Older IBD chat" }),
    ).toBeInTheDocument();
    fail(new Error("nope"));
    expect(
      await screen.findByRole("button", { name: "pin conversation: Older IBD chat" }),
    ).toBeInTheDocument();
  });
});

describe("ChatHistorySidebar drag and drop filing", () => {
  const projectSection = (container: HTMLElement, id: string) =>
    container.querySelector(`[data-project-id="${id}"]`) as HTMLElement;
  const unfiledSection = (container: HTMLElement) =>
    container.querySelector('[data-unfiled-section="true"]') as HTMLElement;

  it("files a conversation dropped on another project's section", async () => {
    const { onMoveSession, container } = renderSidebar([UNFILED]);

    fireEvent.dragStart(screen.getByText("APOE and lipids"));
    const target = projectSection(container, "p2");
    fireEvent.dragOver(target);
    expect(target).toHaveAttribute("data-drop-active", "true");

    fireEvent.drop(target);
    await waitFor(() => expect(onMoveSession).toHaveBeenCalledWith("s-unfiled", "p2", null));
    // the affordance clears with the drop
    expect(target).not.toHaveAttribute("data-drop-active");
  });

  it("drops on a collapsed section, and clears the affordance on drag leave", () => {
    const { onMoveSession, container } = renderSidebar([UNFILED]);

    fireEvent.dragStart(screen.getByText("APOE and lipids"));
    const target = projectSection(container, "p1");
    // collapsed: the section shows nothing but its header
    expect(screen.queryByText("No chats in this project yet")).not.toBeInTheDocument();
    fireEvent.dragOver(target);
    expect(target).toHaveAttribute("data-drop-active", "true");
    fireEvent.dragLeave(target);
    expect(target).not.toHaveAttribute("data-drop-active");

    fireEvent.dragOver(target);
    fireEvent.drop(target);
    expect(onMoveSession).toHaveBeenCalledWith("s-unfiled", "p1", null);
  });

  it("unfiles a conversation dropped on the unfiled section", async () => {
    serveProjectSessions({ p1: [FILED] });
    const { onMoveSession, container } = renderSidebar([FILED]);
    fireEvent.click(screen.getByRole("button", { name: "Project: IBD" }));
    const row = await screen.findByText("IBD fine-mapping");

    // everything is filed, so the unfiled section only appears as a drop target
    expect(screen.queryByText("Unfiled")).not.toBeInTheDocument();
    fireEvent.dragStart(row);
    expect(screen.getByText("Unfiled")).toBeInTheDocument();
    expect(screen.getByText("Drop here to unfile")).toBeInTheDocument();

    fireEvent.drop(unfiledSection(container));
    await waitFor(() => expect(onMoveSession).toHaveBeenCalledWith("s-filed", null, "p1"));
  });

  it("ignores a drop on the section the conversation already sits in", async () => {
    serveProjectSessions({ p1: [FILED] });
    const { onMoveSession, container } = renderSidebar([FILED]);
    fireEvent.click(screen.getByRole("button", { name: "Project: IBD" }));
    fireEvent.dragStart(await screen.findByText("IBD fine-mapping"));

    const target = projectSection(container, "p1");
    fireEvent.dragOver(target);
    expect(target).not.toHaveAttribute("data-drop-active");
    fireEvent.drop(target);
    expect(onMoveSession).not.toHaveBeenCalled();
  });

  it("offers no drag handle when the sidebar has no filing surface", () => {
    render(
      <ChatHistorySidebar
        sessions={[UNFILED]}
        activeSessionId={null}
        onSelectSession={vi.fn()}
        onNewChat={vi.fn()}
        onNewSecretChat={vi.fn()}
        onDeleteSession={vi.fn()}
        onTogglePinSession={vi.fn()}
        loading={false}
      />,
    );
    expect(screen.getByText("APOE and lipids").closest("li")).not.toHaveAttribute(
      "draggable",
      "true",
    );
  });

  it("offers no drag handle when there are no projects to drop into", () => {
    renderSidebar([UNFILED], {}, { projects: [] });
    expect(screen.getByText("APOE and lipids").closest("li")).not.toHaveAttribute(
      "draggable",
      "true",
    );
  });

  it("stubs the drag payload and reads it back on drop", async () => {
    const dataTransfer = makeDataTransfer();
    const { onMoveSession, container } = renderSidebar([UNFILED]);

    fireEvent.dragStart(screen.getByText("APOE and lipids"), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith("application/x-chat-session", "s-unfiled");
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "APOE and lipids");

    const target = projectSection(container, "p2");
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() => expect(onMoveSession).toHaveBeenCalledWith("s-unfiled", "p2", null));
  });

  it("falls back to the dataTransfer payload when draggingId state is absent", async () => {
    const dataTransfer = makeDataTransfer();
    dataTransfer.setData("application/x-chat-session", "s-unfiled");
    const { onMoveSession, container } = renderSidebar([UNFILED]);

    // no dragStart in this render: draggingId never gets set, only the transfer carries the id
    const target = projectSection(container, "p2");
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() => expect(onMoveSession).toHaveBeenCalledWith("s-unfiled", "p2", null));
  });

  it("does not clear the drop affordance when the pointer moves between an expanded section's own rows", async () => {
    serveProjectSessions({ p2: [] });
    const { container } = renderSidebar([UNFILED]);
    fireEvent.click(screen.getByRole("button", { name: "Project: pQTL network" }));
    const innerRow = await screen.findByText("No chats in this project yet");

    fireEvent.dragStart(screen.getByText("APOE and lipids"));
    const target = projectSection(container, "p2");
    fireEvent.dragOver(target);
    expect(target).toHaveAttribute("data-drop-active", "true");

    // jsdom has no DragEvent (github.com/jsdom/jsdom/issues/1568), so fireEvent.dragLeave's
    // init drops `relatedTarget`; MouseEvent, which DragEvent extends, keeps it
    fireEvent(
      target,
      new MouseEvent("dragleave", { bubbles: true, cancelable: false, relatedTarget: innerRow }),
    );
    expect(target).toHaveAttribute("data-drop-active", "true");

    fireEvent(
      target,
      new MouseEvent("dragleave", {
        bubbles: true,
        cancelable: false,
        relatedTarget: document.body,
      }),
    );
    expect(target).not.toHaveAttribute("data-drop-active");
  });

  it("clears a stray draggingId when the dragged row unmounts mid-drag", async () => {
    const spies = makeSpies();
    const { rerender } = render(
      <ChatHistorySidebar
        sessions={[UNFILED]}
        activeSessionId={null}
        onNewChat={vi.fn()}
        onNewSecretChat={vi.fn()}
        loading={false}
        projects={PROJECTS}
        {...spies}
      />,
    );

    fireEvent.dragStart(screen.getByText("APOE and lipids"));
    expect(screen.getByText("Unfiled")).toBeInTheDocument();

    // the row disappears from the session list without a matching dragend
    rerender(
      <ChatHistorySidebar
        sessions={[]}
        activeSessionId={null}
        onNewChat={vi.fn()}
        onNewSecretChat={vi.fn()}
        loading={false}
        projects={PROJECTS}
        {...spies}
      />,
    );

    await waitFor(() => expect(screen.queryByText("Unfiled")).not.toBeInTheDocument());
  });
});

describe("ChatHistorySidebar keyboard access to row actions", () => {
  it("reveals a row's actions on focus, not only on hover", () => {
    renderSidebar([UNFILED]);
    expect(
      screen.queryByRole("button", { name: "conversation menu: APOE and lipids" }),
    ).not.toBeInTheDocument();

    const row = screen.getByText("APOE and lipids").closest("li")!;
    fireEvent.focusIn(row);
    expect(
      screen.getByRole("button", { name: "conversation menu: APOE and lipids" }),
    ).toBeInTheDocument();

    fireEvent.focusOut(row, { relatedTarget: document.body });
    expect(
      screen.queryByRole("button", { name: "conversation menu: APOE and lipids" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a row revealed while its own menu is open, even though the menu portals outside the row", () => {
    renderSidebar([UNFILED]);
    const row = screen.getByText("APOE and lipids").closest("li")!;
    fireEvent.focusIn(row);

    const menuButton = screen.getByRole("button", { name: "conversation menu: APOE and lipids" });
    fireEvent.click(menuButton);

    // MUI portals the menu and autofocuses its list, so the row itself sees a focusout
    // with a relatedTarget outside it — the same shape a real click on the "⋯" produces.
    // MUI also marks the rest of the page aria-hidden while its modal is open, so this
    // assertion must reach past that with `hidden: true` — the point under test is that
    // the anchor button stays mounted (and thus a valid anchorEl), not that it stays
    // exposed to the accessibility tree while its own menu owns focus.
    fireEvent.focusOut(row, { relatedTarget: document.body });
    expect(
      screen.getByRole("button", { name: "conversation menu: APOE and lipids", hidden: true }),
    ).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.focusOut(row, { relatedTarget: document.body });
    expect(
      screen.queryByRole("button", { name: "conversation menu: APOE and lipids" }),
    ).not.toBeInTheDocument();
  });
});
