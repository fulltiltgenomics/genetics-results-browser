# REFACTORING OF VARIANT ANNOTATION TOOL

This repo contains a legacy variant annotation tool and a new chat interface built on top of
that. The original variant annotation tool is in `master` and the chat interface is in this
`llm` branch built on top of `master`.

The chat interface is fine as of now. We want to refactor/rewrite the original annotation tool.
The major reason is that the data behind the tool is old and we have a new API
(`../genetics-results-api`, running at http://localhost:2000) we need to adopt.

The old API served p-value-filtered association data (down to p ≤ 0.005) that we no longer serve.
That data was shown alongside credible set data. The new API still serves credible set data, so we
are switching the interface to use **credible-set data only**, plus the new capabilities the API
adds (colocalization, gene burden, expression, gene-disease, full summary stats on demand).

---

## 1. ARCHITECTURE & DATA FLOW (the central change)

This is not a "drop one data type" tweak — **the backend contract changes completely**, so the data
layer is effectively a rewrite while the presentation layer is preserve-and-adapt.

### Old vs new contract

The current frontend hits a single fat aggregation endpoint on the *old* backend:

- `POST /v1/results { query }` → a fully-assembled `TableData` (per-variant `assoc` + `finemapped`
  grouped data, phenotype map, dataset map, input parsing, freq summary). See
  `src/store/serverQuery.ts:19`.
- plus `/v1/config`, `/v1/gene_cs/{gene}`, `/v1/dataset_metadata`, `/v1/trait_metadata`,
  `/v1/variant_annotation`.

The **new `genetics-results-api` has none of these**. It exposes granular, single-purpose endpoints:
`credible_sets_by_variant` (GET + POST batch), `credible_sets_by_gene`,
`summary_stats/{resource}/{data_type}`, `colocalization_by_variant`,
`colocalization_by_credible_set_id`, `variant_annotation/{source}`, `nearest_genes` (POST batch),
`search`, `datasets`, `resources`, `gene_based`, `expression_by_gene`, `gene_disease`,
`peak_to_genes`. There is **no `/results` that aggregates a variant list**.

### Two-stage data flow

The aggregation that `/v1/results` used to do server-side is split into two stages with different
lifetimes. This split is the key design decision:

**Stage 1 — Fetch + normalize (per query, one round-trip-ish).** Combine the granular endpoints
into raw, *unfiltered* normalized records for the input (variant list or gene): credible sets across
all resources + variant annotation + nearest genes + dataset/resource metadata. This lives in a
**thin BFF (backend-for-frontend)** that we own (separate from the general `genetics-results-api`,
which must stay app-agnostic). The MCP server's `analyze_variant_list`
(`../genetics-mcp-server/.../tools/executor.py:1426+`) already does this fan-out in Python and is the
template for the BFF's fetch/normalize logic — **but only its fetch half**; its summarization is baked
in at fetch time and is not reusable for stage 2.

**Stage 2 — Filter → group → summarize (reactive, client-side, no round-trip).** All UI controls
(PIP threshold, `cs_min_r2`, resource/data-type filters, selected phenotype, gnomAD population) must
recompute instantly when changed. This stays in the browser, preserving the design of today's
`src/store/munge.ts` (`filterRows()`, `groupFineMappedTraits()`, `summarizePhenotypes()`,
`summarizeTissues()`). These are pure functions over raw records — the most valuable and testable
part of the current code. **We keep this architecture; we only change what feeds it** (raw
credible-set records instead of `assoc` + `finemapped`).

> Rationale for BFF-for-fetch + client-for-recompute: changing a threshold must not re-hit the API,
> and the general API should not carry app-specific shaping. The BFF gives the table and the chat one
> shared fetch path; the client keeps interactivity cheap.

**BFF host decision (locked).** The BFF is a **standalone Node/TypeScript service** (`./bff`, Express),
mirroring the existing chat backend pattern (`VITE_CHAT_URL`) — its own dev port and reverse-proxy
entry, sharable by the table and the chat. *Not* vite middleware, *not* client-side. It reads the
upstream API base from `GENETICS_API_URL` (default `http://localhost:2000/api`) and its listen port
from `BFF_PORT` (default `5000`; 2000=API, 3000=vite, 4000=chat are already taken in dev). In dev the
browser talks to the BFF via `VITE_API_URL=http://localhost:5000/api` (and the vite `/api` proxy also
targets `:5000`); in prod a reverse proxy routes `/api` → BFF. The scaffold exposes `GET /healthz`
and a generic `/api/*` passthrough to the upstream; the real stage-1 normalize endpoints land in the
follow-up tasks. Run with `npm run bff` / `npm run bff:dev`; tests via `npm run bff:test`.

### Layer-by-layer impact

| Layer | Files | Disposition |
|-------|-------|-------------|
| Fetch/query | `store/serverQuery.ts`, `store/api.ts` | **Rewrite** against BFF + new endpoints |
| Types | `types/types.ts`, `types/types.gene.ts` | **Rewrite** — drop `assoc`/`AssocRecord`, make credible sets primary |
| Reactive munging | `store/munge.ts` | **Adapt** — same functions, fed by CS records; drop p-value path |
| Store | `store/store.ts` | **Adapt** — drop `pThreshold` semantics, add resource filter + caQTL/eQTL toggle |
| Presentation | `features/table/tables/*`, controls, tooltips | **Preserve + adapt** — characterization-test first, then reskin columns |

---

## 2. BACKEND CHANGES NEEDED (targeted additions, justified individually)

Targeted additions to `genetics-results-api` are acceptable where they clearly simplify the frontend;
otherwise solve in the BFF. Detailed specs in **`refactor.backend.md`**. Candidate list:

- **`has_summary_stats` filter on `/search`** *(API change)* — needed by the phenotype-search view so
  we only offer phenotypes that have full sumstats. Today this requires cross-referencing
  `datasets.products.summary_stats`. A direct flag/filter is cleaner than client cross-referencing and
  is genuinely general-purpose. **Justified.**
- **gnomAD allele-frequency endpoint** *(API change, confirmed)* — no gnomAD source exists today
  (`variant_annotation` supports only `finngen`). Add a new endpoint that takes **multiple variants**
  and returns per-population gnomAD AF, e.g. `POST /api/v1/gnomad_annotation { variants: [...] }`.
  Feeds the gnomAD population display (old `GnomadPopChoice`). General-purpose. **Justified.**
- **Aggregation/fetch fan-out** — *not* a core API change. Lives in the BFF. The API stays granular.
- **caQTL in credible sets** — ✅ **confirmed** against live API. `credible_sets_by_variant` returns
  `data_type: "caQTL"` rows directly (resource `finngen`, dataset `FinnGen_ATACseq`), so the eQTL/caQTL
  toggle works at the membership level with no API change. The one nuance: a caQTL `trait` is an **ATAC
  peak id** (`chr19-44906317-44906816`) with `cell_type` like `l1.PBMC` — to show *which gene* a peak
  regulates in the Tissue summary, enrich lazily via `peak_to_genes`. Not a blocker for the toggle.

---

## 3. VIEW TAXONOMY

| View | Route | Type | Notes |
|------|-------|------|-------|
| Variant table | `/annotate` | existing, reworked | tabs below; `/` is the chat landing page |
| → Variant results | tab | adapt | drop "Association results" sub-table |
| → Data type comparison | tab | adapt | drop association counts |
| → Phenotype summary | tab | adapt | counts from CS membership; links to phenotype-search view |
| → Tissue & cell type summary | tab | adapt | decoupled from top options; eQTL/caQTL toggle |
| **Phenotype search** | `/phenotype-search` (new) | **new view** | full sumstats for all input variants × chosen phenotype |
| Gene view | `/gene/:gene` | mostly keep | + new "Gene evidence" tab |
| → Gene evidence | tab (new) | new | burden, expression, gene-disease |
| LD lookup | `/ld` | keep | |
| About / Changelog | `/about`, `/changelog` | keep | update copy for new data |

---

## 4. VARIANT TABLE VIEW

Textbox and examples for inputting variants or a gene, plus options, stay similar.

**Thresholds.** The p-value threshold loses meaning with credible-set-only data — the real filters
are **PIP** and optionally **`cs_min_r2`**. Replace the p-threshold slider accordingly (don't merely
"keep" it). `GlobalThresholds.tsx`.

**Resource filter to main options.** Lift the resource filter out of the variant expanded table into
the main options. Drive the available resources/data-types **dynamically** from `GET /resources` +
`GET /datasets` (`products`, `qtl_types`, `data_type`) rather than the hardcoded toggles in
`GlobalDataTypeSwitches.tsx`. Multiple resources/datasets should be clearly visible.

### Variant results (tab)

Main result table stays similar. In the variant expanded table, **drop "Association results"**
(`VariantAssocTable.tsx` + columns) — we now only have credible sets across all phenotypes. The
fine-mapped sub-table (`VariantFinemappedTable.tsx`) becomes the single per-variant detail table.

**QTL molecular trait display.** For QTL credible sets, show the **collapsed gene symbol** (`trait`,
e.g. `CLASRP`) by default. eQTL Catalogue rows carry a **quantification level** parsed from
`trait_original` (suffix after the last `|`: `ge`, `exon`, `tx`, `txrev`, `leafcutter`). Default to
**gene-level (`ge`) only**; provide an option to also show the other levels, and when shown, display
the level alongside the gene symbol (gene symbol alone is ambiguous across levels). Applies wherever
QTL traits appear (variant results, tissue summary).

**New: colocalization.** Inside the expanded row, per credible set, show "this signal colocalizes
with…". Fetch **lazily per credible set** via `colocalization_by_credible_set_id(resource, trait, csId)`
when a row expands — **not** `colocalization_by_variant`, which returns the whole region's coloc network
(~30k rows for APOE) and is too broad to attach to a row. Users are definitely interested in what a
signal containing their input variant colocalizes with. New section, not a tweak.

### Data type comparison (tab)

Stays similar; remove association results / p-value counts.

### Phenotype summary (tab)

Stays similar, but phenotype counts come from **credible-set membership**, not associations. Provide
a handoff to the phenotype-search view: e.g. if asthma is the top trait, the user clicks through to
see full sumstat results for all their variants for asthma.

### Tissue and cell type summary (tab)

Stays similar, counts from credible-set membership. Two changes:

- **Decouple from top-level options** — current behavior (table empty unless QTLs selected in main
  options) is confusing. The table manages its own data-type selection.
- **eQTL / caQTL toggle.** caQTL has not been in the tool before; now we can include it. Caveat: caQTL
  may be peak-based (`chromatin_peaks`/`peak_to_genes`), not gene-keyed like eQTL — see the spike in §2
  before assuming a symmetric toggle.

---

## 5. PHENOTYPE SEARCH VIEW (new, own route)

User searches for a phenotype, then sees a table of results for **all input variants** (or input
gene's variants) for that phenotype. This shows **full summary stats** (not just credible sets), so
it is its own view with its own table shape.

- Search via `/search` (fuzzy, comma-separated, type=phenotypes), restricted to phenotypes that have
  full sumstats (see `has_summary_stats`, §2). Show resource/dataset clearly — there may be several.
- Per variant: full sumstat row from `summary_stats/{resource}/{data_type}` **plus a CS-membership
  flag** (in a credible set for this phenotype or not) from `credible_sets_by_phenotype` /
  `credible_sets_by_variant`.
- Entry points: direct search box + handoff from the Phenotype Summary tab.

---

## 6. GENE VIEW

Already credible-set-based; keep the CS visualization largely as-is.

- **Simplify** the "Variants in X affect these genes" / "Variants in these genes affect X" lists —
  currently complex (`AffectedGeneList.tsx` / `AffectingGeneList.tsx`). Separate subtask.
- **New "Gene evidence" tab** for the API's gene-level additions, which are relevant but not part of
  the CS visualization:
  - gene burden results — `gene_based/{gene}`
  - expression data — `expression_by_gene/{gene}`
  - Mendelian gene-disease associations — `gene_disease/{gene}`

---

## 7. LD LOOKUP / ABOUT / CHANGELOG

LD lookup stays similar. About/Changelog stay similar but update copy to reflect credible-set-only
data and the new features.

---

## 8. TESTING STRATEGY (no GUI required on the VM)

UI tests have not existed before. We add them. Everything below runs headless on the no-GUI Cloud VM.

- **Vitest + React Testing Library** — unit/component tests. The `munge.ts` pure functions
  (filter/group/summarize) are the prime targets and the safety net for the data-layer rewrite.
- **MSW (Mock Service Worker)** — mock the BFF/API so tests are deterministic and offline.
- **Playwright (headless Chromium)** — end-to-end. Runs without a display; captures
  screenshots/traces, which also lets the agent visually verify behavior during development.
- **Characterization-test discipline** (Working Effectively with Legacy Code): before swapping the
  data layer, write tests that capture the current table components' rendered output, seam at the
  store boundary, then replace the data layer underneath them.

All code linted error-free with best practices.

---

## 9. LLM / CHAT INTEGRATION IDEAS

The annotation tool and the chat can reinforce each other:

- **"Explain this variant / gene"** button that opens chat seeded with the current table context.
- From Phenotype Summary → **"Ask the assistant about <trait> across these variants."**
- **Natural-language → variant-list input** ("variants near APOE associated with lipids") that
  populates the table.
- A **chat tool that drives the table** (sets query/filters) so the assistant can build a view.
- **Shared fetch/normalize logic** between the MCP `analyze_variant_list` and the BFF — one data path
  for both surfaces (reinforces the BFF decision in §1).

---

## 10. PHASED MIGRATION PLAN

Phased, not big-bang — keep the app shippable throughout. View-by-view cutover behind the existing UI.

1. **Foundations.** Stand up test infra (Vitest + RTL + MSW + Playwright). Add characterization tests
   around the current variant table.
2. **BFF + types.** Build the fetch/normalize BFF against the new API; rewrite types to credible-set-
   primary; resolve the caQTL spike and the `/search` `has_summary_stats` addition.
3. **Variant table cutover.** Rewrite the data layer feeding `munge.ts`; adapt Variant Results (drop
   Association results), Data Type Comparison, Phenotype Summary, Tissue summary; lift resource filter
   and replace p-threshold with PIP. Verify against characterization tests.
4. **New capabilities.** Colocalization in expanded rows; phenotype-search view; Gene evidence tab.
5. **Gene view polish.** Simplify affected/affecting gene lists.
6. **LLM integration + copy.** Chat hooks; update About/Changelog.

---

## 11. OPEN ITEMS / DECISIONS LOCKED

- Aggregation: **BFF for fetch/normalize; client-side reactive filter/group/summarize.** ✅
- BFF host: **standalone Node/TypeScript service (`./bff`, Express), default port 5000** — mirrors the
  chat backend (`VITE_CHAT_URL`); not vite middleware, not client-side. ✅
- Phenotype search: **its own view/route.** ✅
- Backend scope: **targeted additions OK** (e.g. `/search` `has_summary_stats`). ✅
- Sequencing: **phased migration.** ✅
- caQTL in credible sets: **confirmed** (§2). ✅
- Normalized record schema: **drafted** in `refactor.schema.draft.ts`, grounded in live API responses.
- gnomAD AF: **new multi-variant endpoint** to be added (§2). ✅
- eQTL Catalogue levels: **collapse to gene symbol; ge-only by default, optional other levels with a
  level badge** — `quantLevel` parsed from `trait_original`. ✅
