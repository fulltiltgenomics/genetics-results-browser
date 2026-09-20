import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MessageContent } from "./MessageContent";

const CSV_TEXT = "rsid,beta\nrs123,0.4\n";
const CSV_BASE64 = btoa(CSV_TEXT);
const PNG_BASE64 = btoa("not-really-a-png");

const saved: { blob: Blob; name: string }[] = [];
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;

const blobText = (blob: Blob): Promise<string> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

describe("a file name in the narration is a download control", () => {
  beforeEach(() => {
    saved.length = 0;
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved.push({ blob, name: "" });
      return "blob:artifact";
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    // the anchor downloadBlob builds never navigates in jsdom; record the name it carries
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      if (saved.length) saved[saved.length - 1].name = this.download;
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.restoreAllMocks();
  });

  it("links a mention that comes after the marker, and saves the same bytes", async () => {
    render(
      <MessageContent
        content={`Here is the run.\n\n[FILE:text/csv:loci.csv:${CSV_BASE64}]\n\nPer-locus table: \`loci.csv\`.`}
      />
    );

    // the control at the marker, plus the mention in the closing sentence
    const controls = screen.getAllByRole("button", { name: /loci\.csv/ });
    expect(controls).toHaveLength(2);

    fireEvent.click(controls[1]);
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("loci.csv");
    expect(await blobText(saved[0].blob)).toBe(CSV_TEXT);
  });

  it("links a mention that comes before the marker", () => {
    render(
      <MessageContent
        content={`I wrote loci.csv below.\n\n[FILE:text/csv:loci.csv:${CSV_BASE64}]`}
      />
    );
    expect(screen.getAllByRole("button", { name: /loci\.csv/ })).toHaveLength(2);
  });

  it("links a mention of an image the message already shows", () => {
    render(
      <MessageContent
        content={`[IMAGE:png:effects.png:${PNG_BASE64}]\n\nThe figure is \`effects.png\`.`}
      />
    );
    const link = screen.getByRole("button", { name: /effects\.png/ });
    fireEvent.click(link);
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("effects.png");
  });

  it("leaves the name alone inside a code block, where it is the analysis source", () => {
    render(
      <MessageContent
        content={`[FILE:text/csv:loci.csv:${CSV_BASE64}]\n\n\`\`\`python\ndf.write_csv("loci.csv")\n\`\`\``}
      />
    );
    expect(screen.getAllByRole("button", { name: /loci\.csv/ })).toHaveLength(1);
  });

  it("does not link a name the message does not carry, or a longer name containing it", () => {
    render(
      <MessageContent
        content={`[FILE:text/csv:loci.csv:${CSV_BASE64}]\n\nSee loci.csv, other_loci.csv and missing.csv.`}
      />
    );
    const controls = screen.getAllByRole("button", { name: /loci\.csv/ });
    // the marker's own control plus the bare `loci.csv` mention; `other_loci.csv` is a
    // different file and `missing.csv` is not in this message at all
    expect(controls).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /missing\.csv/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /other_loci\.csv/ })).toBeNull();
  });

  it("renders an ordinary markdown link as a link", () => {
    render(<MessageContent content={"See [the paper](https://example.org/paper)."} />);
    const anchor = screen.getByRole("link", { name: "the paper" });
    expect(anchor).toHaveAttribute("href", "https://example.org/paper");
  });
});
