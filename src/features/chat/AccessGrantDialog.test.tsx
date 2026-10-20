import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { AccessGrantDialog } from "./AccessGrantDialog";

const EXPIRES = "2026-10-25T03:59:59+00:00";

const wireGrant = (email: string, overrides: Record<string, unknown> = {}) => ({
  email,
  granted_by: "admin@example.org",
  granted_at: "2026-10-19T12:00:00+00:00",
  expires_at: EXPIRES,
  revoked_at: null,
  email_sent_at: "2026-10-19T12:00:01+00:00",
  email_error: null,
  active: true,
  ...overrides,
});

const renderDialog = () =>
  render(<AccessGrantDialog open onClose={vi.fn()} label="ASHG special" expiresAt={EXPIRES} />);

const typeAndSubmit = (email: string) => {
  fireEvent.change(screen.getByLabelText("e-mail address"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Grant access" }));
};

beforeEach(() => {
  server.use(http.get("*/v1/admin/access-grants", () => HttpResponse.json([])));
});

describe("AccessGrantDialog", () => {
  it("asks for an e-mail and offers Grant access, with the deadline in Eastern time", async () => {
    renderDialog();
    expect(screen.getByText("Enter a Google/Apple/Microsoft e-mail")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grant access" })).toBeInTheDocument();
    expect(await screen.findByText(/Access until Sat, Oct 24, 2026, 11:59 PM EDT/)).toBeInTheDocument();
  });

  it("grants a gmail address and reports the e-mail as sent", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post("*/v1/admin/access-grants", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          granted: true,
          already_active: false,
          provider: "google",
          grant: wireGrant("someone@gmail.com"),
          email_sent: true,
          email_error: null,
        });
      }),
    );
    renderDialog();
    typeAndSubmit("Someone@gmail.com");

    expect(await screen.findByText(/Access granted to someone@gmail.com until .*; e-mail sent\./)).toBeInTheDocument();
    // lower-cased before it leaves the browser so the server never stores two spellings
    expect(bodies).toEqual([{ email: "someone@gmail.com", confirm_unknown_provider: false }]);
  });

  it("asks for confirmation on an unknown provider and re-posts with the confirmation", async () => {
    const bodies: Array<{ confirm_unknown_provider: boolean }> = [];
    server.use(
      http.post("*/v1/admin/access-grants", async ({ request }) => {
        const body = (await request.json()) as { confirm_unknown_provider: boolean };
        bodies.push(body);
        if (!body.confirm_unknown_provider) {
          return HttpResponse.json({
            granted: false,
            already_active: false,
            provider: "unknown",
            grant: null,
            email_sent: null,
            email_error: null,
          });
        }
        return HttpResponse.json({
          granted: true,
          already_active: false,
          provider: "unknown",
          grant: wireGrant("x@uni.edu"),
          email_sent: true,
          email_error: null,
        });
      }),
    );
    renderDialog();
    typeAndSubmit("x@uni.edu");

    expect(
      await screen.findByText(/x@uni.edu does not look like a Google, Apple or Microsoft address/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Grant anyway" }));

    expect(await screen.findByText(/Access granted to x@uni.edu/)).toBeInTheDocument();
    expect(bodies.map((b) => b.confirm_unknown_provider)).toEqual([false, true]);
  });

  it("offers Resend when the grant stuck but the e-mail did not go out", async () => {
    server.use(
      http.post("*/v1/admin/access-grants", () =>
        HttpResponse.json({
          granted: true,
          already_active: false,
          provider: "apple",
          grant: wireGrant("a@icloud.com", { email_sent_at: null, email_error: "smtp refused" }),
          email_sent: false,
          email_error: "smtp refused",
        }),
      ),
    );
    renderDialog();
    typeAndSubmit("a@icloud.com");

    expect(await screen.findByText(/e-mail FAILED: smtp refused/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Resend" }).length).toBeGreaterThan(0);
  });

  it("lists existing grants with their status and lets an active one be revoked", async () => {
    const revoked: string[] = [];
    server.use(
      http.get("*/v1/admin/access-grants", () =>
        HttpResponse.json([
          wireGrant("a@gmail.com"),
          wireGrant("old@gmail.com", { active: false }),
        ]),
      ),
      http.delete("*/v1/admin/access-grants/:email", ({ params }) => {
        revoked.push(decodeURIComponent(String(params.email)));
        return HttpResponse.json({ status: "revoked" });
      }),
    );
    renderDialog();

    expect(await screen.findByText("a@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "revoke a@gmail.com" }));
    await waitFor(() => expect(revoked).toEqual(["a@gmail.com"]));
  });
});
