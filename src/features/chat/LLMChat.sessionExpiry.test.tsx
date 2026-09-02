import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("./schemaApi", () => ({
  useSchema: () => ({ data: undefined }),
}));

// the gateway's answer to an expired oauth2-proxy session: 302 -> /oauth2/start. With
// redirect: "manual" the browser hands that back opaque — status 0, no headers worth
// reading — instead of following it and resolving against the SSO landing page.
const opaqueRedirect = {
  ok: false,
  status: 0,
  type: "opaqueredirect",
  headers: { get: () => null },
};

const capturedInit: any = {};

vi.mock("@microsoft/fetch-event-source", () => ({
  fetchEventSource: vi.fn(async (_url: string, opts: any) => {
    capturedInit.redirect = opts.redirect;
    await opts.onopen(opaqueRedirect);
  }),
}));

import { LLMChat } from "./LLMChat";

function send(text: string) {
  const textbox = screen.getByRole("textbox");
  fireEvent.change(textbox, { target: { value: text } });
  fireEvent.submit(textbox.closest("form")!);
}

describe("LLMChat expired-session handling", () => {
  it("names the expired sign-in rather than the redirect's status code", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(<LLMChat />);

    send("two locuszoom plots please");

    await waitFor(() => expect(screen.getByText(/sign-in expired/i)).toBeTruthy());
    // the failure mode this replaces: fetch follows the 302, the SSO landing page comes
    // back 200 text/html, and the only thing left to report is its status code
    expect(screen.queryByText(/HTTP 200/)).toBeNull();
  });

  it("asks fetch not to follow the redirect, since following it drops the POST body", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(<LLMChat />);

    send("anything");

    await waitFor(() => expect(capturedInit.redirect).toBe("manual"));
  });
});
