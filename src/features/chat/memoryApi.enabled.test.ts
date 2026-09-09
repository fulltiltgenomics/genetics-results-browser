import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { getMemoryEnabled } from "./memoryApi";

describe("getMemoryEnabled", () => {
  it("reads chat_memory=on out of the settings bag", async () => {
    server.use(
      http.get("*/v1/llm-config/user/settings", () =>
        HttpResponse.json({ chat_memory: { setting_value: "on" } }),
      ),
    );

    await expect(getMemoryEnabled()).resolves.toBe(true);
  });

  it("treats a missing key as off", async () => {
    server.use(http.get("*/v1/llm-config/user/settings", () => HttpResponse.json({})));

    await expect(getMemoryEnabled()).resolves.toBe(false);
  });

  it("treats chat_memory=off as off", async () => {
    server.use(
      http.get("*/v1/llm-config/user/settings", () =>
        HttpResponse.json({ chat_memory: { setting_value: "off" } }),
      ),
    );

    await expect(getMemoryEnabled()).resolves.toBe(false);
  });

  it("throws a plain error on a failed request", async () => {
    server.use(
      http.get("*/v1/llm-config/user/settings", () => new HttpResponse(null, { status: 500 })),
    );

    await expect(getMemoryEnabled()).rejects.toThrow("HTTP 500");
  });
});
