import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import ChatPage from "./ChatPage";

// the chat surface is irrelevant to the header; stubbed out like the other ChatPage tests
vi.mock("./LLMChat", () => ({ LLMChat: () => null }));
vi.mock("../page/McpTokenDialog", () => ({ default: () => null }));
vi.mock("./DatasetsDialog", () => ({ DatasetsDialog: () => null }));
vi.mock("./ToolsDialog", () => ({ ToolsDialog: () => null }));
vi.mock("./SchemaDrawer", () => ({ SchemaDrawer: () => null }));
vi.mock("./SessionRating", () => ({ SessionRating: () => null }));
vi.mock("./FeedbackDialog", () => ({ FeedbackDialog: () => null }));
vi.mock("./AboutDialog", () => ({ AboutDialog: () => null }));
vi.mock("./MemoryDialog", () => ({ MemoryDialog: () => null }));
vi.mock("./schemaApi", () => ({ useSchema: () => ({ data: undefined }) }));

// the flag is read from the build's env at module load, so the mock hands out a getter that
// each test can flip instead of one value fixed for the whole file
const toolsButton = vi.hoisted(() => ({ shown: true }));
vi.mock("../../config/showToolsButton", () => ({
  get SHOW_TOOLS_BUTTON() {
    return toolsButton.shown;
  },
}));

const now = "2026-09-13T00:00:00Z";

// MUI's Tooltip puts its title on the child as aria-label, so a wrapped button is found by its
// tooltip, not its caption
const MOVE_TO = "File this conversation in a project";
const TOOLS = "What the assistant can call";

const wireProject = (id: string, name: string) => ({
  id,
  name,
  created_at: now,
  updated_at: now,
  last_activity_at: now,
  session_count: 0,
});

const session = { id: "s1", title: "APOE and lipids", created_at: now, updated_at: now, project_id: "p1" };

const renderChatPage = () =>
  render(
    <MemoryRouter initialEntries={["/chat/s1"]}>
      <Routes>
        <Route path="/chat/:sessionId" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  toolsButton.shown = true;
  server.use(
    http.get("*/v1/chat/sessions", () => HttpResponse.json([session])),
    http.get("*/v1/projects", () =>
      HttpResponse.json([wireProject("p1", "IBD"), wireProject("p2", "pQTL network")]),
    ),
    http.get("*/v1/projects/:projectId/sessions", () => HttpResponse.json([session])),
    http.get("*/v1/chat/sessions/:sessionId", () =>
      HttpResponse.json({ ...session, is_owner: true, shared: false, messages: [] }),
    ),
  );
});

describe("ChatPage header buttons", () => {
  it("puts Move to… beside Share, outlined like it, and lists the other projects", async () => {
    renderChatPage();

    const share = await screen.findByRole("button", { name: "Share" });
    const moveTo = await screen.findByRole("button", { name: MOVE_TO });
    expect(moveTo).toHaveTextContent("Move to…");
    // Share sits in the popover-anchor span; both share the header's button row
    expect(moveTo.parentElement).toBe(share.parentElement?.parentElement);
    expect(moveTo.className).toContain("MuiButton-outlined");
    expect(share.className).toContain("MuiButton-outlined");

    fireEvent.click(moveTo);
    expect(await screen.findByRole("menuitem", { name: "pQTL network" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "IBD" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "No project" })).toBeInTheDocument();
  });

  it("shows the Tools button unless the build hides it", async () => {
    renderChatPage();
    await screen.findByRole("button", { name: "Share" });
    expect(screen.getByRole("button", { name: TOOLS })).toBeInTheDocument();
  });

  it("hides the Tools button when the build says so", async () => {
    toolsButton.shown = false;
    renderChatPage();
    await screen.findByRole("button", { name: "Share" });
    expect(screen.queryByRole("button", { name: TOOLS })).not.toBeInTheDocument();
  });
});
