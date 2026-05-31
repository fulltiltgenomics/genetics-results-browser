import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { Config, Dataset, DataType, Phenotype, TableData } from "../types/types";
import {
  ColocPair,
  CredibleSetDataType,
  DatasetDataType,
  NormalizedResponse,
  PhenotypeSearchHit,
} from "@/types/types.normalized";
import { CSDatum, GeneModel } from "@/types/types.gene";
import config from "@/config.json";
import { mungeGeneModelResponse } from "./serverMunge";
import { isCoding, isLoF } from "@/utils/coding";
import api from "./api";

export const useConfigQuery = (): UseQueryResult<Config, Error> => {
  return useQuery<Config>({
    queryKey: ["config"],
    queryFn: async (): Promise<Config> => {
      const { data } = await api.get<Config>("/v1/config");
      return data;
    },
  });
};

/**
 * stage-1 fetch against the BFF: POST /v1/results { query } -> NormalizedResponse (raw, unfiltered
 * credible sets per variant + annotation + nearest genes + dataset/resource/phenotype metadata).
 * the request body mirrors the legacy useServerQuery contract, so InputForm's query string flows
 * unchanged; only the response type differs (NormalizedResponse vs TableData). see refactor.md §1.
 *
 * additive/non-breaking: this is the replacement for useServerQuery, but the store/munge/components
 * still consume the legacy TableData shape until tasks .13 (munge) and .14 (store) migrate them, so
 * both hooks coexist for now.
 */
export const useNormalizedQuery = (
  variantInput: string | undefined
): UseQueryResult<NormalizedResponse, Error> => {
  return useQuery<NormalizedResponse>({
    queryKey: ["normalized-results", variantInput],
    queryFn: async (): Promise<NormalizedResponse> => {
      const { data } = await api.post<NormalizedResponse>("/v1/results", {
        query: variantInput,
      });
      return data;
    },
    enabled: !!variantInput,
    placeholderData: (prev) => prev,
    staleTime: Infinity,
  });
};

/**
 * @deprecated legacy fat-aggregation fetch returning TableData (assoc + finemapped). superseded by
 * useNormalizedQuery (BFF stage-1, NormalizedResponse) — see refactor.md §1. kept until its consumers
 * (store.ts/munge.ts/components) migrate in tasks .13/.14, then removed with the assoc data path.
 */
export const useServerQuery = (
  variantInput: string | undefined
): UseQueryResult<TableData, Error> => {
  return useQuery<TableData>({
    queryKey: ["table-data", variantInput],
    queryFn: async (): Promise<TableData> => {
      let { data } = await api.post<TableData>(`/v1/results`, {
        query: variantInput,
      });
      if (typeof data !== "object") {
        // JSON parsing failed
        if (typeof data === "string") {
          if (String(data).includes("Infinity")) {
            console.error("Possible Infinity value in data and it's not JSON");
            throw Error("Invalid data received from the server, possible Infinity value in data");
          }
          if (String(data).includes("NaN")) {
            console.error("Possible NaN value in data and it's not JSON");
            throw Error("Invalid data received from the server, possible NaN value in data");
          }
        }
      }
      data.data = data.data.filter((row) => row.assoc.data.length > 0);
      console.info(data);
      return data;
    },
    enabled: !!variantInput,
    placeholderData: (prev) => prev,
    staleTime: Infinity,
  });
};

export const useGeneModelByGeneQuery = (gene: string): UseQueryResult<GeneModel[], Error> => {
  return useQuery<GeneModel[]>({
    queryKey: ["gene-model-by-gene", gene],
    queryFn: async () => {
      const response = await api.get<string>(
        `/v1/gene_model_by_gene/${gene}/${config.gene_view.gene_padding}`
      );
      return mungeGeneModelResponse(response.data);
    },
    enabled: !!gene,
    staleTime: Infinity,
  });
};

export const useGeneModelQuery = (
  chr: string,
  start: number,
  end: number
): UseQueryResult<GeneModel[], Error> => {
  return useQuery<GeneModel[]>({
    queryKey: ["gene-model", chr, start, end],
    queryFn: async () => {
      const response = await api.get<string>(`/v1/gene_model/${chr}/${start}/${end}`);
      return mungeGeneModelResponse(response.data);
    },
    enabled: !!chr && !!start && !!end,
  });
};

class CSQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CSQueryError";
  }
}

export const useCSQuery = (gene: string | undefined): UseQueryResult<CSDatum[], Error> => {
  return useQuery<CSDatum[]>({
    queryKey: ["cs-data", gene],
    queryFn: () =>
      api
        .get<string>(`/v1/gene_cs/${gene}?padding=${config.gene_view.gene_padding}`)
        .then((response) => {
          const rows = response.data.split("\n");
          const header = rows[0].split("\t");
          if (header[0].startsWith("!")) {
            throw new CSQueryError(header[0].slice(1));
          }
          const headerIndex = header.reduce((acc, field) => {
            acc[field.replace("#", "")] = header.indexOf(field);
            return acc;
          }, {} as { [key: string]: number });
          const traitCS2data: { [traitCSId: string]: CSDatum } = {};
          const trait2uniqCS: { [trait: string]: Set<string> } = {};
          const csRegex = /_L?(\d+)$/;
          const seenVariantCSIds = new Set<string>();
          for (let i = 1; i < rows.length; i++) {
            if (rows[i].length === 0) {
              continue;
            }
            if (rows[i].startsWith("!")) {
              throw new CSQueryError(rows[i].slice(1));
            }
            const fields = rows[i].split("\t");
            const resource = fields[headerIndex["resource"]];
            const dataset = fields[headerIndex["dataset"]];
            const dataType = fields[headerIndex["data_type"]];
            const trait = fields[headerIndex["trait"]];
            const variant = `${fields[headerIndex["chr"]]}:${fields[headerIndex["pos"]]}:${
              fields[headerIndex["ref"]]
            }:${fields[headerIndex["alt"]]}`;
            const pos = fields[headerIndex["pos"]];
            const pip = fields[headerIndex["pip"]];
            const mlog10p = fields[headerIndex["mlog10p"]];
            const csId = fields[headerIndex["cs_id"]];
            const traitId = `${resource}|${dataset}|${trait}`;
            const traitCSId = `${traitId}=${csId}`;
            const chr = fields[headerIndex["chr"]];
            const rsid = fields[headerIndex["rsids"]];
            const consequence = fields[headerIndex["most_severe"]];
            const af = fields[headerIndex["AF"]];
            const gene = fields[headerIndex["gene_most_severe"]];
            // TODO server shouldn't send data like this
            if (seenVariantCSIds.has(variant + traitCSId)) {
              continue;
            }
            seenVariantCSIds.add(variant + traitCSId);
            if (!traitCS2data[traitCSId]) {
              traitCS2data[traitCSId] = {
                resource: resource,
                dataset: dataset,
                dataType: dataType,
                trait: trait,
                traitId: traitId,
                traitCSId: traitCSId,
                csId: csId,
                csNumber: parseInt(csId.match(csRegex)![1]),
                csSize: parseFloat(fields[headerIndex["cs_size"]]),
                csMinR2: parseFloat(fields[headerIndex["cs_min_r2"]]),
                chr: chr,
                variant: [],
                pos: [],
                pip: [],
                mlog10p: [],
                beta: [],
                se: [],
                numberOfCSs: 0,
                consequence: [],
                isCoding: [],
                isLoF: [],
                af: [],
                gene: [],
                rsid: [],
              };
            }
            traitCS2data[traitCSId].variant.push(variant);
            traitCS2data[traitCSId].pos.push(parseInt(pos));
            traitCS2data[traitCSId].pip.push(parseFloat(pip));
            traitCS2data[traitCSId].mlog10p.push(parseFloat(mlog10p));
            traitCS2data[traitCSId].beta.push(parseFloat(fields[headerIndex["beta"]]));
            traitCS2data[traitCSId].se.push(parseFloat(fields[headerIndex["se"]]));
            traitCS2data[traitCSId].consequence.push(consequence);
            traitCS2data[traitCSId].isCoding.push(isCoding(consequence.replace("_variant", "")));
            traitCS2data[traitCSId].isLoF.push(isLoF(consequence.replace("_variant", "")));
            traitCS2data[traitCSId].af.push(af);
            traitCS2data[traitCSId].gene.push(gene);
            traitCS2data[traitCSId].rsid.push(rsid);
            if (!trait2uniqCS[traitId]) {
              trait2uniqCS[traitId] = new Set<string>();
            }
            trait2uniqCS[traitId].add(csId);
          }
          const data = Object.keys(traitCS2data).map((traitCSId) => ({
            resource: traitCS2data[traitCSId].resource,
            dataset: traitCS2data[traitCSId].dataset,
            dataType: traitCS2data[traitCSId].dataType,
            trait: traitCS2data[traitCSId].trait,
            traitId: traitCS2data[traitCSId].traitId,
            chr: traitCS2data[traitCSId].chr,
            variant: traitCS2data[traitCSId].variant,
            pos: traitCS2data[traitCSId].pos,
            pip: traitCS2data[traitCSId].pip,
            mlog10p: traitCS2data[traitCSId].mlog10p,
            beta: traitCS2data[traitCSId].beta,
            se: traitCS2data[traitCSId].se,
            csId: traitCS2data[traitCSId].csId,
            traitCSId: traitCS2data[traitCSId].traitCSId,
            csNumber: traitCS2data[traitCSId].csNumber,
            csSize: traitCS2data[traitCSId].csSize,
            csMinR2: traitCS2data[traitCSId].csMinR2,
            numberOfCSs: trait2uniqCS[traitCS2data[traitCSId].traitId].size,
            consequence: traitCS2data[traitCSId].consequence,
            isCoding: traitCS2data[traitCSId].isCoding,
            isLoF: traitCS2data[traitCSId].isLoF,
            af: traitCS2data[traitCSId].af,
            gene: traitCS2data[traitCSId].gene,
            rsid: traitCS2data[traitCSId].rsid,
          }));
          console.log(data.filter((d) => d.dataType === "pQTL"));
          return data;
        }),
    enabled: !!gene,
    staleTime: Infinity,
  });
};

export const useCSTransQuery = (
  gene: string | undefined,
  range: number[] | undefined,
  filterTraits?: { [key: string]: string[] } | undefined
): UseQueryResult<CSDatum[], Error> => {
  return useQuery<CSDatum[]>({
    queryKey: ["cs-trans-data", gene, range, filterTraits],
    queryFn: () =>
      api.get<string>(`/v1/gene_cs_trans/${gene}`).then((response) => {
        const rows = response.data.split("\n");
        const header = rows[0].split("\t");
        if (header[0].startsWith("!")) {
          throw new CSQueryError(header[0].slice(1));
        }
        const headerIndex = header.reduce((acc, field) => {
          acc[field.replace("#", "")] = header.indexOf(field);
          return acc;
        }, {} as { [key: string]: number });
        const traitCS2data: { [traitCSId: string]: CSDatum } = {};
        const trait2uniqCS: { [trait: string]: Set<string> } = {};
        const csRegex = /_L?(\d+)$/;
        const seenVariantCSIds = new Set<string>();
        for (let i = 1; i < rows.length; i++) {
          if (rows[i].length === 0) {
            continue;
          }
          if (rows[i].startsWith("!")) {
            throw new CSQueryError(rows[i].slice(1));
          }
          const fields = rows[i].split("\t");
          const resource = fields[headerIndex["resource"]];
          const dataset = fields[headerIndex["dataset"]];
          const dataType = fields[headerIndex["data_type"]];
          const trait = fields[headerIndex["gene"]];
          if (
            filterTraits !== undefined &&
            filterTraits[dataType] !== undefined &&
            !filterTraits[dataType].includes(trait)
          ) {
            continue;
          }
          const variant = `${fields[headerIndex["chr"]]}:${fields[headerIndex["pos"]]}:${
            fields[headerIndex["ref"]]
          }:${fields[headerIndex["alt"]]}`;
          const chr = fields[headerIndex["chr"]];
          const chrNum = Number(chr.replace("X", "23").replace("Y", "24"));
          const pos = parseInt(fields[headerIndex["pos"]]);
          // filter out cis, TODO should this be on a CS level not variant level?
          // if (range !== undefined && chrNum === range[0] && pos >= range[1] && pos <= range[2]) {
          //   continue;
          // }
          const pip = fields[headerIndex["pip"]];
          const mlog10p = fields[headerIndex["mlog10p"]];
          const csId = fields[headerIndex["cs_id"]];
          const traitId = `${resource}|${dataset}|${trait}`;
          const traitCSId = `${traitId}=${csId}`;
          const consequence = fields[headerIndex["most_severe"]];
          const af = fields[headerIndex["AF"]];
          const gene = fields[headerIndex["gene_most_severe"]];
          const rsid = fields[headerIndex["rsids"]];
          // TODO server shouldn't send data like this
          if (seenVariantCSIds.has(variant + traitCSId)) {
            continue;
          }
          seenVariantCSIds.add(variant + traitCSId);
          if (!traitCS2data[traitCSId]) {
            traitCS2data[traitCSId] = {
              resource: resource,
              dataset: dataset,
              dataType: dataType,
              trait: trait,
              traitId: traitId,
              traitCSId: traitCSId,
              csId: csId,
              csNumber: parseInt(csId.match(csRegex)![1]),
              csSize: parseFloat(fields[headerIndex["cs_size"]]),
              csMinR2: parseFloat(fields[headerIndex["cs_min_r2"]]),
              chr: chr,
              variant: [],
              pos: [],
              pip: [],
              mlog10p: [],
              beta: [],
              se: [],
              numberOfCSs: 0,
              consequence: [],
              isCoding: [],
              isLoF: [],
              af: [],
              gene: [],
              rsid: [],
            };
          }
          traitCS2data[traitCSId].variant.push(variant);
          traitCS2data[traitCSId].pos.push(pos);
          traitCS2data[traitCSId].pip.push(parseFloat(pip));
          traitCS2data[traitCSId].mlog10p.push(parseFloat(mlog10p));
          traitCS2data[traitCSId].beta.push(parseFloat(fields[headerIndex["beta"]]));
          traitCS2data[traitCSId].se.push(parseFloat(fields[headerIndex["se"]]));
          traitCS2data[traitCSId].consequence.push(consequence);
          traitCS2data[traitCSId].isCoding.push(isCoding(consequence));
          traitCS2data[traitCSId].isLoF.push(isLoF(consequence));
          traitCS2data[traitCSId].af.push(af);
          traitCS2data[traitCSId].gene.push(gene);
          traitCS2data[traitCSId].rsid.push(rsid);
          if (!trait2uniqCS[traitId]) {
            trait2uniqCS[traitId] = new Set<string>();
          }
          trait2uniqCS[traitId].add(csId);
        }
        const data = Object.keys(traitCS2data).map((traitCSId) => ({
          resource: traitCS2data[traitCSId].resource,
          dataset: traitCS2data[traitCSId].dataset,
          dataType: traitCS2data[traitCSId].dataType,
          trait: traitCS2data[traitCSId].trait,
          traitId: traitCS2data[traitCSId].traitId,
          chr: traitCS2data[traitCSId].chr,
          variant: traitCS2data[traitCSId].variant,
          pos: traitCS2data[traitCSId].pos,
          pip: traitCS2data[traitCSId].pip,
          mlog10p: traitCS2data[traitCSId].mlog10p,
          beta: traitCS2data[traitCSId].beta,
          se: traitCS2data[traitCSId].se,
          csId: traitCS2data[traitCSId].csId,
          traitCSId: traitCS2data[traitCSId].traitCSId,
          csNumber: traitCS2data[traitCSId].csNumber,
          csSize: traitCS2data[traitCSId].csSize,
          csMinR2: traitCS2data[traitCSId].csMinR2,
          numberOfCSs: trait2uniqCS[traitCS2data[traitCSId].traitId].size,
          consequence: traitCS2data[traitCSId].consequence,
          isCoding: traitCS2data[traitCSId].isCoding,
          isLoF: traitCS2data[traitCSId].isLoF,
          af: traitCS2data[traitCSId].af,
          gene: traitCS2data[traitCSId].gene,
          rsid: traitCS2data[traitCSId].rsid,
        }));
        return data;
      }),
    enabled: !!gene && !!range,
    staleTime: Infinity,
  });
};

export const useDatasetMetadataQuery = (
  datasets: string[] | undefined
): UseQueryResult<{ [key: string]: Dataset }, Error> => {
  return useQuery<{ [key: string]: Dataset }>({
    queryKey: ["dataset-metadata", datasets],
    queryFn: () => {
      const response = api.post<string>(`/v1/dataset_metadata`, datasets).then((response) => {
        const rows = response.data.split("\n");
        const header = rows[0].split("\t");
        const headerIndex = header.reduce((acc, field) => {
          acc[field.replace("#", "")] = header.indexOf(field);
          return acc;
        }, {} as { [key: string]: number });
        const datasetId2metadata = {} as { [key: string]: Dataset };
        for (let i = 1; i < rows.length; i++) {
          if (rows[i].length === 0) {
            continue;
          }
          const fields = rows[i].split("\t");
          datasetId2metadata[fields[headerIndex["dataset_id"]]] = {
            resource: fields[headerIndex["resource"]],
            data_type: fields[headerIndex["data_type"]] as DataType,
            dataset_id: fields[headerIndex["dataset_id"]],
            study_id: fields[headerIndex["study_id"]],
            study_label: fields[headerIndex["study_label"]],
            sample_group: fields[headerIndex["sample_group"]],
            tissue_id: fields[headerIndex["tissue_id"]],
            tissue_label: fields[headerIndex["tissue_label"]],
            condition_label: fields[headerIndex["condition_label"]],
            sample_size: parseInt(fields[headerIndex["sample_size"]]),
            quant_method: fields[headerIndex["quant_method"]],
          };
        }
        return datasetId2metadata;
      });
      return response;
    },
    enabled: !!datasets && datasets.length > 0,
    staleTime: Infinity,
  });
};

export const useTraitMetadataQuery = (
  traits: { resource: string; phenocode: string }[] | undefined
): UseQueryResult<{ [key: string]: Phenotype }, Error> => {
  return useQuery<{ [key: string]: Phenotype }>({
    queryKey: ["trait-metadata", traits],
    queryFn: () => {
      const response = api.post<string>(`/v1/trait_metadata`, traits).then((response) => {
        const rows = response.data.split("\n");
        const header = rows[0].split("\t");
        const headerIndex = header.reduce((acc, field) => {
          acc[field.replace("#", "")] = header.indexOf(field);
          return acc;
        }, {} as { [key: string]: number });
        const traitId2phenos = {} as { [key: string]: Phenotype };
        for (let i = 1; i < rows.length; i++) {
          if (rows[i].length === 0) {
            continue;
          }
          const fields = rows[i].split("\t");
          const resource = fields[headerIndex["resource"]];
          const phenocode = fields[headerIndex["phenocode"]];
          const traitId = `${resource}|${phenocode}`;
          traitId2phenos[traitId] = {
            resource: resource,
            data_type: fields[headerIndex["data_type"]] as DataType,
            phenocode: fields[headerIndex["phenocode"]],
            phenostring: fields[headerIndex["phenostring"]],
            chromosome: fields[headerIndex["chromosome"]],
            gene_start: parseInt(fields[headerIndex["gene_start"]]),
            gene_end: parseInt(fields[headerIndex["gene_end"]]),
            strand: parseInt(fields[headerIndex["strand"]]),
            num_cases: parseInt(fields[headerIndex["num_cases"]]),
            num_samples: parseInt(fields[headerIndex["num_samples"]]),
            trait_type: fields[headerIndex["trait_type"]],
            pub_author: fields[headerIndex["pub_author"]],
            pub_date: fields[headerIndex["pub_date"]],
          };
        }
        return traitId2phenos;
      });
      return response;
    },
    enabled: !!traits && traits.length > 0,
    staleTime: Infinity,
  });
};

export const useVariantAnnotationQuery = (
  variants: string[] | undefined,
  withRange: boolean
): UseQueryResult<{ [key: string]: { [key: string]: string | boolean | undefined } }, Error> => {
  if (!variants || variants.length === 0) {
    return useQuery<{ [key: string]: { [key: string]: string | boolean | undefined } }>({
      queryKey: ["variant-annotation", "none"],
      queryFn: () => Promise.resolve({}),
      enabled: false,
    });
  }
  return useQuery<{ [key: string]: { [key: string]: string | boolean | undefined } }>({
    queryKey: ["variant-annotation", variants, withRange],
    queryFn: () => {
      console.time("variant annotation");
      const sortedVariants = variants.slice().sort((a, b) => {
        const aPos = parseInt(a.split(":")[1]);
        const bPos = parseInt(b.split(":")[1]);
        return aPos - bPos;
      });
      const chr = sortedVariants[0].split(":")[0];
      const start = parseInt(sortedVariants[0].split(":")[1]);
      const end = parseInt(sortedVariants[sortedVariants.length - 1].split(":")[1]);
      const response = api
        .post<string>(
          `/v1/variant_annotation${withRange ? `_range/${chr}/${start}/${end}` : ""}`,
          variants
        )
        .then((response) => {
          // console.time("variant annotation parsing");
          const rows = response.data.split("\n");
          const header = rows[0].split("\t");
          const headerIndex = header.reduce((acc, field) => {
            acc[field.replace("#", "")] = header.indexOf(field);
            return acc;
          }, {} as { [key: string]: number });
          // TODO typing
          const var2anno = {} as { [key: string]: { [key: string]: string | boolean | undefined } };
          for (let i = 1; i < rows.length; i++) {
            if (rows[i].length === 0) {
              continue;
            }
            const fields = rows[i].split("\t");
            const variant = `${fields[headerIndex["chr"]]}:${fields[headerIndex["pos"]]}:${
              fields[headerIndex["ref"]]
            }:${fields[headerIndex["alt"]]}`;
            const consequence = fields[headerIndex["most_severe"]]
              .toLowerCase()
              .replace("_variant", "")
              .replace(/_/g, " ");
            let gene: string | undefined = fields[headerIndex["gene_most_severe"]];
            if (gene === "NA") {
              gene = undefined;
            }
            var2anno[variant] = {
              rsid: fields[headerIndex["rsids"]],
              consequence: consequence,
              isCoding: isCoding(consequence.replace("_variant", "")),
              isLoF: isLoF(consequence.replace("_variant", "")),
              af: fields[headerIndex["AF"]],
              gene: gene,
            };
          }
          // console.timeEnd("variant annotation parsing");
          return var2anno;
        });
      console.timeEnd("variant annotation");
      return response;
    },
    enabled: !!variants && variants.length > 0,
    staleTime: Infinity,
  });
};

// raw row shape from colocalization_by_credible_set_id — only the fields we map to ColocPair.
interface ColocApiRow {
  resource: string;
  data_type: string;
  trait: string;
  trait_original?: string;
  cell_type: string | null;
  "PP.H4.abf": number;
  clpp: number | null;
  cs_size: number;
  hit: string;
}

// only surface meaningful colocalizations — H4 below this is effectively "no shared signal".
export const COLOC_PP_H4_THRESHOLD = 0.5;

/**
 * Lazily fetch what a single credible set colocalizes with (refactor.md §4): each partner row is a
 * trait whose fine-mapped signal colocalizes with the queried CS. Keyed on the CS's own (resource,
 * trait/phenocode, csId) — NOT colocalization_by_variant, which returns the whole region network.
 *
 * `enabled` is gated so the request only fires when the user opens the coloc affordance for a row.
 * Rows are filtered to PP.H4 >= COLOC_PP_H4_THRESHOLD and sorted by PP.H4 descending.
 */
export const useColocByCredibleSet = (
  resource: string | undefined,
  trait: string | undefined,
  csId: string | undefined,
  enabled: boolean
): UseQueryResult<ColocPair[], Error> => {
  return useQuery<ColocPair[]>({
    queryKey: ["coloc-by-cs", resource, trait, csId],
    queryFn: async (): Promise<ColocPair[]> => {
      const path = `/v1/colocalization_by_credible_set_id/${encodeURIComponent(
        resource!
      )}/${encodeURIComponent(trait!)}/${encodeURIComponent(csId!)}`;
      const { data } = await api.get<ColocApiRow[]>(`${path}?format=json`);
      return data
        .filter((row) => row["PP.H4.abf"] >= COLOC_PP_H4_THRESHOLD)
        .map(
          (row): ColocPair => ({
            resource2: row.resource,
            dataType2: row.data_type as CredibleSetDataType,
            trait2: row.trait,
            cellType2: row.cell_type,
            ppH4: row["PP.H4.abf"],
            clpp: row.clpp,
            cs2Size: row.cs_size,
            hit2: row.hit,
          })
        )
        .sort((a, b) => b.ppH4 - a.ppH4);
    },
    enabled: enabled && !!resource && !!trait && !!csId,
    staleTime: Infinity,
  });
};

/* ────────────────────────────────────────────────────────────────────────────
 * PHENOTYPE SEARCH VIEW (refactor.md §5) — own route /annotate/phenotype-search.
 * Two granular reads via the BFF passthrough:
 *   - GET /search?types=phenotypes&has_summary_stats=true  -> autocomplete hits with full sumstats
 *   - GET /summary_stats/{resource}/{data_type}?variants=&phenotypes=  -> per-variant sumstat rows
 * The credible-set MEMBERSHIP flag is NOT fetched here: it is derived client-side from the per-variant
 * credibleSets already in store.normalizedData (cheaper than credible_sets_by_phenotype, which returns
 * every CS member of the trait). See PhenotypeSearchContainer.
 * ──────────────────────────────────────────────────────────────────────────── */

// raw /search row (types=phenotypes). snake_case from the API; mapped to PhenotypeSearchHit below.
interface PhenotypeSearchApiRow {
  type: string;
  code: string;
  name: string;
  resource: string;
  data_type: string;
  has_summary_stats?: boolean;
  sample_size?: number;
  n_cases?: number | null;
  n_controls?: number | null;
}

/**
 * Fuzzy phenotype autocomplete restricted to phenotypes that have full summary stats (refactor.md §5).
 * Debouncing is the caller's concern (it owns the input); this hook only gates on a usable query.
 */
export const usePhenotypeSearch = (
  query: string | undefined
): UseQueryResult<PhenotypeSearchHit[], Error> => {
  return useQuery<PhenotypeSearchHit[]>({
    queryKey: ["phenotype-search", query],
    queryFn: async (): Promise<PhenotypeSearchHit[]> => {
      const { data } = await api.get<PhenotypeSearchApiRow[]>("/v1/search", {
        params: { q: query, types: "phenotypes", has_summary_stats: true, format: "json" },
      });
      return data.map((row) => ({
        code: row.code,
        name: row.name,
        resource: row.resource,
        dataType: row.data_type as DatasetDataType,
        hasSummaryStats: row.has_summary_stats ?? false,
        sampleSize: row.sample_size,
        nCases: row.n_cases,
        nControls: row.n_controls,
      }));
    },
    // require at least 2 chars so we don't spam /search on the first keystroke
    enabled: !!query && query.trim().length >= 2,
    staleTime: 5 * 60 * 1000,
  });
};

// raw /summary_stats row. snake_case; the variant locus is split across chr/pos/ref/alt.
export interface SummaryStatApiRow {
  resource: string;
  version: string;
  phenotype: string;
  chr: number;
  pos: number;
  ref: string;
  alt: string;
  rsids: string | null;
  nearest_genes: string | null;
  pval: number;
  mlog10p: number;
  beta: number;
  se: number;
  af: number | null;
  af_cases?: number | null;
  af_controls?: number | null;
}

/** "19:44908684:T:C" (internal) -> "19-44908684-T-C" (the API's variants= query format). */
const toDashVariant = (v: string): string => v.replace(/:/g, "-");

/**
 * Full summary stats for the input variants × one chosen phenotype (refactor.md §5).
 * variants are the user's internal "chr:pos:ref:alt" ids; converted to the API's dash format here.
 * Keyed on the sorted variant list + phenotype so re-picking the same phenotype reuses the cache.
 */
export const useSummaryStats = (
  resource: string | undefined,
  dataType: string | undefined,
  variants: string[] | undefined,
  phenotype: string | undefined
): UseQueryResult<SummaryStatApiRow[], Error> => {
  const sorted = (variants ?? []).slice().sort();
  return useQuery<SummaryStatApiRow[]>({
    queryKey: ["summary-stats", resource, dataType, phenotype, sorted],
    queryFn: async (): Promise<SummaryStatApiRow[]> => {
      const { data } = await api.get<SummaryStatApiRow[]>(
        `/v1/summary_stats/${encodeURIComponent(resource!)}/${encodeURIComponent(dataType!)}`,
        {
          params: {
            variants: sorted.map(toDashVariant).join(","),
            phenotypes: phenotype,
            format: "json",
          },
        }
      );
      return data;
    },
    enabled: !!resource && !!dataType && !!phenotype && sorted.length > 0,
    staleTime: Infinity,
  });
};
