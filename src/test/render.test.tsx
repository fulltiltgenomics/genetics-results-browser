import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// proves jsdom + RTL + JSX transform are wired up
describe("jsdom + RTL", () => {
  it("renders a component into the DOM", () => {
    render(<div>hello test</div>);
    expect(screen.getByText("hello test")).toBeInTheDocument();
  });
});
