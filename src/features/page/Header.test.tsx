import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Header from "./Header";

const navAt = (path: string) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Header />
    </MemoryRouter>
  );
  return within(screen.getByRole("navigation", { name: "main" }));
};

describe("Header navigation", () => {
  it("links to the chat, the gene evidence page and the annotation tool, in that order", () => {
    const links = navAt("/about").getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Chat", "/"],
      ["Gene Evidence", "/gene"],
      ["Anno", "/anno"],
    ]);
    expect(links.every((a) => !a.hasAttribute("aria-current"))).toBe(true);
  });

  it.each([
    ["/", "Chat"],
    ["/chat/abc", "Chat"],
    ["/anno", "Anno"],
    ["/ld", "Anno"],
    ["/gene/APOE", "Gene Evidence"],
  ])("marks the page %s is part of as current", (path, label) => {
    const current = navAt(path)
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual([label]);
  });
});
