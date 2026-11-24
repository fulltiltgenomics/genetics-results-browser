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
  it("links to the chat and the annotation tool, in that order, and not to the gene evidence page", () => {
    const links = navAt("/about").getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Chat", "/"],
      ["Anno", "/anno"],
    ]);
    expect(links.every((a) => !a.hasAttribute("aria-current"))).toBe(true);
  });

  it.each([
    ["/", "Chat"],
    ["/chat/abc", "Chat"],
    ["/anno", "Anno"],
    ["/ld", "Anno"],
  ])("marks the page %s is part of as current", (path, label) => {
    const current = navAt(path)
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual([label]);
  });

  it("marks nothing as current on the gene evidence page, which has no link", () => {
    const links = navAt("/gene/APOE").getAllByRole("link");
    expect(links.every((a) => !a.hasAttribute("aria-current"))).toBe(true);
  });
});
