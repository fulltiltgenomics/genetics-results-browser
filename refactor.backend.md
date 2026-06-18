# BACKEND ENDPOINT SPECS — `genetics-results-api`

Three targeted additions the annotation-tool refactor needs from `../genetics-results-api`
(see `refactor.md` §2). File references point into that repo.

---

## 1. gnomAD allele-frequency annotation (multi-variant)

### Finding: reuse the existing variant-annotation machinery + a small code change

`POST /api/v1/variant_annotation/{source}` **already** accepts multiple variants, batches them
through tabix, filters to exact variant matches, and streams TSV/JSON
(`app/routers/variant_annotation.py:139-190`). Annotation sources are a simple registry:

```python
# app/config/profiles/finngen/common.py:66
variant_annotation_sources = {
    "finngen": {"file": "gs://finngen-commons/.../R13_annotated_variants_v0.small.gz"},
}
```

So gnomAD reuses the **POST endpoint** as-is (no new route) and is added as a new **source** — but
two things must be handled.

### The existing gnomAD file and its column layout

`gs://finngen-commons/gnomad/gnomad.genomes.exomes.v4.0.sites.v2.tsv.bgz` — header (verified):

```
#chr  pos  ref  alt  rsids  filters  AN  AF  AF_afr  AF_amr  AF_asj  AF_eas  AF_fin  AF_mid
      AF_nfe  AF_remaining  AF_sas  most_severe  gene_most_severe  consequences  genome_or_exome
```

So **cpra is at columns 0,1,2,3** (0-based). But `VariantAnnotationService` hardcodes
`_CHR_COL=1, _POS_COL=2, _REF_COL=3, _ALT_COL=4` (`variant_annotation_service.py:12-15`) — correct for
the `finngen` file (`#variant, chr, pos, ref, alt, …`, cpra at 1–4) but **off by one** for gnomAD.
Dropping gnomAD into the registry unchanged would make the service read `pos` as the chromosome and
match nothing. Two required steps:

1. **Make cpra column indices per-source** *(small code change)*. Move `_CHR_COL.._ALT_COL` off the
   class into the source config and read them in `stream_by_variants` / `_filter_by_variants`:
   ```python
   variant_annotation_sources = {
       "finngen": {"file": "...", "cpra_cols": [1, 2, 3, 4]},   # default
       "gnomad":  {"file": "gs://finngen-commons/gnomad/gnomad.genomes.exomes.v4.0.sites.v2.tsv.bgz",
                   "cpra_cols": [0, 1, 2, 3]},
   }
   ```
   Default to `[1,2,3,4]` when absent so `finngen` is unchanged.
2. **Create the tabix index** *(data step)*. No `.tbi` exists for this file (only the `.tsv.bgz`).
   The file is block-gzipped and coordinate-sorted, so:
   ```bash
   tabix -s 1 -b 2 -e 2 gnomad.genomes.exomes.v4.0.sites.v2.tsv.bgz   # chr=col1, pos=col2 (1-based); '#' header auto-skipped
   ```
   then upload the resulting `.tbi` next to the `.bgz`.

After both, `POST /api/v1/variant_annotation/gnomad {"variants": [...]}` works, multi-variant.

### Why this scales
`stream_by_variants` issues **per-variant tabix ranges** (lists of chr/start/end), not one spanning
range (`variant_annotation_service.py:46-60`), so scattered genome-wide variants are fine.
Respects `config_common.max_query_variants`.

### Populations & response
- AF columns available: `AF` (overall) + `AF_afr, AF_amr, AF_asj, AF_eas, AF_fin, AF_mid, AF_nfe,
  AF_remaining, AF_sas`. These map directly to the old `GnomadPopChoice` populations. **No precomputed
  popmax column** — frontend computes popmax across the `AF_*` columns if needed.
- Also carries `rsids, filters, AN, most_severe, gene_most_severe, consequences, genome_or_exome`.
- **Genome/exome duplicate rows:** the file merges genomes+exomes (`genome_or_exome` = `g`/`e`); a
  variant may return **two rows**. Frontend (or BFF) must pick/merge — e.g. prefer the row with larger
  `AN`, or expose both. Note this in the BFF normalize step.
- `POST /api/v1/variant_annotation/gnomad?format=json` body `{"variants": ["19-44908684-T-C", ...]}`
  → one row per matched (variant, genome_or_exome); columns emitted as strings. Frontend maps into
  `GnomadFreq` (`refactor.schema.draft.ts`): `byPop` keyed by population, optional client-side popmax.
- Variants absent from gnomAD return no row (treated as "no gnomAD data").

### Effort
Code: small — per-source cpra indices in `VariantAnnotationService` + config (~10–15 lines). Data: one
`tabix` index + upload. No new route.

---

## 2. `has_summary_stats` on `/search`

### Goal
The phenotype-search view (`refactor.md` §5) must offer only phenotypes that have **full summary
stats** (so `summary_stats/{resource}/{data_type}` will return data). Today the frontend would have to
cross-reference `/datasets.products.summary_stats`. Add the signal to `/search` directly.

### What "has summary stats" means here
`app/config/summary_stats.py` is the source of truth: `get_available_resources_and_types()` returns the
configured `(resource, data_type)` pairs that have full sumstats. A phenotype result has summary stats
iff its `(resource, data_type)` is in that set (e.g. FinnGen GWAS = yes; eQTL Catalogue = no).

### Prerequisite: expose `data_type` on phenotype search results
Phenotype search results currently expose `resource` but **not** `data_type`
(`app/routers/search.py:200-206`). Add `data_type` to the phenotype **search-index entries** and emit
it in both JSON and TSV output. This is wanted independently (the frontend phenotype-search view needs
`data_type` to call `summary_stats/{resource}/{data_type}`), and it lets `has_summary_stats` match on
the precise `(resource, data_type)` pair rather than resource-only.

### Changes to `app/routers/search.py`
1. Add query param:
   ```python
   has_summary_stats: bool = Query(
       default=False,
       description="If true, return only phenotypes with full summary statistics available",
   )
   ```
2. Build the pair set once (module-level, from summary_stats config):
   ```python
   from app.config.summary_stats import get_available_resources_and_types
   _SUMSTATS_PAIRS = set(get_available_resources_and_types())  # {(resource, data_type), ...}
   ```
3. **Annotate every phenotype result** with the flag (useful for a badge even when not filtering):
   ```python
   for r in results:
       if r["type"] == "phenotype":
           r["has_summary_stats"] = (r.get("resource"), r.get("data_type")) in _SUMSTATS_PAIRS
   ```
4. **Filter when requested** (after collecting results, before formatting):
   ```python
   if has_summary_stats:
       results = [r for r in results if r["type"] != "phenotype" or r.get("has_summary_stats")]
   ```
5. Add both `data_type` and `has_summary_stats` to the **TSV phenotype header/rows** and the OpenAPI
   schema/example.

### Request / response
- `GET /api/v1/search?q=asthma&types=phenotypes&has_summary_stats=true`
- Each phenotype result gains `"data_type"` and `"has_summary_stats": true|false`; with the param true,
  only `true` ones are returned. Genes are unaffected.

### Effort
Small. `search.py` + a module-level set, plus adding `data_type` to the phenotype search-index build.
No data changes.

---

## 3. Named curated variant sets (`/variant_sets`)

### Goal
The annotation tool's example/priority links submit a **named token**, not a variant list:
`FinnGen_enriched_202505` (the Finnish-enriched example) and `COVID19_HGI_severity` (COVID severity
leads). The legacy backend expanded these server-side; the new API must serve the curated lists so the
BFF can turn the token back into a variant list and run the normal stage-1 fan-out.

### Finding: the lists already exist in config, just unserved
`variant_set_files` (`app/config/profiles/finngen/common.py:66`, also `daly`) already maps each name to
a small newline-delimited GCS file of variant ids (`chr1_5045339_C_T`, one per line). `startup_checks.py`
flagged it as *"configured but consumed by no service"* — there was no route. The buckets are
**per-profile** (finngen vs daly), so the BFF can't read them directly; the API must serve them.

### Change to `../genetics-results-api`
- New `VariantSetService` (`app/services/variant_set_service.py`) reads the configured file via the
  existing `app/core/file_utils.read_file` (fsspec) and validates each line through `app/core/variant.py`
  `Variant`, emitting canonical `chr:pos:ref:alt` (skips blank/`#`/malformed lines).
- New router (`app/routers/variant_set.py`), registered in `server.py`, both routes `@is_public`:
  - `GET /api/v1/variant_sets` → `["COVID19_HGI_all", "COVID19_HGI_severity", "FinnGen_enriched_202505"]`
  - `GET /api/v1/variant_sets/{name}` → `{ "name", "variants": ["1:5045339:C:T", ...] }`; unknown name → 404
- Service registered in `service_container.py`; getter `get_variant_set_service` in `dependencies.py`.
- `startup_checks.py` now existence-checks the variant-set files (they are a real dependency).

### BFF side (this repo)
`maybeExpandVariantSet` (`bff/inputParse.ts`) runs first in `normalizeVariantList`: a single bare token
that is **not** a variant id or rsid is looked up via `GET /v1/variant_sets/{name}`; on 200 its variants
replace the query text, on 404 it falls through to the normal parse (token → `unparsed`, as before). A
normal variant/rsid list never triggers the lookup.

### Large-list performance (chunked fan-out)
Each batch endpoint does one upstream `tabix -R` over all requested variants (optimal per call), but for
the ~890-variant FinnGen set that becomes hundreds of sequential random-access GCS range seeks — gnomAD
alone exceeded 290s server-side (`variant_annotation_service.stream_by_variants` →
`gcloud_tabix_base._stream_range`, a single `tabix -R /dev/stdin`). GCS serves **parallel** range reads
well, so the BFF (`bff/batch.ts`) splits each endpoint's variant list into 100-variant chunks issued
concurrently under a shared semaphore (`fetchBatched` + `Semaphore`). Measured: gnomAD 888 variants
~290s→~57s; full FinnGen fan-out (all four endpoints) ~151s and complete vs a hard timeout before.
Because many concurrent chunks raise the odds of a transient upstream tabix/GCS hiccup (a sporadic
`Invalid BGZF header` mid-stream read was observed) and `Promise.all` would fail the whole request on
one, each chunk is wrapped in `withRetry` (retry 5xx/connection, not 4xx). Small inputs are a single
chunk and behave exactly as before (single variant ~3s).

### Effort
Small. New service + router + 3 wiring lines on the API; one helper + a timeout bump on the BFF.

---

## Summary

| Endpoint | Change | Code surface | Data work |
|----------|--------|--------------|-----------|
| gnomAD AF | new **source** on existing `variant_annotation` (multi-variant already supported) | per-source cpra indices in `VariantAnnotationService` + config (~10–15 lines) | `tabix` index the existing `.tsv.bgz` + upload `.tbi` |
| `/search has_summary_stats` | new query param + `has_summary_stats` flag + expose `data_type`, matched on `(resource, data_type)` from `summary_stats` config | `search.py` + phenotype search-index build | none |
| `/variant_sets` | new router serving the already-configured `variant_set_files` (list + by-name); BFF expands the named example tokens through it | `VariantSetService` + router + container/deps wiring; BFF `maybeExpandVariantSet` | none (files already in GCS) |
