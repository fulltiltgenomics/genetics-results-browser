import { PropsWithChildren } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { DatasetsDialog } from "./DatasetsDialog";
import { useChatOptionsStore } from "./useChatOptions";

const GNOMAD = { name: "gnomad_variant", description: "", category: null, source: "external" };
const ALPHAGENOME = {
  name: "get_alphagenome_variant_predictions",
  description: "",
  category: "AlphaGenome variant predictions (opt-in)",
  source: "local",
};

const serve = (tools: object[]) => {
  server.use(
    http.get("*/api/v1/datasets", () => HttpResponse.json([])),
    http.get("*/v1/tools", () => HttpResponse.json(tools))
  );
};

const renderDialog = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<DatasetsDialog open onClose={vi.fn()} />, { wrapper });
};

describe("DatasetsDialog live external resources", () => {
  // the deployment's ALPHAGENOME_ENABLED switch is visible to the browser only through the
  // resolved tool list, so the row follows that list rather than a build-time constant
  it("lists AlphaGenome when the chat server offers its tool", async () => {
    serve([GNOMAD, ALPHAGENOME]);
    useChatOptionsStore.setState({ toolProfile: "nocode" });

    renderDialog();

    expect(await screen.findByText("AlphaGenome")).toBeInTheDocument();
    expect(screen.getByText("gnomAD")).toBeInTheDocument();
  });

  it("omits AlphaGenome when the deployment has withdrawn its tool", async () => {
    serve([GNOMAD]);
    useChatOptionsStore.setState({ toolProfile: "nocode" });

    renderDialog();

    // the always-on rows render before the tools query answers; wait for the datasets
    // request to settle so a late AlphaGenome row would have had its chance to appear
    await waitFor(() =>
      expect(screen.getByText("Hover over dataset names to see more information about each dataset.")).toBeInTheDocument()
    );
    expect(screen.getByText("gnomAD")).toBeInTheDocument();
    expect(screen.queryByText("AlphaGenome")).not.toBeInTheDocument();
  });
});
