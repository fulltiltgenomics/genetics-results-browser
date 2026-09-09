import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ChatHistorySidebar } from "./ChatHistorySidebar";
import type { ChatSession } from "./chatHistoryApi";

const baseSession: ChatSession = {
  id: "s1",
  title: "APOE and lipids",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const renderSidebar = (sessions: ChatSession[], onTogglePinSession = vi.fn()) => {
  render(
    <ChatHistorySidebar
      sessions={sessions}
      activeSessionId={null}
      onSelectSession={vi.fn()}
      onNewChat={vi.fn()}
      onNewSecretChat={vi.fn()}
      onDeleteSession={vi.fn()}
      onTogglePinSession={onTogglePinSession}
      loading={false}
    />,
  );
  return onTogglePinSession;
};

describe("ChatHistorySidebar pin star", () => {
  it("shows a standing indicator for a pinned conversation without hovering", () => {
    renderSidebar([{ ...baseSession, pinned: true }]);
    expect(screen.getByRole("button", { name: "unpin conversation: APOE and lipids" })).toBeInTheDocument();
  });

  it("reveals the pin action on hover for an unpinned conversation", () => {
    renderSidebar([{ ...baseSession, pinned: false }]);
    expect(screen.queryByRole("button", { name: "pin conversation: APOE and lipids" })).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByText("APOE and lipids"));
    expect(screen.getByRole("button", { name: "pin conversation: APOE and lipids" })).toBeInTheDocument();
  });

  it("treats a missing pinned field as unpinned", () => {
    renderSidebar([baseSession]);
    fireEvent.mouseEnter(screen.getByText("APOE and lipids"));
    expect(screen.getByRole("button", { name: "pin conversation: APOE and lipids" })).toBeInTheDocument();
  });

  it("calls onTogglePinSession with the current pinned state and does not select the session", () => {
    const onSelectSession = vi.fn();
    const onTogglePinSession = vi.fn();
    render(
      <ChatHistorySidebar
        sessions={[{ ...baseSession, pinned: true }]}
        activeSessionId={null}
        onSelectSession={onSelectSession}
        onNewChat={vi.fn()}
        onNewSecretChat={vi.fn()}
        onDeleteSession={vi.fn()}
        onTogglePinSession={onTogglePinSession}
        loading={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "unpin conversation: APOE and lipids" }));
    expect(onTogglePinSession).toHaveBeenCalledWith("s1", true);
    expect(onSelectSession).not.toHaveBeenCalled();
  });
});
