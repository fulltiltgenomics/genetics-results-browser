import { QuantLevel } from "../types/types.normalized";

// the eQTL Catalogue quant level is the suffix after the last "|" of trait_original
// ("ENSG..._19_45068055_45068058|exon" -> "exon"; "APOE.5312.49.3..1|aptamer" -> null).
// only these tokens are valid levels — anything else (e.g. pQTL "aptamer") yields null.
// mirrors bff/normalize.ts parseQuantLevel; the BFF keeps its own copy because its tsconfig
// scope excludes src/ runtime modules (same reason bff/coding.ts mirrors src/utils/coding.ts).
const QUANT_LEVELS: ReadonlySet<string> = new Set(["ge", "exon", "tx", "txrev", "leafcutter"]);

export const parseQuantLevel = (traitOriginal: string | null | undefined): QuantLevel | null => {
  if (!traitOriginal) return null;
  const idx = traitOriginal.lastIndexOf("|");
  if (idx === -1) return null;
  const suffix = traitOriginal.slice(idx + 1);
  return QUANT_LEVELS.has(suffix) ? (suffix as QuantLevel) : null;
};
