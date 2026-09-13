import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import UsageTable from "./UsageTable";
import type { UserUsageRow } from "./adminApi";

const USERS: UserUsageRow[] = [
  { user: "ann@example.org", conversations: 3, avgMessages: 4.5, maxMessages: 9, usd: 3.5, avgUsd: 1.2, maxUsd: 2.0 },
  { user: "bob@example.org", conversations: 0, avgMessages: 0, maxMessages: 0, usd: 0.25, avgUsd: null, maxUsd: null },
  { user: "cal@example.org", conversations: 5, avgMessages: 2.0, maxMessages: 4, usd: 7.0, avgUsd: 1.4, maxUsd: 3.0 },
];

// the rendered order of the User column, which is what a sort is observable through
const userOrder = () =>
  screen
    .getAllByRole("row")
    .map((r) => within(r).queryAllByRole("cell")[0]?.textContent ?? "")
    .filter((t) => ["ann", "bob", "cal"].includes(t));

describe("UsageTable", () => {
  it("sorts by USD descending out of the box and shows usernames only", () => {
    render(<UsageTable users={USERS} isLoading={false} isXs={false} />);
    expect(userOrder()).toEqual(["cal", "ann", "bob"]);
    expect(screen.queryByText("cal@example.org")).toBeNull();
  });

  // an unknown per-conversation figure sorts as the smallest value (naInfSort), so it sits at the
  // bottom of a descending sort and at the top of an ascending one, as in the Conversations table
  it("re-sorts on a header click, an unknown figure counting as the smallest", async () => {
    render(<UsageTable users={USERS} isLoading={false} isXs={false} />);
    fireEvent.click(screen.getByText("Max USD per conversation"));
    await waitFor(() => expect(userOrder()).toEqual(["cal", "ann", "bob"]));
    fireEvent.click(screen.getByText("Max USD per conversation"));
    await waitFor(() => expect(userOrder()).toEqual(["bob", "ann", "cal"]));
  });

  it("filters on a minimum for numeric columns and on text for the user", async () => {
    render(<UsageTable users={USERS} isLoading={false} isXs={false} />);
    const minFilters = screen.getAllByPlaceholderText("min");
    // column order: conversations, avg messages, max messages, usd, avg usd, max usd
    fireEvent.change(minFilters[0], { target: { value: "4" } });
    await waitFor(() => expect(userOrder()).toEqual(["cal"]));
    fireEvent.change(minFilters[0], { target: { value: "" } });
    fireEvent.change(screen.getByPlaceholderText("user"), { target: { value: "an" } });
    await waitFor(() => expect(userOrder()).toEqual(["ann"]));
    expect(screen.getByText(/1 of 3 users, 10\.75 USD total/)).toBeTruthy();
  });
});
