import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("./schemaApi", () => ({
  useSchema: () => ({ data: undefined }),
}));

let emit: ((data: unknown) => void) | undefined;
let finish: (() => void) | undefined;
const sentBodies: any[] = [];

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

import { LLMChat } from "./LLMChat";

// 1000 bytes of CSV: an artifact small enough to read back, large enough that resending it
// on every later turn is the cost the replay strip exists to avoid
const CSV_TEXT = 'col1,col2\nplain,"quoted"\n'.repeat(40);
const CSV_BASE64 = btoa(CSV_TEXT);

const saved: { blob: Blob; name: string }[] = [];
// jsdom's Blob has no text(); FileReader is how its contents come back
const blobText = (blob: Blob): Promise<string> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;

const submit = (text: string) => {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
};

async function startTurn() {
  render(<LLMChat />);
  submit("run the phewas");
  await waitFor(() => expect(emit).toBeDefined());
}

describe("non-image artifacts in the transcript", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    emit = undefined;
    finish = undefined;
    sentBodies.length = 0;
    saved.length = 0;
    // jsdom has no object-URL plumbing, and saving the blob is the whole of the feature
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved.push({ blob, name: "" });
      return "blob:artifact";
    });
    URL.revokeObjectURL = vi.fn();
    // a real anchor click would be a navigation jsdom refuses; the name it carries is the
    // thing worth asserting
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

  it("offers the file as a download rather than dropping it", async () => {
    await startTurn();
    await act(async () => {
      emit!({
        type: "file",
        file_name: "phewas_long.csv",
        file_mime: "text/csv",
        file_data: CSV_BASE64,
      });
    });

    expect(screen.getByText("phewas_long.csv")).toBeTruthy();
    // the size is read off the base64 without decoding it
    expect(screen.getByText("1000 B")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /phewas_long\.csv/ }));
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("phewas_long.csv");
    expect(saved[0].blob.type).toBe("text/csv");
    expect(await blobText(saved[0].blob)).toBe(CSV_TEXT);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:artifact");
  });

  it("renders a file whose artifact name contains the marker's delimiter", async () => {
    await startTurn();
    await act(async () => {
      emit!({
        type: "file",
        file_name: "nmf:locus[22].csv",
        file_mime: "text/csv",
        file_data: CSV_BASE64,
      });
    });

    // the delimiters were encoded rather than splitting the marker and spilling base64
    expect(screen.queryByText(/FILE:/)).toBeNull();
    expect(document.body.textContent).not.toContain(CSV_BASE64.slice(0, 40));
    // and the name the analysis actually wrote still reaches the saved file
    expect(screen.getByText("nmf:locus[22].csv")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /nmf:locus\[22\]\.csv/ }));
    expect(saved[0].name).toBe("nmf:locus[22].csv");
  });

  it("does not resend the artifact's base64 on the next turn", async () => {
    await startTurn();
    await act(async () => {
      emit!({ type: "content", content: "Full detail is in the artifacts." });
      emit!({
        type: "file",
        file_name: "phewas_long.csv",
        file_mime: "text/csv",
        file_data: CSV_BASE64,
      });
    });
    // a turn that never delivered `done` has no contentJson, so the next turn replays
    // `content` — where the artifact's whole base64 sits
    await act(async () => {
      finish!();
    });

    await waitFor(() => expect(screen.getByRole("textbox")).not.toBeDisabled());
    submit("now cluster them");
    await waitFor(() => expect(sentBodies).toHaveLength(2));

    const replay = JSON.stringify(sentBodies[1].messages);
    expect(replay).not.toContain(CSV_BASE64.slice(0, 100));
    expect(replay).not.toContain("[FILE:");
    expect(replay).toContain("file given to the user: phewas_long.csv");
  });
});
