import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isCoding, isLoF } from "./coding";
import { isCoding as bffIsCoding, isLoF as bffIsLoF } from "../../bff/coding";

// every most_severe value the annotation actually holds, from a GROUP BY over
// variant_annotation_v — so this list is what the data has, not what a term list imagines
const OBSERVED = [
  "intron_variant", "intergenic_variant", "regulatory_region_variant", "upstream_gene_variant",
  "downstream_gene_variant", "non_coding_transcript_exon_variant", "3_prime_UTR_variant",
  "missense_variant", "synonymous_variant", "5_prime_UTR_variant", "TF_binding_site_variant",
  "splice_region_variant", "stop_gained", "splice_donor_variant", "frameshift_variant",
  "inframe_deletion", "splice_acceptor_variant", "inframe_insertion", "start_lost",
  "mature_miRNA_variant", "stop_lost", "stop_retained_variant", "coding_sequence_variant",
  "protein_altering_variant", "incomplete_terminal_codon_variant", "TFBS_ablation",
  "non_coding_transcript_variant", "transcript_ablation",
];

describe("the coding definition", () => {
  it("squares only the terms that change the protein", () => {
    expect(OBSERVED.filter(isCoding).sort()).toEqual([
      "frameshift_variant",
      "inframe_deletion",
      "inframe_insertion",
      "incomplete_terminal_codon_variant",
      "missense_variant",
      "protein_altering_variant",
      "splice_acceptor_variant",
      "splice_donor_variant",
      "start_lost",
      "stop_gained",
      "stop_lost",
      "transcript_ablation",
    ].sort());
  });

  it.each([
    // in a coding sequence, protein unchanged
    "synonymous_variant",
    "coding_sequence_variant",
    "stop_retained_variant",
    // up to 8bp into an intron, so it establishes no coding position
    "splice_region_variant",
  ])("does not treat %s as coding", (term) => {
    expect(isCoding(term)).toBe(false);
  });

  it("accepts both spellings, because stripping is the module's job and not the caller's", () => {
    // a call site that forgot to strip used to match only the six suffix-less terms, which
    // under-reported coding variants instead of failing
    expect(isCoding("missense_variant")).toBe(true);
    expect(isCoding("missense")).toBe(true);
    expect(isLoF("splice_donor_variant")).toBe(true);
    expect(isLoF("splice_donor")).toBe(true);
  });

  it("agrees with the bff mirror on every observed term", () => {
    for (const term of OBSERVED) {
      expect(bffIsCoding(term), term).toBe(isCoding(term));
      expect(bffIsLoF(term), term).toBe(isLoF(term));
    }
  });

  it("keeps the two copies byte-identical below their headers", () => {
    // they cannot import each other: the BFF tsconfig only includes ./bff/*.ts. A textual
    // gate is what is left, and without it the pair drifts silently.
    const body = (path: string) =>
      readFileSync(path, "utf8").split("\n").filter((l) => !l.startsWith("//")).join("\n").trim();
    expect(body("bff/coding.ts")).toBe(body("src/utils/coding.ts"));
  });
});
