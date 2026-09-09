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
  onTogglePinSession: vi.fn<(sessionId: string, wasPinned: boolean) => void>(),
  onNewChatInProject: vi.fn<(projectId: string) => void>(),
  onSelectCurrentProject: vi.fn<(projectId: string | null) => void>(),
  onCreateProject: vi.fn<(name: string) => Promise<Project>>(),
  onRenameProject: vi.fn<(projectId: string, name: string) => Promise<void>>().mockResolvedValue(),
  onDeleteProject: vi
    .fn<(projectId: string, withSessions: boolean) => Promise<void>>()
    .mockResolvedValue(),
  onMoveSession: vi
    .fn<(sessionId: string, projectId: string | null) => Promise<void>>()
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
  render(
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
  return spies;
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
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to…" }));
  };

  it("moves an unfiled conversation into a project", async () => {
    const { onMoveSession } = renderSidebar([UNFILED]);
    openRowMenu("APOE and lipids");

    expect(screen.queryByRole("menuitem", { name: "Unfile" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "IBD" }));
    await waitFor(() => expect(onMoveSession).toHaveBeenCalledWith("s-unfiled", "p1"));
  });

  it("unfiles a filed conversation and offers only the other projects", async () => {
    serveProjectSessions({ p1: [FILED] });
    const { onMoveSession } = renderSidebar([FILED]);
    fireEvent.click(screen.getByRole("button", { name: "Project: IBD" }));
    await screen.findByText("IBD fine-mapping");

    openRowMenu("IBD fine-mapping");
    expect(screen.queryByRole("menuitem", { name: "IBD" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Unfile" }));
    await waitFor(() => expect(onMoveSession).toHaveBeenCalledWith("s-filed", null));
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
    await waitFor(() => expect(onMoveSession).toHaveBeenCalledWith("s-unfiled", "p3"));
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
    const { onDeleteProject } = renderSidebar([UNFILED]);
    fireEvent.click(screen.getByRole("button", { name: "Project menu: IBD" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete project" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/will be deleted/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep chats" }));
    await waitFor(() => expect(onDeleteProject).toHaveBeenCalledWith("p1", false));
  });

  it("deletes a project together with its chats on the second choice", async () => {
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
});
