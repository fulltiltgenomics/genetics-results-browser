import { upstreamJson, upstreamTsv, UpstreamError } from "./upstream.js";

// canonical internal id is colon-separated chr:pos:ref:alt (GRCh38); accept the usual CPRA
// separators (- _ | / \) and an optional chr prefix, mirroring the MCP _parse_variant_list.
const VARIANT_RE = /^(?:chr)?(\d{1,2}|X|Y|MT):(\d+):([ACGT]+):([ACGT]+)$/i;
const CPRA_SEP_RE = /[-_|/\\]/g;
const RSID_RE = /^rs\d+$/i;

export interface ParsedRow {
  /** canonical chr:pos:ref:alt for direct variant ids; null when the token is an rsid or unparseable. */
  variant: string | null;
  /** original rsid token (lowercased) when the input row was an rsid. */
  rsid: string | null;
  raw: string;
  beta?: number;
  value?: number | string;
}

export const normalizeVariant = (raw: string): string | null => {
  const tryMatch = (s: string): string | null => {
    const m = VARIANT_RE.exec(s);
    if (!m) return null;
    const chr = m[1] === "23" ? "X" : m[1].toUpperCase().replace(/^MT$/, "MT");
    return `${chr}:${m[2]}:${m[3].toUpperCase()}:${m[4].toUpperCase()}`;
  };
  const direct = tryMatch(raw);
  if (direct) return direct;
  // normalize CPRA separators to colon and chr23 -> X, then retry
  const normalized = raw.replace(CPRA_SEP_RE, ":").replace(/^(?:chr)?23:/i, "X:");
  return tryMatch(normalized);
};

/**
 * Parse the free-text variant-list input the UI produces: one entry per line, optional
 * tab/whitespace/comma-separated `beta` and custom `value` columns (mirrors the legacy input box).
 * Each row is classified as a direct variant id, an rsid (resolved later), or unparseable.
 */
export const parseInputRows = (text: string): ParsedRow[] => {
  const normalized = text.replace(/\\n/g, "\n");
  const lines = normalized
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines.map((line): ParsedRow => {
    // tab-separated is the canonical UI format (variant\tbeta\tvalue); fall back to whitespace
    const fields = (line.includes("\t") ? line.split("\t") : line.split(/\s+/)).map((f) => f.trim());
    const token = fields[0];

    const row: ParsedRow = { variant: null, rsid: null, raw: token };
    if (RSID_RE.test(token)) {
      row.rsid = token.toLowerCase();
    } else {
      row.variant = normalizeVariant(token);
    }

    if (fields[1] !== undefined && fields[1] !== "") {
      const b = Number(fields[1]);
      if (!Number.isNaN(b)) row.beta = b;
    }
    if (fields[2] !== undefined && fields[2] !== "") {
      const n = Number(fields[2]);
      row.value = Number.isNaN(n) ? fields[2] : n;
    }
    return row;
  });
};

interface RsidLookupRow {
  rsid: string;
  variants: string[]; // colon-separated chr:pos:ref:alt
}

/**
 * Resolve rsid tokens to canonical variant ids via GET /v1/rsid/variants?rsids=rs1,rs2.
 * Returns a map rsid -> [variantId,...] ([] when the rsid is unknown to the db).
 */
export const resolveRsids = async (rsids: string[]): Promise<Record<string, string[]>> => {
  const unique = [...new Set(rsids.map((r) => r.toLowerCase()))];
  if (unique.length === 0) return {};
  const rows = await upstreamJson<RsidLookupRow[]>("/v1/rsid/variants", {
    query: { rsids: unique.join(",") },
  });
  const map: Record<string, string[]> = {};
  for (const r of rows ?? []) {
    map[r.rsid.toLowerCase()] = (r.variants ?? []).map((v) => v.replace(/-/g, ":"));
  }
  // ensure every requested rsid has an entry even if the upstream omitted it
  for (const r of unique) if (!(r in map)) map[r] = [];
  return map;
};

export interface ResolvedInput {
  rows: ParsedRow[];
  /** canonical variant ids to query upstream (direct ids + rsid-resolved, deduped, order-stable). */
  variantIds: string[];
  rsidMap: Record<string, string[]>; // rsid -> resolved variant ids (camelCased InputVariants.rsidMap)
  notFound: string[]; // rsids that resolved to nothing
  unparsed: string[]; // tokens that are neither a valid variant nor an rsid
  /** per-variant user beta / custom value, keyed by canonical variant id. */
  betaByVariant: Record<string, number>;
  valueByVariant: Record<string, number | string>;
}

/** Parse the input text and resolve any rsids into the canonical variant set for fan-out. */
export const resolveInput = async (text: string): Promise<ResolvedInput> => {
  const rows = parseInputRows(text);
  const rsidTokens = rows.filter((r) => r.rsid).map((r) => r.rsid as string);
  const rsidMap = await resolveRsids(rsidTokens);

  const variantIds: string[] = [];
  const seen = new Set<string>();
  const notFound: string[] = [];
  const unparsed: string[] = [];
  const betaByVariant: Record<string, number> = {};
  const valueByVariant: Record<string, number | string> = {};

  const addVariant = (vid: string, row: ParsedRow): void => {
    if (!seen.has(vid)) {
      seen.add(vid);
      variantIds.push(vid);
    }
    // last write wins for duplicate inputs; betas/values attach to the canonical id
    if (row.beta !== undefined) betaByVariant[vid] = row.beta;
    if (row.value !== undefined) valueByVariant[vid] = row.value;
  };

  for (const row of rows) {
    if (row.variant) {
      addVariant(row.variant, row);
    } else if (row.rsid) {
      const resolved = rsidMap[row.rsid] ?? [];
      if (resolved.length === 0) notFound.push(row.raw);
      else for (const vid of resolved) addVariant(vid, row);
    } else {
      unparsed.push(row.raw);
    }
  }

  return { rows, variantIds, rsidMap, notFound, unparsed, betaByVariant, valueByVariant };
};

// a single credible-set lead row from /v1/credible_sets_by_phenotype_leads (cs_header_schema subset)
interface CsLeadRow {
  chr: number;
  pos: number;
  ref: string;
  alt: string;
  beta?: number | null;
  cs_id: string;
}

/**
 * Expand a `pheno:{resource}:{code}` token into a variant<TAB>beta list: the lead variant of each
 * of that phenotype's credible sets, with the data's effect size as the beta. The upstream
 * /v1/credible_sets_by_phenotype_leads endpoint streams the per-phenotype file and returns one lead
 * per cs_id (highest pip). The returned text feeds straight into resolveInput, so the betas land in
 * betaByVariant exactly like a user-pasted beta column — no other parse changes needed.
 *
 * Returns null when the token isn't a `pheno:` token or the phenotype is unknown (404), so the
 * caller falls back to the normal variant-list / named-set paths.
 */
export const maybeExpandPhenotypeLeads = async (text: string): Promise<string | null> => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("pheno:") || /\s/.test(trimmed)) return null;
  // pheno:{resource}:{code} — split on the first two colons; a code may itself contain colons
  const parts = trimmed.split(":");
  const resource = parts[1];
  const code = parts.slice(2).join(":");
  if (!resource || !code) return null;

  try {
    const rows = await upstreamJson<CsLeadRow[]>(
      `/v1/credible_sets_by_phenotype_leads/${encodeURIComponent(resource)}/${encodeURIComponent(code)}`,
      { query: { format: "json", interval: 95 } }
    );
    if (!rows?.length) return null;
    return rows
      .map((r) => {
        const variant = `${r.chr}-${r.pos}-${r.ref}-${r.alt}`;
        return r.beta != null ? `${variant}\t${r.beta}` : variant;
      })
      .join("\n");
  } catch (err) {
    // unknown phenotype -> 404 -> not a usable pheno token; any other failure is genuine
    if (err instanceof UpstreamError && err.status === 404) return null;
    throw err;
  }
};

interface VariantSetResponse {
  name: string;
  variants: string[];
}

/**
 * Expand a named curated variant set (e.g. "FinnGen_enriched_202505", "COVID19_HGI_severity") into
 * its newline-joined variant list via GET /v1/variant_sets/{name}. The legacy backend resolved these
 * tokens server-side; the new genetics-results-api serves the curated lists through this endpoint.
 *
 * Returns the expanded variant text, or null when the query is not a named-set token (a multi-token
 * list, a bare variant id, an rsid, or an unknown set name) so the caller falls back to the normal
 * variant-list parse. Only single bare tokens that are NOT a variant/rsid trigger the lookup, so a
 * normal variant list never pays the extra round-trip.
 */
/**
 * Consequences that count as "coding" for a gene query. Verbatim the coding_set the pre-refactor
 * Flask backend used (server.py, commit 2acbbf3), translated from its gnomAD consequence labels to
 * the VEP terms the annotation files carry. Deliberately EXCLUDES synonymous_variant and
 * splice_region_variant: the old set was protein-altering + essential-splice only.
 */
const CODING_CONSEQUENCES: ReadonlySet<string> = new Set([
  "missense_variant",
  "frameshift_variant",
  "inframe_insertion",
  "inframe_deletion",
  "transcript_ablation",
  "stop_gained",
  "stop_lost",
  "start_lost",
  "splice_acceptor_variant",
  "splice_donor_variant",
  "incomplete_terminal_codon_variant",
  "protein_altering_variant",
  "coding_sequence_variant",
]);

/**
 * gnomAD AF floor for gene expansion: a variant is kept when its AF is STRICTLY above this, which is
 * both what the old backend wrote (`AF > 1e-4`, commented out) and what the UI states verbatim, so
 * the label is exactly the rule. Without a floor a mid-size gene expands to thousands of coding
 * variants (SORT1: 2024, ~83% of them singletons that cannot be in any credible set) and the fan-out
 * cost is paid for rows that are empty in every tab. A null/"NA" AF passes rather than being dropped
 * — an unevaluable frequency is not evidence of rarity, mirroring how the client treats a null
 * mlog10p.
 */
export const GENE_CODING_MIN_AF = 1e-4;

/** HGNC-style symbol: starts with a letter, then alphanumerics and - . _ (never a colon). */
const GENE_SYMBOL_RE = /^[A-Za-z][A-Za-z0-9._-]*$/;

interface GnomadAnnoRow {
  chr: string | null;
  pos: string | null;
  ref: string | null;
  alt: string | null;
  AF: string | null;
  most_severe: string | null;
  gene_most_severe: string | null;
  rsids: string | null;
}

/**
 * Consequence/gene/rsid for a gene-expanded variant, taken from the gnomAD rows the expansion
 * already read. The fan-out annotates variants from the FinnGen annotation file, which has no row
 * for a variant FinnGen never genotyped — 43 of PCSK9's 50 coding variants — leaving the consequence
 * blank for variants gnomAD explicitly called coding. Deliberately carries NO frequency fields: af /
 * info / enrichmentNfe are FinnGen-specific quantities and gnomAD's AF is not a substitute (the
 * per-population gnomAD frequencies arrive separately via the lazy POST /v1/gnomad path).
 */
export interface GeneAnnotationFallback {
  mostSevere: string;
  geneMostSevere: string | null;
  rsid: string | null;
}

export interface GeneExpansion {
  /** the gene token as the user typed it, for display back to them. */
  gene: string;
  /** canonical variant id -> its gnomAD annotation, for variants the FinnGen fan-out won't cover. */
  annotations: Record<string, GeneAnnotationFallback>;
  /**
   * newline-joined canonical variant ids, ready to feed resolveInput. EMPTY when the gene resolved
   * upstream but has no qualifying coding variants (a lncRNA/miRNA like XIST or MIR21): that is a
   * real answer about a real gene, so it must not fall through to the "unparseable token" path,
   * which would tell the user to check their chr-pos-ref-alt formatting.
   */
  text: string;
}

/**
 * Expand a bare gene symbol into that gene's coding variants, which then become the query's input
 * variant list. This restores the pre-refactor behavior (server.py `looks_like_a_gene` ->
 * `gene_results`), which was lost when the credible-set rewrite replaced that backend.
 *
 * Sourced from gnomAD annotations over the gene's range (GET /v1/variant_annotation/gnomad?gene=),
 * the same source the old backend used, keeping only variants whose MOST SEVERE consequence is
 * coding IN THIS GENE — the range spans neighbouring genes, so gene_most_severe is what scopes the
 * result, not the range.
 *
 * NOT sourced from credible sets: the old backend also required each variant to have association or
 * fine-mapping data, but that filter cannot carry over. The assoc path no longer exists, and
 * requiring credible-set membership returns NOTHING for genes whose signal is entirely regulatory
 * (SORT1 has 169 credible-set member variants and not one is coding). The variant list is the input;
 * which of them have data is what the tables then show.
 *
 * Returns null when the token can't be a gene symbol, is unknown upstream (404), or names nothing in
 * the annotation — the caller then falls back to the normal parse, which marks the token unparsed.
 * A KNOWN gene with no qualifying coding variants returns an expansion with empty text instead; see
 * GeneExpansion.text.
 */
export const maybeExpandGeneCodingVariants = async (
  text: string
): Promise<GeneExpansion | null> => {
  const trimmed = text.trim();
  // a gene symbol is a single bare token: no internal whitespace, no beta/value columns
  if (trimmed === "" || /\s/.test(trimmed)) return null;
  // tokens that already are a variant id or rsid are handled by the normal parse path
  if (normalizeVariant(trimmed) !== null || RSID_RE.test(trimmed)) return null;
  // shape-check before spending an upstream call: HGNC symbols start with a letter and carry no
  // colons, so this also keeps an unrecognized `pheno:{resource}:{code}` token off the gene path
  // (it reaches here once its own lookup 404s, and must stay unparsed rather than become a gene).
  if (!GENE_SYMBOL_RE.test(trimmed)) return null;

  let rows: GnomadAnnoRow[];
  try {
    rows = await upstreamTsv<GnomadAnnoRow>("/v1/variant_annotation/gnomad", {
      query: { gene: trimmed },
    });
  } catch (err) {
    // unknown gene -> 404 -> not a gene token; any other upstream failure is genuine
    if (err instanceof UpstreamError && err.status === 404) return null;
    throw err;
  }

  const wanted = trimmed.toUpperCase();
  const variants: string[] = [];
  const seen = new Set<string>();
  const annotations: Record<string, GeneAnnotationFallback> = {};
  // does the annotation attribute ANY variant to this symbol? that, not the HTTP status, is what
  // tells us the token names a real gene — an unknown symbol 404s upstream, but a token that merely
  // resolved to a region would otherwise be reported back to the user as a gene.
  let attributed = 0;
  for (const r of rows) {
    if ((r.gene_most_severe ?? "").toUpperCase() !== wanted) continue;
    attributed++;
    if (!r.most_severe || !CODING_CONSEQUENCES.has(r.most_severe)) continue;
    const af = r.AF === null ? null : Number(r.AF);
    if (af !== null && Number.isFinite(af) && af <= GENE_CODING_MIN_AF) continue;
    if (!r.chr || !r.pos || !r.ref || !r.alt) continue;
    // canonicalize through the same normalizer resolveInput uses, so the annotation map keys match
    // the variant ids the fan-out later looks up (chr 23 -> X, casing)
    const id = normalizeVariant(`${r.chr}:${r.pos}:${r.ref}:${r.alt}`);
    if (id === null) continue;
    // gnomAD lists exome and genome records separately, so the same variant can appear twice
    if (seen.has(id)) continue;
    seen.add(id);
    variants.push(id);
    annotations[id] = {
      mostSevere: r.most_severe,
      geneMostSevere: r.gene_most_severe,
      // the column is plural and can carry several ids; the first is enough to label the row
      rsid: r.rsids ? (r.rsids.split(/[,;&|]/)[0].trim() || null) : null,
    };
  }
  if (attributed === 0) return null;
  // the symbol names real annotated variants, so an empty list here means "this gene has no coding
  // variants" (XIST, MIR21), not "this is not a gene" — keep the gene identity either way.
  return { gene: trimmed, text: variants.join("\n"), annotations };
};

export const maybeExpandVariantSet = async (text: string): Promise<string | null> => {
  const trimmed = text.trim();
  // a named set is a single bare token: no internal whitespace/newlines, no tab-separated columns
  if (trimmed === "" || /\s/.test(trimmed)) return null;
  // tokens that already are a variant id or rsid are handled by the normal parse path
  if (normalizeVariant(trimmed) !== null || RSID_RE.test(trimmed)) return null;

  try {
    const res = await upstreamJson<VariantSetResponse>(
      `/v1/variant_sets/${encodeURIComponent(trimmed)}`
    );
    const variants = res?.variants ?? [];
    return variants.length ? variants.join("\n") : null;
  } catch (err) {
    // an unknown set name is a 404 -> not a named set, let the normal path mark it unparsed.
    // any other upstream failure is genuine and should surface.
    if (err instanceof UpstreamError && err.status === 404) return null;
    throw err;
  }
};
