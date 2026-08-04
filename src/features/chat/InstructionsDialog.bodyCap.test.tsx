import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { InstructionsDialog } from "./InstructionsDialog";
import { MAX_BODY_CHARS } from "./instructionSetsApi";

const LEGACY_SET = {
  id: "set-legacy",
  name: "Legacy set",
  body: "x".repeat(MAX_BODY_CHARS + 1),
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  body_over_cap: true,
};

const serveLegacySet = () =>
  server.use(
    http.get("*/v1/llm-config/user/instruction-sets", () => HttpResponse.json([LEGACY_SET]))
  );

// the warning and the save gate key off the same strict inequality, so find the alert by its own
// text rather than by position among the dialog's other alerts
const overCapAlert = () =>
  screen
    .queryAllByRole("alert")
    .find((a) => a.textContent?.includes(`saved before the ${MAX_BODY_CHARS}-character limit`));

describe("InstructionsDialog body cap", () => {
  it("blocks saving an edited over-cap body and unblocks at exactly the cap", async () => {
    serveLegacySet();
    render(<InstructionsDialog open onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "edit" }));

    const bodyField = screen.getByLabelText("Instructions");
    const save = () => screen.getByRole("button", { name: "Save" });

    fireEvent.change(bodyField, { target: { value: "y".repeat(MAX_BODY_CHARS + 1) } });
    expect(overCapAlert()).toBeDefined();
    expect(save()).toBeDisabled();

    fireEvent.change(bodyField, { target: { value: "y".repeat(MAX_BODY_CHARS) } });
    expect(overCapAlert()).toBeUndefined();
    expect(save()).toBeEnabled();
  });
});
