import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { rowsToCsv } from "./tableCsv";
import { MessageContent } from "./MessageContent";

// jsdom's Blob has no text(); FileReader is how its contents come back
const blobText = (blob: Blob): Promise<string> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

const MARKDOWN_TABLE = [
  "| trait | note |",
  "| --- | --- |",
  "| **Asthma** | a comma, and a \"quote\" |",
  "| [E4_DM2](https://example.org/e4) | `raw_code` |",
].join("\n");

describe("rowsToCsv", () => {
  it("quotes a field holding a comma, a quote or a line break", () => {
    expect(rowsToCsv([["plain", "a, b", 'say "hi"', "two\nlines"]])).toBe(
      'plain,"a, b","say ""hi""","two\nlines"'
    );
  });

  it("leaves a field that needs no quoting alone", () => {
    expect(rowsToCsv([["a", "b"], ["c", "d"]])).toBe("a,b\nc,d");
  });
});

describe("markdown table download", () => {
  const saved: Blob[] = [];
  let originalCreate: typeof URL.createObjectURL;
  let originalRevoke: typeof URL.revokeObjectURL;

  beforeEach(() => {
    saved.length = 0;
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved.push(blob);
      return "blob:table";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.restoreAllMocks();
  });

  it("exports the cells as the user sees them, with markdown syntax gone", async () => {
    render(<MessageContent content={MARKDOWN_TABLE} />);

    fireEvent.click(screen.getByRole("button", { name: /download table as csv/i }));

    expect(saved).toHaveLength(1);
    expect(await blobText(saved[0])).toBe(
      [
        "trait,note",
        'Asthma,"a comma, and a ""quote"""',
        "E4_DM2,raw_code",
      ].join("\n")
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:table");
  });

  it("renders the table itself unchanged", () => {
    render(<MessageContent content={MARKDOWN_TABLE} />);

    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "E4_DM2" })).toBeTruthy();
  });
});
