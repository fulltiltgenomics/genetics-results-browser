import { describe, it, expect } from "vitest";
import {
  TOOL_CALL_MARKER_REGEX,
  decodeToolCallMarker,
  encodeToolCallMarker,
  withToolCallOutcome,
} from "./toolCallMarker";

const CODE = `LEAD = "22:23828809:T:G"  # ] : brackets and colons
ss = g.summary_stats(region="22:23578809-24078809")
print("naïve — non-ascii ✓")`;

function markerBody(marker: string): string {
  TOOL_CALL_MARKER_REGEX.lastIndex = 0;
  const match = TOOL_CALL_MARKER_REGEX.exec(marker);
  if (!match) throw new Error(`not a tool-call marker: ${marker}`);
  return match[1];
}

describe("tool call markers", () => {
  it("round-trips a script containing the characters a delimited marker would break on", () => {
    const marker = encodeToolCallMarker({ id: "t1", name: "run_analysis", input: { code: CODE } });
    // the reason for base64: none of these may appear in the encoded body
    expect(marker).not.toContain("\n");
    expect(marker.slice(0, -1)).not.toContain("]");

    const decoded = decodeToolCallMarker(markerBody(marker));
    expect(decoded?.input.code).toBe(CODE);
    expect(decoded?.name).toBe("run_analysis");
  });

  it("survives a script large enough to blow a spread-argument encoder", () => {
    const code = "x = 1  # padding\n".repeat(4000);
    const decoded = decodeToolCallMarker(
      markerBody(encodeToolCallMarker({ id: "t1", name: "run_analysis", input: { code } })),
    );
    expect(decoded?.input.code).toBe(code);
  });

  it("returns null for a marker body an interrupted stream left half-written", () => {
    const body = markerBody(
      encodeToolCallMarker({ id: "t1", name: "run_analysis", input: { code: CODE } }),
    );
    expect(decodeToolCallMarker(body.slice(0, 20))).toBeNull();
    expect(decodeToolCallMarker("")).toBeNull();
  });

  it("attaches an outcome to one call without disturbing the others", () => {
    const first = encodeToolCallMarker({ id: "t1", name: "run_analysis", input: { code: "a" } });
    const second = encodeToolCallMarker({ id: "t2", name: "run_analysis", input: { code: "b" } });
    const content = `before\n\n${first}\n\nmiddle\n\n${second}\n\nafter`;

    const updated = withToolCallOutcome(content, "t2", {
      ran: true,
      ok: false,
      status: "error",
      durationMs: 4200,
      exception: "ValueError",
    });

    expect(updated).toContain(first);
    expect(updated).toContain("before");
    expect(updated).toContain("middle");
    expect(updated).toContain("after");

    TOOL_CALL_MARKER_REGEX.lastIndex = 0;
    const records = [...updated.matchAll(TOOL_CALL_MARKER_REGEX)].map((m) =>
      decodeToolCallMarker(m[1]),
    );
    expect(records[0]?.outcome).toBeUndefined();
    expect(records[1]?.outcome).toEqual({
      ran: true,
      ok: false,
      status: "error",
      durationMs: 4200,
      exception: "ValueError",
    });
  });

  it("leaves the content alone when no marker carries the id", () => {
    const content = `x ${encodeToolCallMarker({ id: "t1", name: "run_analysis", input: {} })} y`;
    expect(
      withToolCallOutcome(content, "nope", {
        ran: true,
        ok: true,
        status: "ok",
        durationMs: 1,
        exception: null,
      }),
    ).toBe(content);
  });
});
