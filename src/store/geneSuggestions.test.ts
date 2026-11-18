import { describe, expect, it } from "vitest";
import { suggestGenes } from "./geneSuggestions";

const hit = (symbol: string, match_type: string, match_score: number, matched_key = symbol) => ({
  type: "gene",
  symbol,
  match_type,
  match_score,
  matched_key,
});

describe("suggestGenes", () => {
  it("drops short symbols contained in the query and keeps the one-letter typo", () => {
    const hits = [hit("PC", "fuzzy", 90), hit("PCSK9", "fuzzy", 80), hit("APC", "fuzzy", 72)];
    expect(suggestGenes("PCKS9", hits)).toEqual([{ symbol: "PCSK9", matchedOn: null }]);
  });

  it("ranks by score and says which alias the query resembled", () => {
    const hits = [
      hit("AR", "fuzzy", 90),
      hit("ARCN1", "fuzzy", 80),
      hit("PCSK9", "fuzzy", 91, "NARC-1"),
    ];
    expect(suggestGenes("narc1", hits)).toEqual([
      { symbol: "PCSK9", matchedOn: "NARC-1" },
      { symbol: "ARCN1", matchedOn: null },
    ]);
  });

  it("keeps prefix matches whatever their length, up to five, one per gene", () => {
    const hits = [
      ...["PCSK1N", "PCSK6-AS1", "PCSK1", "PCSK2", "PCSK4", "PCSK5"].map((s) =>
        hit(s, "prefix", 90)
      ),
      hit("PCSK1", "prefix", 90, "proprotein convertase subtilisin/kexin type 1"),
    ];
    expect(suggestGenes("PCSK", hits).map((s) => s.symbol)).toEqual([
      "PCSK1N",
      "PCSK6-AS1",
      "PCSK1",
      "PCSK2",
      "PCSK4",
    ]);
  });

  it("suggests nothing when every near-miss is noise", () => {
    const hits = [hit("EYA2", "fuzzy", 68), hit("ATP6V0A2", "fuzzy", 90, "a2")];
    expect(suggestGenes("OZEMA24", hits)).toEqual([]);
  });

  it("ignores hits that are not genes", () => {
    expect(suggestGenes("APOE", [{ type: "phenotype", symbol: "APOE" }])).toEqual([]);
  });
});
