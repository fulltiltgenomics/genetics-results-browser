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
    { user: "ann@example.org", conversations: 3, avgMessages: 4.6667, usd: 3.5 },
    { user: "bob@example.org", conversations: 0, avgMessages: 0, usd: 0.25 },
  ],
};

const MONTH: CostAnalyticsResponse = {
  period: "month",
  daily: [{ date: "2026-08-20", usd: 10 }],
  users: [{ user: "cat@example.org", conversations: 1, avgMessages: 2, usd: 10 }],
};

async function openUsageTab() {
  render(<AdminPage />);
  fireEvent.click(screen.getByRole("tab", { name: "Usage" }));
  await waitFor(() => expect(fetchCostAnalytics).toHaveBeenCalled());
}

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

  it("defaults to week and renders one row per user with the mean rounded to one digit", async () => {
    await openUsageTab();
    expect(fetchCostAnalytics).toHaveBeenLastCalledWith("week");
    expect(screen.getByRole("button", { name: "Week", pressed: true })).toBeTruthy();

    const ann = await screen.findByText("ann@example.org");
    const cells = within(ann.closest("tr")!).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(["ann@example.org", "3", "4.7", "3.50"]);

    // spend with no conversation opened in the window is still a row, with no mean to show
    const bob = screen.getByText("bob@example.org");
    expect(within(bob.closest("tr")!).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "bob@example.org", "0", "–", "0.25",
    ]);
    expect(screen.getByText("2 users, 3.75 USD total")).toBeTruthy();
  });

  it("plots one USD line over every day of the window, zero-filled", async () => {
    await openUsageTab();
    await screen.findByText("ann@example.org");
    const data = lineProps.mock.calls.at(-1)![0].data;
    expect(data.datasets).toHaveLength(1);
    expect(data.datasets[0].label).toBe("USD");
    expect(data.labels).toEqual(["2026-09-10", "2026-09-11", "2026-09-12"]);
    expect(data.datasets[0].data).toEqual([1.5, 0, 2.25]);
  });

  it("refetches plot and table together when the period changes", async () => {
    await openUsageTab();
    await screen.findByText("ann@example.org");
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    await waitFor(() => expect(fetchCostAnalytics).toHaveBeenLastCalledWith("month"));
    await screen.findByText("cat@example.org");
    expect(screen.queryByText("ann@example.org")).toBeNull();
    expect(lineProps.mock.calls.at(-1)![0].data.labels).toEqual(["2026-08-20"]);
  });
});
