import { http, HttpResponse } from "msw";

// fixtures captured from the live genetics-results-api (see fixtures/README.md)
import credibleSetsByVariant from "../fixtures/credible_sets_by_variant.json";
import credibleSetsByVariantBatch from "../fixtures/credible_sets_by_variant_batch.json";
import credibleSetsByGene from "../fixtures/credible_sets_by_gene.json";
import variantAnnotationFinngen from "../fixtures/variant_annotation_finngen.json";
import nearestGenes from "../fixtures/nearest_genes.json";
import datasets from "../fixtures/datasets.json";
import resources from "../fixtures/resources.json";
import searchPhenotypes from "../fixtures/search_phenotypes.json";
import summaryStats from "../fixtures/summary_stats.json";
import colocalizationByCsId from "../fixtures/colocalization_by_credible_set_id.json";

// VITE_API_URL differs per env ("/api", "http://localhost:2000/api", ":4000/api"), so match on
// the path suffix with a leading wildcard — works whatever base the axios client is configured with.
const api = (suffix: string): string => `*/api/v1/${suffix}`;

export const handlers = [
  http.get(api("credible_sets_by_variant/:variant"), () => HttpResponse.json(credibleSetsByVariant)),
  http.post(api("credible_sets_by_variant"), () => HttpResponse.json(credibleSetsByVariantBatch)),

  http.get(api("credible_sets_by_gene/:gene"), () => HttpResponse.json(credibleSetsByGene)),

  http.get(api("variant_annotation/:source"), () => HttpResponse.json(variantAnnotationFinngen)),
  http.post(api("variant_annotation/:source"), () => HttpResponse.json(variantAnnotationFinngen)),

  http.post(api("nearest_genes"), () => HttpResponse.json(nearestGenes)),

  http.get(api("datasets"), () => HttpResponse.json(datasets)),
  http.get(api("resources"), () => HttpResponse.json(resources)),

  http.get(api("search"), () => HttpResponse.json(searchPhenotypes)),

  http.get(api("summary_stats/:resource/:dataType"), () => HttpResponse.json(summaryStats)),

  http.get(api("colocalization_by_credible_set_id/:resource/:phenotype/:csId"), () =>
    HttpResponse.json(colocalizationByCsId)
  ),
];
