import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { renderHook, waitFor as waitForHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import GeneEvidenceTab from "./GeneEvidenceTab";
import {
  parseGeneBurdenTsv,
  useGeneBurden,
  useGeneDisease,
  useGeneExpression,
} from "@/store/serverQuery";

// fresh client with retries off so a failing query rejects immediately instead of retrying for seconds
const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};

describe("parseGeneBurdenTsv", () => {
  const tsv = [
    "dataset\ttrait\tgene\tgene_id\tgene_chr\tgene_start_pos\tgene_end_pos\tannotation\tmlog10p_burden\tbeta\tse\ttotal_variants\ttotal_variants_pheno\tn_cases\tn_controls\ttrait_original\tflags",
    "genebass\tApolipoprotein A\tAPOE\tENSG00000130203\t19\t44905791\t44909393\tmissense|LC\t6.28038e+00\t-2.84859e-03\t5.67767e-04\t223\t211\t343018\tNA\tcontinuous_30630\tNA",
    "genebass\tC-reactive protein\tAPOE\tENSG00000130203\t19\t44905791\t44909393\tmissense|LC\t9.5\t-2.68729e-03\t5.90874e-04\t223\t219\t376005\tNA\tcontinuous_30710\tNA",
  ].join("\n");

  it("parses header-indexed rows with numeric coercion and NA -> null", () => {
    const rows = parseGeneBurdenTsv(tsv);
    expect(rows).toHaveLength(2);
    const top = rows[0];
    expect(top.trait).toBe("C-reactive protein"); // higher -log10p sorts first
    expect(top.mlog10pBurden).toBeCloseTo(9.5);
    expect(top.beta).toBeCloseTo(-0.00268729);
    expect(top.nCases).toBe(376005);
    expect(top.nControls).toBeNull(); // "NA" -> null
    expect(top.annotation).toBe("missense|LC");
  });

  it("sorts by burden -log10(p) descending", () => {
    const rows = parseGeneBurdenTsv(tsv);
    expect(rows.map((r) => r.mlog10pBurden)).toEqual([9.5, expect.closeTo(6.28038)]);
  });

  it("returns [] for an empty body", () => {
    expect(parseGeneBurdenTsv("")).toEqual([]);
  });
});

describe("gene-evidence hooks (MSW)", () => {
  it("useGeneBurden parses the TSV fixture into sorted rows", async () => {
    const { result } = renderHook(() => useGeneBurden("APOE"), { wrapper: makeWrapper() });
    await waitForHook(() => expect(result.current.isSuccess).toBe(true));
    const rows = result.current.data!;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].gene).toBe("APOE");
    // sorted descending
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].mlog10pBurden ?? -Infinity).toBeGreaterThanOrEqual(
        rows[i].mlog10pBurden ?? -Infinity
      );
    }
  });

  it("useGeneExpression parses level strings and sorts descending", async () => {
    const { result } = renderHook(() => useGeneExpression("APOE"), { wrapper: makeWrapper() });
    await waitForHook(() => expect(result.current.isSuccess).toBe(true));
    const rows = result.current.data!;
    expect(rows.length).toBeGreaterThan(0);
    expect(typeof rows[0].level).toBe("number");
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].level ?? -Infinity).toBeGreaterThanOrEqual(rows[i].level ?? -Infinity);
    }
  });

  it("useGeneDisease maps snake_case to GeneDiseaseRow", async () => {
    const { result } = renderHook(() => useGeneDisease("APOE"), { wrapper: makeWrapper() });
    await waitForHook(() => expect(result.current.isSuccess).toBe(true));
    const rows = result.current.data!;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      geneSymbol: "APOE",
      resource: "gencc",
    });
    expect(rows[0].diseaseTitle).toBeTruthy();
    expect(rows[0].modeOfInheritance).toBeTruthy();
  });
});

describe("GeneEvidenceTab (component)", () => {
  it("renders all three evidence sections populated for APOE", async () => {
    render(<GeneEvidenceTab geneName="APOE" />, { wrapper: makeWrapper() });

    expect(screen.getByText("Gene burden")).toBeInTheDocument();
    expect(screen.getByText("Expression")).toBeInTheDocument();
    expect(screen.getByText("Gene-disease (Mendelian)")).toBeInTheDocument();

    // burden trait from the fixture (the fixture has multiple Apolipoprotein A rows)
    await waitFor(() =>
      expect(screen.getAllByText("Apolipoprotein A").length).toBeGreaterThan(0)
    );
    // a gene-disease row from the fixture
    expect(screen.getAllByText(/hyperlipoproteinemia/i).length).toBeGreaterThan(0);
  });
});
