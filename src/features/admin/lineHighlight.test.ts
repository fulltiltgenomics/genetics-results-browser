import { describe, it, expect } from "vitest";
import { dimColor, resolveLineStyle } from "./lineHighlight";

describe("dimColor", () => {
  it("converts a 6-digit hex to a low-alpha rgba", () => {
    expect(dimColor("#e6194b")).toBe("rgba(230, 25, 75, 0.15)");
  });

  it("expands a 3-digit hex", () => {
    expect(dimColor("#abc")).toBe("rgba(170, 187, 204, 0.15)");
  });

  it("honours a custom alpha", () => {
    expect(dimColor("#000000", 0.5)).toBe("rgba(0, 0, 0, 0.5)");
  });

  it("leaves non-hex colours untouched", () => {
    expect(dimColor("rgba(1,2,3,0.4)")).toBe("rgba(1,2,3,0.4)");
  });
});

describe("resolveLineStyle", () => {
  const base = "#3cb44b";
  const baseWidth = 1.5;

  it("uses the base colour and width when nothing is highlighted", () => {
    expect(resolveLineStyle(2, null, base, baseWidth)).toEqual({ color: base, width: 1.5 });
  });

  it("thickens the highlighted series and keeps its colour", () => {
    expect(resolveLineStyle(2, 2, base, baseWidth)).toEqual({ color: base, width: 2.5 });
  });

  it("dims other series when one is highlighted", () => {
    expect(resolveLineStyle(0, 2, base, baseWidth)).toEqual({
      color: "rgba(60, 180, 75, 0.15)",
      width: 1.5,
    });
  });
});
