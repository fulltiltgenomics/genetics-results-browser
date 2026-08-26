import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../chat/schemaApi", () => ({
  useSchema: () => ({ data: undefined }),
}));

vi.mock("../../store/api", () => ({
  default: { get: vi.fn(async () => ({ data: { content: "# T2D report" } })) },
}));

const sentBodies: any[] = [];
let finish: (() => void) | undefined;
let emit: ((data: unknown) => void) | undefined;

vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: vi.fn(async (_url: string, opts: any) => {
    sentBodies.push(JSON.parse(opts.body));
    await opts.onopen({ ok: true, headers: { get: () => "text/event-stream" } });
    emit = (data: unknown) => opts.onmessage({ data: JSON.stringify(data) });
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  }),
}));

import PhenotypeContainer from "./PhenotypeContainer";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** send one message and let the turn finish so the composer is usable again */
const turn = async (text: string) => {
  const before = sentBodies.length;
  const textbox = screen.getByPlaceholderText(/Ask about/);
  fireEvent.change(textbox, { target: { value: text } });
  fireEvent.submit(textbox.closest("form")!);
  await waitFor(() => expect(sentBodies.length).toBe(before + 1), { timeout: 5000 });
  await act(async () => {
    emit!({ type: "content", content: "ok" });
    emit!({ type: "done" });
    finish!();
  });
};

/**
 * The phenotype chat is ephemeral — nothing is persisted and it never appears in the session
 * list — but chat-backend turns `session_id` into the `sid` claim of the per-execution sandbox
 * credential, and run_analysis refuses a turn without one (genetics-results-suite-r0v). So the
 * surface mints one client-side, the way secret chats do.
 */
describe("the phenotype chat carries a client-minted session id", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    sentBodies.length = 0;
    finish = undefined;
    emit = undefined;
  });

  // generous timeout: this mounts the whole chat surface, which is slow under a full-suite run
  it("sends the same uuid on every turn of a conversation", async () => {
    render(<PhenotypeContainer />, { wrapper: Wrapper });
    fireEvent.change(screen.getByLabelText(/Phenotype Code/), { target: { value: "T2D" } });
    fireEvent.click(screen.getByRole("button", { name: /GO/ }));
    await waitFor(() => expect(screen.getByPlaceholderText(/Ask about T2D/)).toBeTruthy(), {
      timeout: 5000,
    });

    await turn("what is this");
    await turn("and now plot it");

    expect(sentBodies).toHaveLength(2);
    expect(sentBodies[0].session_id).toMatch(UUID);
    // 36 chars, well inside the backend's max_length=64 bound on session_id
    expect(sentBodies[0].session_id).toHaveLength(36);
    expect(sentBodies[1].session_id).toBe(sentBodies[0].session_id);
  }, 20000);
});
