import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { saveMessage } from "./chatHistoryApi";

// the server upserts messages with ON CONFLICT DO UPDATE SET instruction_set_id = excluded.…, so a
// payload that omits the key clears whatever was stored on every re-save. JSON.stringify drops an
// undefined value, which makes `instructionSetId ?? null` in saveMessage load-bearing: assert the
// key is present and null, never merely absent-and-therefore-falsy.
const captureSaves = (): Array<Record<string, unknown>> => {
  const bodies: Array<Record<string, unknown>> = [];
  server.use(
    http.post("*/v1/chat/sessions/:sessionId/messages", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return HttpResponse.json({
        id: body.id,
        session_id: params.sessionId,
        role: body.role,
        content: body.content,
        created_at: "2026-01-01T00:00:00Z",
      });
    })
  );
  return bodies;
};

const hasKey = (body: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(body, key);

describe("saveMessage instruction_set_id", () => {
  it("sends an explicit null when the instructionSetId argument is omitted entirely", async () => {
    const bodies = captureSaves();

    await saveMessage("session-1", "msg-1", "user", "hello");

    expect(bodies).toHaveLength(1);
    expect(hasKey(bodies[0], "instruction_set_id")).toBe(true);
    expect(bodies[0].instruction_set_id).toBeNull();
  });

  it("sends an explicit null when instructionSetId is passed as undefined or null", async () => {
    const bodies = captureSaves();

    await saveMessage("session-1", "msg-2", "user", "hello", null, null, null, null, undefined);
    await saveMessage("session-1", "msg-3", "user", "hello", null, null, null, null, null);

    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(hasKey(body, "instruction_set_id")).toBe(true);
      expect(body.instruction_set_id).toBeNull();
    }
  });

  it("passes a selected instruction set id through unchanged", async () => {
    const bodies = captureSaves();

    await saveMessage("session-1", "msg-4", "user", "hello", null, null, null, null, "set-abc");

    expect(bodies[0].instruction_set_id).toBe("set-abc");
  });
});
