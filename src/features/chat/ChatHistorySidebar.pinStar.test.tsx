import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { ChatHistorySidebar } from "./ChatHistorySidebar";
import type { ChatSession } from "./chatHistoryApi";
import type { Project } from "./chat.types";

const now = new Date().toISOString();

const PROJECT: Project = {
  id: "p1",
  name: "IBD",
  createdAt: now,
  updatedAt: now,
  lastActivityAt: now,
};

const baseSession: ChatSession = {
  id: "s1",
  title: "APOE and lipids",
  createdAt: now,
  updatedAt: now,
  projectId: "p1",
};

type TogglePin = (sessionId: string, wasPinned: boolean) => void | Promise<void>;

const renderSidebar = (sessions: ChatSession[]) => {
  // a project section reads its rows from the per-project endpoint; the live list is merged in
  server.use(http.get("*/v1/projects/p1/sessions", () => HttpResponse.json([])));
  const onTogglePinSession = vi.fn<TogglePin>();
  const onSelectSession = vi.fn<(sessionId: string) => void>();
  render(
    <ChatHistorySidebar
      sessions={sessions}
      activeSessionId={null}
      onSelectSession={onSelectSession}
      onNewChat={vi.fn()}
      onNewSecretChat={vi.fn()}
      onDeleteSession={vi.fn()}
      onTogglePinSession={onTogglePinSession}
      loading={false}
      projects={[PROJECT]}
    />,
  );
  return { onTogglePinSession, onSelectSession };
};

const openProject = async (title: string) => {
  fireEvent.click(screen.getByRole("button", { name: "Project: IBD" }));
  return screen.findByText(title);
};

describe("ChatHistorySidebar pin star", () => {
  it("shows a standing indicator for a pinned conversation without hovering", async () => {
    renderSidebar([{ ...baseSession, pinned: true }]);
    await openProject("APOE and lipids");
    expect(screen.getByRole("button", { name: "unpin conversation: APOE and lipids" })).toBeInTheDocument();
  });

  it("reveals the pin action on hover for an unpinned conversation", async () => {
    renderSidebar([{ ...baseSession, pinned: false }]);
    const row = await openProject("APOE and lipids");
    expect(screen.queryByRole("button", { name: "pin conversation: APOE and lipids" })).not.toBeInTheDocument();

    fireEvent.mouseEnter(row);
    expect(screen.getByRole("button", { name: "pin conversation: APOE and lipids" })).toBeInTheDocument();
  });

  it("offers no star on an unfiled conversation, pinned or not", () => {
    renderSidebar([
      { ...baseSession, projectId: null, pinned: true },
      { ...baseSession, id: "s2", title: "Older unfiled", projectId: null },
    ]);
    expect(screen.queryByRole("button", { name: /pin conversation: APOE and lipids/ })).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByText("Older unfiled"));
    expect(screen.queryByRole("button", { name: /pin conversation: Older unfiled/ })).not.toBeInTheDocument();
    // the row's other actions are still there
    expect(screen.getByRole("button", { name: "delete conversation: Older unfiled" })).toBeInTheDocument();
  });

  it("treats a missing pinned field as unpinned", async () => {
    renderSidebar([baseSession]);
    fireEvent.mouseEnter(await openProject("APOE and lipids"));
    expect(screen.getByRole("button", { name: "pin conversation: APOE and lipids" })).toBeInTheDocument();
  });

  it("calls onTogglePinSession with the current pinned state and does not select the session", async () => {
    const { onTogglePinSession, onSelectSession } = renderSidebar([{ ...baseSession, pinned: true }]);
    await openProject("APOE and lipids");

    fireEvent.click(screen.getByRole("button", { name: "unpin conversation: APOE and lipids" }));
    expect(onTogglePinSession).toHaveBeenCalledWith("s1", true);
    expect(onSelectSession).not.toHaveBeenCalled();
  });
});
