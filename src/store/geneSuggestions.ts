/** "Did you mean" candidates for a gene query that named no gene, from the search's near-misses. */

export interface GeneSearchCandidate {
  type: string;
  symbol: string;
  match_type?: string;
  match_score?: number;
  // the indexed string that matched: the symbol, an alias, the gene name or the Ensembl id
  matched_key?: string;
}

export interface GeneSuggestion {
  symbol: string;
  // what the query resembled, when that was not the symbol itself
  matchedOn: string | null;
}

export const MAX_GENE_SUGGESTIONS = 5;

/**
 * Prefix matches are kept as they are. A fuzzy match is kept only when the string it matched is
 * about as long as the query: the search scores a short symbol or alias contained in the query
 * ("PC" in "PCKS9", "A2" in "OZEMA24") above a real one-letter typo, and those are noise here.
 */
export const suggestGenes = (query: string, hits: GeneSearchCandidate[]): GeneSuggestion[] => {
  const q = query.trim();
  const tolerance = Math.max(1, Math.round(q.length * 0.15));
  const kept = hits.filter((h) => {
    if (h.type !== "gene") {
      return false;
    }
    if (h.match_type === "prefix") {
      return true;
    }
    const matched = h.matched_key ?? h.symbol;
    return Math.abs(matched.length - q.length) <= tolerance;
  });
  // stable, so equally scored hits keep the order the search ranked them in
  kept.sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0));
  const suggestions = new Map<string, GeneSuggestion>();
  for (const h of kept) {
    if (!suggestions.has(h.symbol)) {
      const matched = h.matched_key ?? h.symbol;
      suggestions.set(h.symbol, {
        symbol: h.symbol,
        matchedOn: matched.toLowerCase() === h.symbol.toLowerCase() ? null : matched,
      });
    }
  }
  return [...suggestions.values()].slice(0, MAX_GENE_SUGGESTIONS);
};
