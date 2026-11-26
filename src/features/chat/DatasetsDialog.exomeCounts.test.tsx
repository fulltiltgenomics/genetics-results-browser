import { PropsWithChildren } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { server } from "../../test/msw/server";
import { DatasetsDialog } from "./DatasetsDialog";

const dataset = (dataset_id: string, products: object) => ({
  dataset_id,
  resource: "a resource",
  version: "v1",
  description: "",
  author: "",
  publication_date: "NA",
  trait_type: "binary",
  data_type: "exome",
  products,
});

describe("DatasetsDialog exome categories", () => {
  // the catalogue lists an exome dataset whether the API serves variant results for it or it
  // only has allele counts in the database; the two must not share a heading
  it("lists count-only exome datasets apart from the ones with association results", async () => {
    server.use(
      http.get("*/api/v1/datasets", () =>
        HttpResponse.json([
          dataset("genebass_exome", { exome_results: true }),
          dataset("schema1_exome", {}),
        ])
      ),
      http.get("*/v1/tools", () => HttpResponse.json([]))
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(<DatasetsDialog open onClose={vi.fn()} />, { wrapper });

    const counts = (await screen.findByText("Exome variant allele counts")).parentElement!;
    expect(within(counts).getByText("schema1_exome")).toBeInTheDocument();
    expect(within(counts).queryByText("genebass_exome")).not.toBeInTheDocument();

    const associations = screen.getByText("Exome variant associations").parentElement!;
    expect(within(associations).getByText("genebass_exome")).toBeInTheDocument();
    expect(within(associations).queryByText("schema1_exome")).not.toBeInTheDocument();
  });
});
