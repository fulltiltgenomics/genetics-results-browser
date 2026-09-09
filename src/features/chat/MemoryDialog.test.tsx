import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { MemoryDialog, MEMORY_NOTICE_SEEN_KEY } from "./MemoryDialog";

const PROJECT_MEMORY = {
  enabled: true,
  digest: "Earlier: asked about APOE and lipid traits.",
  sessions: [
    { id: "s1", title: "APOE and lipids", pinned: false, created_at: "2026-01-01T00:00:00Z" },
  ],
  char_cap: 4000,
};

const renderGlobal = (onClose = vi.fn()) =>
  render(
    <MemoryRouter>
      <MemoryDialog open onClose={onClose} projectId={null} />
    </MemoryRouter>,
  );

const renderProject = (projectId = "proj-1", onClose = vi.fn()) =>
  render(
    <MemoryRouter>
      <MemoryDialog open onClose={onClose} projectId={projectId} />
    </MemoryRouter>,
  );

// GET /v1/llm-config/user/settings serves every key at once, keyed by name
const serveSettings = (chatMemory: "on" | "off") =>
  server.use(
    http.get("*/v1/llm-config/user/settings", () =>
      HttpResponse.json({ chat_memory: { setting_value: chatMemory } }),
    ),
  );

const serveSessions = (sessions: Array<{ id: string; project_id: string | null }>) =>
  server.use(
    http.get("*/v1/chat/sessions", () =>
      HttpResponse.json(
        sessions.map((s) => ({
          id: s.id,
          title: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          project_id: s.project_id,
        })),
      ),
    ),
  );

const serveProjectMemory = (body: Record<string, unknown> = PROJECT_MEMORY, status = 200) =>
  server.use(
    http.get("*/v1/projects/proj-1/memory", () => HttpResponse.json(body, { status })),
  );

beforeEach(() => {
  localStorage.clear();
});

describe("MemoryDialog global view", () => {
  it("shows the off-state notice and writes the setting when turned on", async () => {
    serveSettings("off");
    let settingBody: unknown = null;
    server.use(
      http.put("*/v1/llm-config/user/settings/chat_memory", async ({ request }) => {
        settingBody = await request.json();
        return HttpResponse.json({ setting_value: "on" });
      }),
    );

    renderGlobal();

    expect(await screen.findByText(/index of your earlier conversations/)).toBeInTheDocument();
    expect(screen.getByText(/never includes tool results, plots, downloads/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Turn on memory" }));

    await waitFor(() => expect(settingBody).toEqual({ setting_value: "on" }));
    expect(await screen.findByText("Memory is on")).toBeInTheDocument();
  });

  it("points at projects with the sidebar phrasing once >= 3 chats are unfiled", async () => {
    serveSettings("on");
    serveSessions([
      { id: "s1", project_id: null },
      { id: "s2", project_id: null },
      { id: "s3", project_id: null },
      { id: "s4", project_id: "proj-1" },
    ]);

    renderGlobal();

    expect(
      await screen.findByText("Memory works inside projects — create one from the sidebar"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/index of your earlier conversations/)).not.toBeInTheDocument();
    expect(screen.queryByText("Earlier: asked about APOE and lipid traits.")).not.toBeInTheDocument();
  });

  it("shows a shorter pointer under the unfiled-chat threshold", async () => {
    serveSettings("on");
    serveSessions([{ id: "s1", project_id: null }]);

    renderGlobal();

    expect(await screen.findByText("Memory works inside projects.")).toBeInTheDocument();
    expect(
      screen.queryByText("Memory works inside projects — create one from the sidebar"),
    ).not.toBeInTheDocument();
  });

  it("shows the first-open notice once, then not on a later open", async () => {
    serveSettings("off");

    const { unmount } = renderGlobal();
    expect(await screen.findByText(/index of your earlier conversations/)).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(MEMORY_NOTICE_SEEN_KEY)).toBe("1"));
    unmount();

    renderGlobal();
    await screen.findByRole("button", { name: "Turn on memory" });
    expect(screen.queryByText(/index of your earlier conversations/)).not.toBeInTheDocument();
  });

  it("does not mark the notice seen for an already-enabled user", async () => {
    serveSettings("on");
    serveSessions([]);

    renderGlobal();

    await screen.findByText("Memory is on");
    expect(localStorage.getItem(MEMORY_NOTICE_SEEN_KEY)).toBeNull();
  });

  it("loads the unfiled count right after opting in, so the sidebar pointer can appear", async () => {
    serveSettings("off");
    server.use(
      http.put("*/v1/llm-config/user/settings/chat_memory", () =>
        HttpResponse.json({ setting_value: "on" }),
      ),
    );
    serveSessions([
      { id: "s1", project_id: null },
      { id: "s2", project_id: null },
      { id: "s3", project_id: null },
    ]);

    renderGlobal();

    fireEvent.click(await screen.findByRole("button", { name: "Turn on memory" }));

    expect(
      await screen.findByText("Memory works inside projects — create one from the sidebar"),
    ).toBeInTheDocument();
  });

  it("keeps the toggle working and shows no alert when only the session count fails to load", async () => {
    serveSettings("on");
    server.use(http.get("*/v1/chat/sessions", () => HttpResponse.json(null, { status: 500 })));

    renderGlobal();

    expect(await screen.findByText("Memory is on")).toBeInTheDocument();
    expect(screen.getByText("Memory works inside projects.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("MemoryDialog project view", () => {
  it("shows the digest verbatim with a character counter", async () => {
    serveProjectMemory(PROJECT_MEMORY);

    renderProject();

    expect(await screen.findByText(PROJECT_MEMORY.digest)).toBeInTheDocument();
    expect(
      screen.getByText(`${PROJECT_MEMORY.digest.length} / ${PROJECT_MEMORY.char_cap} characters`),
    ).toBeInTheDocument();
  });

  it("explains Clear as unfile/delete, unpin, or turning memory off", async () => {
    serveProjectMemory(PROJECT_MEMORY);

    renderProject();

    await screen.findByText(PROJECT_MEMORY.digest);
    expect(
      screen.getByText(/Unfiling or deleting a conversation, unpinning it, or turning memory off/),
    ).toBeInTheDocument();
  });

  it("toggles pin from the sessions list", async () => {
    serveProjectMemory(PROJECT_MEMORY);
    let pinBody: unknown = null;
    server.use(
      http.put("*/v1/chat/sessions/s1/pin", async ({ request }) => {
        pinBody = await request.json();
        return HttpResponse.json({ id: "s1", pinned: true });
      }),
    );

    renderProject();

    const pinButton = await screen.findByRole("button", { name: "pin APOE and lipids" });
    fireEvent.click(pinButton);

    await waitFor(() => expect(pinBody).toEqual({ pinned: true }));
    expect(await screen.findByRole("button", { name: "unpin APOE and lipids" })).toBeInTheDocument();
  });

  it("renders disabled with a plain message on 404, never an error alert", async () => {
    serveProjectMemory({}, 404);

    renderProject();

    expect(await screen.findByText("Memory is not available on this server yet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a null session title as New Chat", async () => {
    serveProjectMemory({ ...PROJECT_MEMORY, sessions: [{ id: "s2", title: null, pinned: false, created_at: "2026-01-01T00:00:00Z" }] });

    renderProject();

    expect(await screen.findByText("New Chat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pin New Chat" })).toBeInTheDocument();
  });

  it("offers a Turn on memory button over the preview when memory is off, and refreshes on click", async () => {
    let putBody: unknown = null;
    let turnedOn = false;
    server.use(
      http.put("*/v1/llm-config/user/settings/chat_memory", async ({ request }) => {
        putBody = await request.json();
        turnedOn = true;
        return HttpResponse.json({ setting_value: "on" });
      }),
      http.get("*/v1/projects/proj-1/memory", () =>
        HttpResponse.json({ ...PROJECT_MEMORY, enabled: turnedOn }),
      ),
    );

    renderProject();

    expect(await screen.findByText("Preview — what turning this on would give the model")).toBeInTheDocument();
    const turnOnButton = screen.getByRole("button", { name: "Turn on memory" });

    fireEvent.click(turnOnButton);

    await waitFor(() => expect(putBody).toEqual({ setting_value: "on" }));
    expect(
      await screen.findByText("Exactly as the model will see it at your next session start"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on memory" })).not.toBeInTheDocument();
  });

  it("guards against an in-flight load from an earlier open landing after a later one", async () => {
    let resolveFirst: ((body: Record<string, unknown>) => void) | undefined;
    server.use(
      http.get("*/v1/projects/proj-1/memory", async () => {
        if (!resolveFirst) {
          // first request: block until the second request has already resolved
          return new Promise((resolve) => {
            resolveFirst = (body) => resolve(HttpResponse.json(body));
          });
        }
        return HttpResponse.json({ ...PROJECT_MEMORY, digest: "second load" });
      }),
    );

    const { rerender } = render(
      <MemoryRouter>
        <MemoryDialog open onClose={vi.fn()} projectId="proj-1" />
      </MemoryRouter>,
    );

    // force a second load while the first is still pending, by toggling `open`
    rerender(
      <MemoryRouter>
        <MemoryDialog open={false} onClose={vi.fn()} projectId="proj-1" />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter>
        <MemoryDialog open onClose={vi.fn()} projectId="proj-1" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("second load")).toBeInTheDocument();

    // the stale first response resolving afterward must not clobber the fresh one
    resolveFirst!({ ...PROJECT_MEMORY, digest: "first load (stale)" });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText("second load")).toBeInTheDocument();
    expect(screen.queryByText("first load (stale)")).not.toBeInTheDocument();
  });
});
