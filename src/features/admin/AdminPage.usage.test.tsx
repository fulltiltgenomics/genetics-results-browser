import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { CostAnalyticsResponse } from "./adminApi";

// chart.js needs a canvas jsdom does not have; the plot's data is asserted through the mock
// props instead of pixels
const lineProps = vi.fn();
vi.mock("react-chartjs-2", () => ({ Line: (props: any) => { lineProps(props); return null; } }));
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

const fetchCostAnalytics = vi.fn();

vi.mock("./adminApi", () => ({
  fetchAdminSessions: vi.fn(async () => ({ sessions: [], total: 0, limit: 100, offset: 0 })),
  fetchAdminSessionDetail: vi.fn(),
  fetchUsageAnalytics: vi.fn(async () => ({ period: "week", data: [] })),
  fetchCostAnalytics: (period: string) => fetchCostAnalytics(period),
  fetchAdminFeedback: vi.fn(async () => ({ items: [], total: 0, latestAt: null, limit: 0, offset: 0 })),
  fetchQualitySeries: vi.fn(async () => []),
}));

import AdminPage from "./AdminPage";

const WEEK: CostAnalyticsResponse = {
  period: "week",
  daily: [
    { date: "2026-09-10", usd: 1.5 },
    { date: "2026-09-12", usd: 2.25 },
  ],
  users: [
    { user: "ann@example.org", conversations: 3, avgMessages: 4.6667, maxMessages: 9, usd: 3.5, avgUsd: 1.1667, maxUsd: 2.0 },
    { user: "bob@example.org", conversations: 0, avgMessages: 0, maxMessages: 0, usd: 0.25, avgUsd: null, maxUsd: null },
  ],
};

const MONTH: CostAnalyticsResponse = {
  period: "month",
  daily: [{ date: "2026-08-20", usd: 10 }],
  users: [{ user: "cat@example.org", conversations: 1, avgMessages: 2, maxMessages: 2, usd: 10, avgUsd: 10, maxUsd: 10 }],
};

async function openUsageTab() {
  render(<AdminPage />);
  fireEvent.click(screen.getByRole("tab", { name: "Usage" }));
  await waitFor(() => expect(fetchCostAnalytics).toHaveBeenCalled());
}

const rowCells = (username: string) =>
  within(screen.getByText(username).closest("tr")!)
    .getAllByRole("cell")
    .map((c) => c.textContent);

describe("AdminPage Usage tab", () => {
  beforeEach(() => {
    fetchCostAnalytics.mockReset();
    lineProps.mockReset();
    fetchCostAnalytics.mockImplementation(async (period: string) =>
      period === "month" ? MONTH : WEEK
    );
  });

  it("sits after Conversations and does not fetch until opened", async () => {
    render(<AdminPage />);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs.slice(0, 2)).toEqual(["Conversations", "Usage"]);
    expect(fetchCostAnalytics).not.toHaveBeenCalled();
  });

  it("defaults to week, states the list-price caveat, and renders one row per user", async () => {
    await openUsageTab();
    expect(fetchCostAnalytics).toHaveBeenLastCalledWith("week");
    expect(screen.getByRole("button", { name: "Week", pressed: true })).toBeTruthy();
    expect(
      screen.getByText("The amounts shown are list prices. Any discounts are not considered in these numbers.")
    ).toBeTruthy();

    // the username only; the full address is the tooltip
    await screen.findByText("ann");
    expect(screen.queryByText("ann@example.org")).toBeNull();
    expect(rowCells("ann")).toEqual(["ann", "3", "4.7", "9", "3.50", "1.17", "2.00"]);

    // spend with no conversation opened in the window is still a row, with no per-conversation figures
    expect(rowCells("bob")).toEqual(["bob", "0", "0.0", "0", "0.25", "–", "–"]);
    expect(screen.getByText(/2 of 2 users, 3\.75 USD total/)).toBeTruthy();
  });

  it("plots one USD line over every day of the window, zero-filled", async () => {
    await openUsageTab();
    await screen.findByText("ann");
    const data = lineProps.mock.calls.at(-1)![0].data;
    expect(data.datasets).toHaveLength(1);
    expect(data.datasets[0].label).toBe("USD");
    expect(data.labels).toEqual(["2026-09-10", "2026-09-11", "2026-09-12"]);
    expect(data.datasets[0].data).toEqual([1.5, 0, 2.25]);
  });

  it("refetches plot and table together when the period changes", async () => {
    await openUsageTab();
    await screen.findByText("ann");
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    await waitFor(() => expect(fetchCostAnalytics).toHaveBeenLastCalledWith("month"));
    await screen.findByText("cat");
    expect(screen.queryByText("ann")).toBeNull();
    expect(lineProps.mock.calls.at(-1)![0].data.labels).toEqual(["2026-08-20"]);
  });
});
