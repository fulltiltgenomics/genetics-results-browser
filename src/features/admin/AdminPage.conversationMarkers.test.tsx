import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AdminSession, AdminSessionDetail } from "./adminApi";
import { encodeToolCallMarker } from "../chat/toolCallMarker";

// chart.js needs a canvas jsdom does not have, and the usage plot is not what this covers
vi.mock("react-chartjs-2", () => ({ Line: () => null }));
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

const fetchAdminSessionDetail = vi.fn();

vi.mock("./adminApi", () => ({
  fetchAdminSessions: vi.fn(async () => ({
    sessions: [SESSION],
    total: 1,
    limit: 100,
    offset: 0,
  })),
  fetchAdminSessionDetail: (id: string) => fetchAdminSessionDetail(id),
  fetchUsageAnalytics: vi.fn(async () => ({ period: "week", data: [] })),
  fetchAdminFeedback: vi.fn(async () => ({
    items: [],
    total: 0,
    latestAt: null,
    limit: 0,
    offset: 0,
  })),
  fetchQualitySeries: vi.fn(async () => []),
}));

import AdminPage from "./AdminPage";

const SESSION: AdminSession = {
  id: "s-1",
  userId: "ann@example.org",
  title: "Hearing loss locus",
  createdAt: "2026-04-20T10:00:00",
  updatedAt: "2026-04-20T10:05:00",
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
};

const CODE = 'import genetics\nr = genetics.plots.locuszoom(variant="12:49272869:C:T")';
const IMAGE_DATA = "aW1hZ2U=".repeat(20);

// one assistant turn as it is actually stored: prose around a tool-call marker and an image
// marker. The alt is written with its colons already replaced, the way the streaming path writes
// it, because the image marker is delimited by colons and cannot carry one in a field.
const CONTENT = [
  "Let me plot that locus.",
  encodeToolCallMarker({ id: "ra-1", name: "run_analysis", input: { code: CODE } }),
  `[IMAGE:png:locus 12 49272869.png:${IMAGE_DATA}]`,
  "The lead variant is genome-wide significant.",
].join("\n\n");

const DETAIL: AdminSessionDetail = {
  id: "s-1",
  userId: "ann@example.org",
  title: "Hearing loss locus",
  createdAt: "2026-04-20T10:00:00",
  updatedAt: "2026-04-20T10:05:00",
  rating: null,
  comment: null,
  phenotypeCode: null,
  messages: [
    { id: "m-1", role: "user", content: "plot the locus", createdAt: "2026-04-20T10:00:00", thumbsUp: null },
    { id: "m-2", role: "assistant", content: CONTENT, createdAt: "2026-04-20T10:05:00", thumbsUp: null },
  ],
};

async function openConversation() {
  render(<AdminPage />);
  fireEvent.click(await screen.findByText("Hearing loss locus"));
  await waitFor(() => expect(fetchAdminSessionDetail).toHaveBeenCalledWith("s-1"));
}

describe("the admin conversation viewer", () => {
  beforeEach(() => {
    fetchAdminSessionDetail.mockReset();
    fetchAdminSessionDetail.mockResolvedValue(DETAIL);
  });

  // the viewer rendered the stored `content` straight through ReactMarkdown, so a transcript an
  // admin opened was prose interrupted by screenfuls of the two markers' base64
  it("renders the stored markers instead of spilling their base64 as prose", async () => {
    await openConversation();

    expect(await screen.findByText(/Let me plot that locus/)).toBeTruthy();
    expect(screen.getByText(/genome-wide significant/)).toBeTruthy();

    // the tool call is a disclosure, collapsed, and the script is not loose in the transcript
    expect(screen.getByText("run_analysis")).toBeTruthy();
    expect(screen.queryByText(/locuszoom/)).toBeNull();
    fireEvent.click(screen.getByText("run_analysis"));
    expect((await screen.findByText(/locuszoom/)).textContent).toBe(CODE);

    // the image is an image rather than a screenful of base64
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe(`data:image/png;base64,${IMAGE_DATA}`);
    expect(img.alt).toBe("locus 12 49272869.png");

    expect(screen.queryByText(/TOOLUSE/)).toBeNull();
    expect(screen.queryByText(/IMAGE:/)).toBeNull();
  });

  // the export out of the same dialog read the same stored content and wrote it raw, so a
  // downloaded transcript carried the markers' base64 where the script and the plot belonged
  it("converts the markers in the exported markdown", async () => {
    // jsdom's Blob has no .text(), so capture what the download was handed instead
    const written: string[] = [];
    vi.stubGlobal(
      "Blob",
      class {
        constructor(parts: string[]) {
          written.push(parts.join(""));
        }
      },
    );
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:stub", revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await openConversation();
    fireEvent.click(document.querySelector('[data-testid="DownloadIcon"]')!.closest("button")!);
    fireEvent.click(await screen.findByText("As Markdown"));

    const markdown = written[0];
    expect(markdown).toContain(`\`\`\`python\n${CODE}\n\`\`\``);
    expect(markdown).toContain(`![locus 12 49272869.png](data:image/png;base64,${IMAGE_DATA})`);
    expect(markdown).not.toContain("TOOLUSE");
    expect(markdown).not.toContain("[IMAGE:");

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
