import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import McpTokenDialog from "./McpTokenDialog";

const PLAIN = "AbCdEfGh" + "x".repeat(35);
const OLD_PLAIN = "OldKey12" + "y".repeat(35);

const wire = (id: number, prefix: string, active: boolean) => ({
  id,
  prefix,
  name: null,
  created_at: "2026-10-20T12:33:22+00:00",
  last_used_at: null,
  is_active: active,
  expires_at: "2027-01-18T12:33:22+00:00",
});

// an in-memory token store so the mocked routes answer the way the backend does
let rows: ReturnType<typeof wire>[];
beforeEach(() => {
  rows = [];
  server.use(
    http.get("*/v1/tokens", () => HttpResponse.json(rows)),
    http.post("*/v1/tokens", () => {
      const id = rows.length + 1;
      const plain = id === 1 ? OLD_PLAIN : PLAIN;
      rows.push(wire(id, plain.slice(0, 8), true));
      return HttpResponse.json({ id, token: plain, prefix: plain.slice(0, 8), name: null, created_at: "2026-10-20T12:33:22+00:00" });
    }),
    http.delete("*/v1/tokens/:id", ({ params }) => {
      const row = rows.find((r) => r.id === Number(params.id));
      if (!row) return new HttpResponse(null, { status: 404 });
      row.is_active = false;
      return HttpResponse.json({ status: "revoked" });
    }),
  );
});

const create = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Create key" }));
  await screen.findByText(/Key created/);
};

const revoke = (prefix: string) => {
  const row = screen.getByText(`${prefix}...`).closest("li")!;
  fireEvent.click(row.querySelector("button")!);
};

describe("McpTokenDialog", () => {
  it("shows the plaintext once after creation", async () => {
    render(<McpTokenDialog open onClose={vi.fn()} />);
    expect(await screen.findByText(/No active keys/)).toBeInTheDocument();
    await create();
    expect(screen.getByDisplayValue(OLD_PLAIN)).toBeInTheDocument();
    expect(await screen.findByText("OldKey12...")).toBeInTheDocument();
  });

  it("drops the plaintext when the key it belongs to is revoked", async () => {
    render(<McpTokenDialog open onClose={vi.fn()} />);
    await screen.findByText(/No active keys/);
    await create();
    await screen.findByText("OldKey12...");
    revoke("OldKey12");
    await waitFor(() => expect(screen.queryByText("OldKey12...")).not.toBeInTheDocument());
    expect(screen.queryByText(/Key created/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(OLD_PLAIN)).not.toBeInTheDocument();
    expect(screen.getByText(/No active keys/)).toBeInTheDocument();
  });

  it("keeps an uncopied new key on screen when an older key is revoked", async () => {
    render(<McpTokenDialog open onClose={vi.fn()} />);
    await screen.findByText(/No active keys/);
    await create();
    await screen.findByText("OldKey12...");
    await create();
    await screen.findByText("AbCdEfGh...");
    expect(screen.getByDisplayValue(PLAIN)).toBeInTheDocument();
    revoke("OldKey12");
    await waitFor(() => expect(screen.queryByText("OldKey12...")).not.toBeInTheDocument());
    expect(screen.getByDisplayValue(PLAIN)).toBeInTheDocument();
    expect(screen.getByText("AbCdEfGh...")).toBeInTheDocument();
  });
});
