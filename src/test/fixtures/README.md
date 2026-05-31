# API fixtures

Real JSON responses captured from the live `genetics-results-api`
(`http://localhost:2000`, base path `/api/v1`) on **2026-05-31**.

These are **trimmed** to a representative handful of records each (not the full
~998-row dumps) so they stay small and readable while covering all data_types and
eQTL Catalogue quant levels (`ge` / `exon` / `txrev` / `tx`). Field names and value
shapes match production 1:1 so MSW mocks reflect real responses.

| Fixture | Source request | Notes |
|---------|----------------|-------|
| `credible_sets_by_variant.json` | `GET /api/v1/credible_sets_by_variant/19-44908684-T-C?format=json` | covers GWAS + eQTL + pQTL + caQTL across finngen / open_targets / ukbb / eqtl_catalogue |
| `credible_sets_by_variant_batch.json` | `POST /api/v1/credible_sets_by_variant?format=json` body `{"variants":"19-44908684-T-C\n..."}` | same record shape as the GET; `variants` is a newline-separated string |
| `credible_sets_by_gene.json` | `GET /api/v1/credible_sets_by_gene/CLASRP?format=json` | covers GWAS + eQTL + pQTL + caQTL + sQTL and quant levels ge/exon/txrev/tx/microarray |
| `variant_annotation_finngen.json` | `GET /api/v1/variant_annotation/finngen?variant=19-44908684-T-C&format=json` | full (already tiny) — rsid, AF, enrichment, most_severe |
| `nearest_genes.json` | `POST /api/v1/nearest_genes?format=json&n=1` body `{"variants":"19-44908684-T-C"}` | `variants` is a single-variant string, NOT an array |
| `datasets.json` | `GET /api/v1/datasets` | one dataset per data_type (gwas/pqtl/eqtl/caqtl/asmqtl/mixed/metaboqtl/exome/gene_based/expression/chromatin_peaks/gene_disease) |
| `resources.json` | `GET /api/v1/resources` | object keyed by product category; each list trimmed to 3 entries |
| `search_phenotypes.json` | `GET /api/v1/search?q=asthma&types=phenotypes` | already carries `data_type` + `has_summary_stats` (backend additions are live) |
| `summary_stats.json` | `GET /api/v1/summary_stats/finngen/gwas?variants=19-44908684-T-C&phenotypes=ASTHMA_OBESITY&format=json` | per-variant per-phenotype sumstat row |
| `colocalization_by_credible_set_id.json` | `GET /api/v1/colocalization_by_credible_set_id/finngen/3000242/chr19%3A43408684-46408684_1?format=json` | cs_id urlencoded; trimmed from 96 rows to 3 |

## Request-shape gotchas discovered during capture

- `credible_sets_by_variant` (POST) and `nearest_genes` (POST) take `{"variants": "<string>"}`
  — a **string**, not an array. Multiple variants are **newline**-separated; comma/space
  separators error (a variant must be `chr-pos-ref-alt`). nearest_genes effectively takes one variant.
- `variant_annotation/{source}` (POST) is the **EXCEPTION**: its body is a JSON **array**
  `{"variants": ["19-44908684-T-C", ...]}` (per refactor.backend.md §1), unlike the
  newline-separated string used by credible_sets_by_variant and nearest_genes.
- `summary_stats` requires both `variants` and `phenotypes` query params (both required).
- `/search` phenotype results already include `data_type` and `has_summary_stats`
  (the two planned backend additions in refactor.backend.md are deployed).
