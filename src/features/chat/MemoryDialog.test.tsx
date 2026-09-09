import { PropsWithChildren } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { MemoryDialog, MEMORY_NOTICE_SEEN_KEY } from "./MemoryDialog";

const OFF_STATE = {
  enabled: false,
  digest: "Earlier: asked about APOE and lipid traits.",
  sessions: [
    { id: "s1", title: "APOE and lipids", pinned: false, created_at: "2026-01-01T00:00:00Z" },
  ],
  char_cap: 4000,
};

const ON_STATE = { ...OFF_STATE, enabled: true };

const renderDialog = (onClose = vi.fn()) =>
  render(
    <MemoryRouter>
      <MemoryDialog open onClose={onClose} />
    </MemoryRouter>,
  );

const serveMemory = (body: Record<string, unknown> = OFF_STATE, status = 200) =>
  server.use(http.get("*/v1/memory", () => HttpResponse.json(body, { status })));

beforeEach(() => {
  localStorage.clear();
});

describe("MemoryDialog", () => {
  it("shows the off-state notice and writes the setting when turned on", async () => {
    serveMemory(OFF_STATE);
    let settingBody: unknown = null;
    server.use(
      http.put("*/v1/llm-config/user/settings/chat_memory", async ({ request }) => {
        settingBody = await request.json();
        return HttpResponse.json({ setting_value: "on" });
      }),
    );

    renderDialog();

    expect(await screen.findByText(/index of your earlier conversations/)).toBeInTheDocument();
    expect(screen.getByText(/never includes tool results, plots, downloads/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Turn on memory" }));

    await waitFor(() => expect(settingBody).toEqual({ setting_value: "on" }));
    expect(await screen.findByText("Memory is on")).toBeInTheDocument();
  });

  it("shows the digest verbatim with a character counter when on", async () => {
    serveMemory(ON_STATE);

    renderDialog();

    expect(await screen.findByText(ON_STATE.digest)).toBeInTheDocument();
    expect(
      screen.getByText(`${ON_STATE.digest.length} / ${ON_STATE.char_cap} characters`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/leaves the digests already stored on existing conversations untouched/),
    ).toBeInTheDocument();
  });

  it("renders disabled with a plain message on 404, never an error alert", async () => {
    serveMemory({}, 404);

    renderDialog();

    expect(await screen.findByText("Memory is not available on this server yet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on memory" })).not.toBeInTheDocument();
  });

  it("toggles pin from the sessions list", async () => {
    serveMemory(ON_STATE);
    let pinBody: unknown = null;
    server.use(
      http.put("*/v1/chat/sessions/s1/pin", async ({ request }) => {
        pinBody = await request.json();
        return HttpResponse.json({ id: "s1", pinned: true });
      }),
    );

    renderDialog();

    const pinButton = await screen.findByRole("button", { name: "pin APOE and lipids" });
    fireEvent.click(pinButton);

    await waitFor(() => expect(pinBody).toEqual({ pinned: true }));
    expect(await screen.findByRole("button", { name: "unpin APOE and lipids" })).toBeInTheDocument();
  });

  it("shows the first-open notice once, then not on a later open", async () => {
    serveMemory(OFF_STATE);

    const { unmount } = renderDialog();
    expect(await screen.findByText(/index of your earlier conversations/)).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(MEMORY_NOTICE_SEEN_KEY)).toBe("1"));
    unmount();

    renderDialog();
    await screen.findByRole("button", { name: "Turn on memory" });
    expect(screen.queryByText(/index of your earlier conversations/)).not.toBeInTheDocument();
  });

  it("does not mark the notice seen on a 404 (older backend)", async () => {
    serveMemory({}, 404);

    renderDialog();

    await screen.findByText("Memory is not available on this server yet.");
    expect(localStorage.getItem(MEMORY_NOTICE_SEEN_KEY)).toBeNull();
  });

  it("does not mark the notice seen for an already-enabled user", async () => {
    serveMemory(ON_STATE);

    renderDialog();

    await screen.findByText("Memory is on");
    expect(localStorage.getItem(MEMORY_NOTICE_SEEN_KEY)).toBeNull();
  });

  it("renders a null session title as New Chat", async () => {
    serveMemory({ ...ON_STATE, sessions: [{ id: "s2", title: null, pinned: false, created_at: "2026-01-01T00:00:00Z" }] });

    renderDialog();

    expect(await screen.findByText("New Chat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pin New Chat" })).toBeInTheDocument();
  });
});
