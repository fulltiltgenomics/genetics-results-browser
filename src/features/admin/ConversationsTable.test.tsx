import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import ConversationsTable from "./ConversationsTable";
import type { AdminSession } from "./adminApi";

// pinned so the UTC->local day conversion under test has a fixed, non-zero offset to cross
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Europe/Helsinki";
});
afterAll(() => {
  process.env.TZ = originalTz;
});

const session = (over: Partial<AdminSession> & Pick<AdminSession, "id">): AdminSession => ({
  userId: "someone@example.org",
  title: null,
  createdAt: "2026-04-20T10:00:00",
  updatedAt: "2026-04-20T10:00:00",
  rating: null,
  comment: null,
  phenotypeCode: null,
  messageCount: 2,
  preview: null,
  disposition: null,
  issueCount: 0,
  issueCategories: [],
  llmRating: null,
  successLabel: null,
  ...over,
});

const SESSIONS: AdminSession[] = [
  session({
    id: "a",
    title: "Alpha conversation",
    userId: "ann@example.org",
    messageCount: 9,
    // 23:33 UTC on the 28th is 02:33 on the 29th in Helsinki
    createdAt: "2026-04-28T23:33:27",
    updatedAt: "2026-04-28T23:40:00",
    disposition: "good_answer",
    llmRating: 4,
  }),
  session({
    id: "b",
    title: "Bravo conversation",
    userId: "bob@example.org",
    messageCount: 3,
    createdAt: "2026-04-29T09:00:00",
    updatedAt: "2026-04-29T09:10:00",
    disposition: "agent_failure",
    llmRating: 2,
  }),
  session({
    id: "c",
    title: "Charlie conversation",
    userId: "cal@example.org",
    messageCount: 21,
    createdAt: "2026-04-30T09:00:00",
    updatedAt: "2026-04-30T09:30:00",
    llmRating: null,
  }),
];

const renderTable = (onSelect = vi.fn()) => {
  render(
    <ConversationsTable sessions={SESSIONS} isLoading={false} isXs={false} onSelect={onSelect} />
  );
  return onSelect;
};

// the rendered order of the Title / Preview column, which is what a sort is observable through
const titleOrder = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[1]?.textContent ?? "");

describe("ConversationsTable", () => {
  it("renders every session and defaults to newest-updated first", () => {
    renderTable();
    expect(titleOrder()).toEqual([
      "Charlie conversation",
      "Bravo conversation",
      "Alpha conversation",
    ]);
  });

  it("sorts by a column both ways when its header is clicked", () => {
    renderTable();
    const header = screen.getByRole("button", { name: /Messages/i });

    // count columns are sortDescFirst, so the first click gives the largest first
    fireEvent.click(header);
    expect(titleOrder()).toEqual([
      "Charlie conversation", // 21
      "Alpha conversation", // 9
      "Bravo conversation", // 3
    ]);

    fireEvent.click(header);
    expect(titleOrder()).toEqual([
      "Bravo conversation",
      "Alpha conversation",
      "Charlie conversation",
    ]);
  });

  it("filters by the local calendar day, not the stored UTC day", () => {
    renderTable();
    // session "a" was created at 23:33 UTC on Apr 28, which is Apr 29 locally. filtering to
    // Apr 29 must find it — under the old UTC-day filter it only showed up on Apr 28.
    fireEvent.change(screen.getByLabelText("created from"), {
      target: { value: "2026-04-29" },
    });
    fireEvent.change(screen.getByLabelText("created to"), {
      target: { value: "2026-04-29" },
    });
    expect(titleOrder()).toEqual(["Bravo conversation", "Alpha conversation"]);
  });

  it("clearing both date bounds restores every row", () => {
    renderTable();
    const from = screen.getByLabelText("created from");
    fireEvent.change(from, { target: { value: "2026-04-30" } });
    expect(titleOrder()).toEqual(["Charlie conversation"]);
    fireEvent.change(from, { target: { value: "" } });
    expect(titleOrder()).toHaveLength(3);
  });

  it("filters by user text typed into the column header", async () => {
    renderTable();
    fireEvent.change(screen.getByPlaceholderText("user"), { target: { value: "bob" } });
    // MRT debounces text filter input, so the row set settles a tick later
    await waitFor(() => expect(titleOrder()).toEqual(["Bravo conversation"]));
  });

  it("opens the detail view for the clicked row", () => {
    const onSelect = renderTable();
    fireEvent.click(screen.getByText("Bravo conversation"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});
