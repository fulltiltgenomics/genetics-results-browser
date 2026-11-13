import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../structure/StructureViewer", () => ({
  default: ({ name }: { name: string }) => <div data-testid="viewer-stub">{name}</div>,
}));

import { MessageContent } from "./MessageContent";
import { encodeFileMarker } from "./fileMarker";

describe("MessageContent with a structure-view artifact", () => {
  it("draws a .structure-view.json file as a structure, not as a download", async () => {
    const marker = encodeFileMarker("application/json", "celsr2.structure-view.json", btoa("{}"));
    render(<MessageContent content={`Here it is.\n\n${marker}\n\nDone.`} />);
    expect(await screen.findByTestId("viewer-stub")).toHaveTextContent("celsr2.structure-view.json");
    expect(screen.queryByRole("button", { name: /celsr2/ })).toBeNull();
    expect(screen.getByText("Done.")).toBeInTheDocument();
  });

  it("leaves any other JSON file a download", () => {
    const marker = encodeFileMarker("application/json", "results.json", btoa("{}"));
    render(<MessageContent content={`Here it is.\n\n${marker}`} />);
    expect(screen.getByRole("button", { name: /results\.json/ })).toBeInTheDocument();
    expect(screen.queryByTestId("viewer-stub")).toBeNull();
  });
});
