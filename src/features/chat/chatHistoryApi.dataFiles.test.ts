import { describe, it, expect } from "vitest";
import { getAttachmentType, isValidAttachmentType, richTextError } from "./chatHistoryApi";

// jsdom's Blob has no text(); the picker reads a file's head through it
if (!Blob.prototype.text) {
  Blob.prototype.text = function (this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(this);
    });
  };
}

describe("data file types in the picker", () => {
  it("accepts a .txt table however the browser types it", () => {
    expect(getAttachmentType("", "table.txt")).toBe("tsv");
    expect(getAttachmentType("application/octet-stream", "table.txt")).toBe("tsv");
    expect(getAttachmentType("text/plain", "whatever")).toBe("tsv");
    expect(isValidAttachmentType("", "table.txt")).toBe(true);
  });

  it("still refuses what the server would refuse", () => {
    expect(isValidAttachmentType("", "notes.rtf")).toBe(false);
    expect(isValidAttachmentType("application/gzip", "sumstats.gz")).toBe(false);
  });
});

describe("richTextError", () => {
  const rtf = "{\\rtf1\\ansi\\ansicpg1252\\cocoartf2822\n{\\fonttbl\\f0\\fnil Menlo;}\nRSID\\tab CHR\\\n}";

  it("names the file and the TextEdit fix for an RTF document saved as .tsv", async () => {
    const file = new File([rtf], "cloz2_triage.tsv", { type: "text/tab-separated-values" });
    const err = await richTextError(file, "tsv");
    expect(err).toContain("cloz2_triage.tsv");
    expect(err).toContain("Make Plain Text");
  });

  it("passes a real table, and never reads an image", async () => {
    expect(await richTextError(new File(["a\tb\n1\t2\n"], "t.tsv"), "tsv")).toBeNull();
    expect(await richTextError(new File([rtf], "shot.png", { type: "image/png" }), "image")).toBeNull();
  });
});
