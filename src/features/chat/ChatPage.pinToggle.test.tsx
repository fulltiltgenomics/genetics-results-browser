import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import ChatPage from "./ChatPage";

// ChatPage pulls in the full chat surface (LLMChat, schema drawer, token/datasets/tools
// dialogs); none of that is relevant to the pin star, so it is stubbed out to keep this test
// about the star's optimistic-toggle-with-rollback behavior only.
vi.mock("./LLMChat", () => ({ LLMChat: () => null }));
vi.mock("../page/McpTokenDialog", () => ({ default: () => null }));
vi.mock("./DatasetsDialog", () => ({ DatasetsDialog: () => null }));
vi.mock("./ToolsDialog", () => ({ ToolsDialog: () => null }));
vi.mock("./SchemaDrawer", () => ({ SchemaDrawer: () => null }));
vi.mock("./SessionRating", () => ({ SessionRating: () => null }));
vi.mock("./FeedbackDialog", () => ({ FeedbackDialog: () => null }));
vi.mock("./AboutDialog", () => ({ AboutDialog: () => null }));
vi.mock("./schemaApi", () => ({ useSchema: () => ({ data: undefined }) }));

const listSessions = vi.fn();
const getSession = vi.fn();
const pinSession = vi.fn();

vi.mock("./chatHistoryApi", async () => {
  const actual = await vi.importActual<typeof import("./chatHistoryApi")>("./chatHistoryApi");
  return {
    ...actual,
    listSessions: (...args: unknown[]) => listSessions(...args),
    getSession: (...args: unknown[]) => getSession(...args),
    pinSession: (...args: unknown[]) => pinSession(...args),
  };
});

const SESSION = {
  id: "s1",
  title: "APOE and lipids",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  pinned: false,
};

const SESSION_DETAIL = {
  ...SESSION,
  rating: undefined,
  comment: undefined,
  phenotypeCode: undefined,
  isOwner: true,
  shared: false,
  messages: [],
};

const renderChatPage = async () => {
  render(
    <MemoryRouter initialEntries={["/chat/s1"]}>
      <Routes>
        <Route path="/chat/:sessionId" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  listSessions.mockReset();
  getSession.mockReset();
  pinSession.mockReset();
  listSessions.mockResolvedValue([SESSION]);
  getSession.mockResolvedValue(SESSION_DETAIL);
});

describe("ChatPage pin star", () => {
  it("optimistically pins, then reflects the toggle once the request resolves", async () => {
    pinSession.mockResolvedValue(undefined);
    await renderChatPage();

    const star = await screen.findByRole("button", { name: "pin" });
    fireEvent.click(star);

    // optimistic: the icon flips before the request settles
    expect(await screen.findByRole("button", { name: "unpin" })).toBeInTheDocument();
    await waitFor(() => expect(pinSession).toHaveBeenCalledWith("s1", true));
  });

  it("rolls back the star on a failed pin request", async () => {
    pinSession.mockRejectedValue(new Error("HTTP 404"));
    await renderChatPage();

    const star = await screen.findByRole("button", { name: "pin" });
    fireEvent.click(star);

    await waitFor(() => expect(pinSession).toHaveBeenCalledWith("s1", true));
    expect(await screen.findByRole("button", { name: "pin" })).toBeInTheDocument();
  });

  it("shows no star and no session yet when no chat has been started", async () => {
    listSessions.mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <Routes>
          <Route path="/chat" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "New Chat" });
    expect(screen.queryByRole("button", { name: "pin" })).not.toBeInTheDocument();
  });

  it("hides the star (and Share) for an actual secret chat", async () => {
    listSessions.mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <Routes>
          <Route path="/chat" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Secret Chat" }));

    // the "Not Saved" chip only renders once isSecretChat flips true
    await screen.findByText("Not Saved");
    expect(screen.queryByRole("button", { name: "pin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "unpin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
  });
});
