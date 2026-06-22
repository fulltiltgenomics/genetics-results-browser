import { useQuery, useQueries, UseQueryResult } from "@tanstack/react-query";
import { Config, Dataset, DataType, Phenotype, TableData } from "../types/types";
import {
  ColocPair,
  CredibleSetDataType,
  DatasetDataType,
  GeneBurdenRow,
  GeneDiseaseRow,
  GeneExpressionRow,
  NormalizedResponse,
  PhenotypeSearchHit,
} from "@/types/types.normalized";
import { parseQuantLevel } from "@/utils/quantLevel";
import { CSDatum, GeneModel } from "@/types/types.gene";
import config from "@/config.json";
import { mungeGeneModelResponse } from "./serverMunge";
import { isCoding, isLoF } from "@/utils/coding";
import {
  GeneCSApiRow,
  GeneInRegionApiRow,
  geneModelsFromRegion,
  groupCredibleSets,
} from "./geneCS";
import api from "./api";

// the gene view's window padding around the gene body (legacy used the same value)
const GENE_VIEW_PADDING = config.gene_view.gene_padding;

/**
 * raw /datasets row from the new genetics-results-api (snake_case). only the fields the About page
 * surfaces are typed here; the live payload also carries author/publication_date/metadata_endpoint
 * etc. which we don't currently render.
 */
export interface DatasetApiRow {
  dataset_id: string;
  resource: string;
  version?: string;
  description?: string;
  trait_type?: string | null;
  data_type: string;
  qtl_types?: string[];
  products: {
    credible_sets?: boolean;
    summary_stats?: boolean;
    colocalization?: { partners: string[] };
    [key: string]: unknown;
  };
  stats?: {
    n_phenotypes?: number;
    n_samples_median?: number;
    n_subdatasets?: number;
    [key: string]: unknown;
  };
  n_samples?: number;
}

// typed projection of a /datasets row used by the About "currently included datasets" table.
export interface DatasetRow {
  datasetId: string;
  resource: string;
  version?: string;
  description?: string;
  dataType: string;
  qtlTypes?: string[];
  hasCredibleSets: boolean;
  hasSummaryStats: boolean;
  hasColocalization: boolean;
  nPhenotypes?: number;
  // single representative sample size: median when a dataset spans many phenotypes, else n_samples
  nSamples?: number;
}

/**
 * GET /v1/datasets -> the resources/datasets currently included, one row per dataset_id. replaces
 * the dead useConfigQuery-based sourcing on the About page (the new API has no /v1/config).
 */
export const useDatasets = (): UseQueryResult<DatasetRow[], Error> => {
  return useQuery<DatasetRow[]>({
    queryKey: ["datasets"],
    queryFn: async (): Promise<DatasetRow[]> => {
      const { data } = await api.get<DatasetApiRow[]>("/v1/datasets", {
        params: { format: "json" },
      });
      return data.map((row) => ({
        datasetId: row.dataset_id,
        resource: row.resource,
        version: row.version,
        description: row.description,
        dataType: row.data_type,
        qtlTypes: row.qtl_types,
        hasCredibleSets: row.products?.credible_sets === true,
        hasSummaryStats: row.products?.summary_stats === true,
        hasColocalization: Array.isArray(row.products?.colocalization?.partners),
        nPhenotypes: row.stats?.n_phenotypes,
        nSamples: row.stats?.n_samples_median ?? row.n_samples,
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
};

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
    // /v1/results is an expensive fan-out (the BFF already retries each upstream chunk internally),
    // so don't let the global 3x query retry multiply the whole heavy call on failure — one retry is
    // enough to ride out a transient blip without hammering the BFF with several full re-runs.
    retry: 1,
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

/**
 * @deprecated hits the dead legacy /v1/gene_model_by_gene (404 on the new API). use
 * useGenesInRegion / useGeneInfo instead. kept only for any non-gene-view caller.
 */
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

/**
 * @deprecated hits the dead legacy /v1/gene_cs (404 on the new API). use useGeneCredibleSets.
 */
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

/**
 * @deprecated hits the dead legacy /v1/gene_cs_trans (404 on the new API). use
 * useGeneTransCredibleSets.
 */
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

/* ────────────────────────────────────────────────────────────────────────────
 * GENE VIEW (refactor.md §6) — migrated from the dead /v1/gene_cs* + /v1/gene_model* endpoints to
 * the new genetics-results-api. cis credible sets come from credible_sets_by_gene, trans (the gene
 * as a QTL molecular trait) from credible_sets_by_qtl_gene, and the gene track from genes_in_region.
 * all three return flat JSON rows that groupCredibleSets / geneModelsFromRegion reshape into the
 * CSDatum[] / GeneModel[] the existing CisView + CSPlot already consume (see store/geneCS.ts).
 * ──────────────────────────────────────────────────────────────────────────── */

// minimal slice of a /search gene hit — used to resolve a gene symbol to its genomic coordinates.
interface GeneSearchHit {
  type: string;
  symbol: string;
  chrom: number;
  gene_start: number;
  gene_end: number;
}

export interface GeneInfo {
  symbol: string;
  chr: string;
  start: number;
  end: number;
}

/**
 * resolve a gene symbol to its coordinates via /search (type=genes). genes_in_region needs an
 * explicit chr/start/end, and the credible-set endpoints don't return the gene body, so this is the
 * one lookup that seeds both the gene track window and the cis/trans plot range.
 */
export const useGeneInfo = (gene: string | undefined): UseQueryResult<GeneInfo | undefined, Error> => {
  return useQuery<GeneInfo | undefined>({
    queryKey: ["gene-info", gene],
    queryFn: async () => {
      const { data } = await api.get<GeneSearchHit[]>("/v1/search", {
        params: { q: gene, types: "genes", format: "json" },
      });
      const hit = data.find(
        (d) => d.type === "gene" && d.symbol.toLowerCase() === gene!.toLowerCase()
      );
      if (!hit) {
        return undefined;
      }
      return {
        symbol: hit.symbol,
        chr: String(hit.chrom),
        start: hit.gene_start,
        end: hit.gene_end,
      };
    },
    enabled: !!gene,
    staleTime: Infinity,
  });
};

/**
 * cis credible sets overlapping the gene region, grouped into CSDatum[] (replaces useCSQuery).
 * window mirrors the legacy padding so the same stretch of the locus is fetched.
 */
export const useGeneCredibleSets = (
  gene: string | undefined
): UseQueryResult<CSDatum[], Error> => {
  return useQuery<CSDatum[]>({
    queryKey: ["gene-credible-sets", gene],
    queryFn: async () => {
      const { data } = await api.get<GeneCSApiRow[]>(
        `/v1/credible_sets_by_gene/${encodeURIComponent(gene!)}`,
        { params: { window: GENE_VIEW_PADDING, format: "json" } }
      );
      return groupCredibleSets(data);
    },
    enabled: !!gene,
    staleTime: Infinity,
  });
};

/**
 * trans credible sets: QTL credible sets where this gene is the molecular trait, anywhere in the
 * genome (replaces useCSTransQuery). grouped the same way; the upstream `trait` is already the gene
 * symbol for QTL rows so the grouping key matches the cis path.
 */
export const useGeneTransCredibleSets = (
  gene: string | undefined
): UseQueryResult<CSDatum[], Error> => {
  return useQuery<CSDatum[]>({
    queryKey: ["gene-trans-credible-sets", gene],
    queryFn: async () => {
      const { data } = await api.get<GeneCSApiRow[]>(
        `/v1/credible_sets_by_qtl_gene/${encodeURIComponent(gene!)}`,
        { params: { format: "json" } }
      );
      return groupCredibleSets(data);
    },
    enabled: !!gene,
    staleTime: Infinity,
  });
};

/**
 * gene track for the plot: gene bodies in the region from genes_in_region, adapted to GeneModel[].
 * the new endpoint exposes only gene boundaries (no exons), so the track loses exon-level detail
 * vs the legacy gene_model TSV — see geneModelsFromRegion.
 */
export const useGenesInRegion = (
  chr: string | undefined,
  start: number | undefined,
  end: number | undefined
): UseQueryResult<GeneModel[], Error> => {
  return useQuery<GeneModel[]>({
    queryKey: ["genes-in-region", chr, start, end],
    queryFn: async () => {
      const { data } = await api.get<GeneInRegionApiRow[]>(
        `/v1/genes_in_region/${chr}/${start}/${end}`,
        { params: { format: "json" } }
      );
      return geneModelsFromRegion(data);
    },
    enabled: !!chr && start !== undefined && end !== undefined,
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
            trait2Original: row.trait_original,
            // reuse the same quant-level parse as the main QTL display; null for pQTL/GWAS/caQTL.
            quantLevel2: parseQuantLevel(row.trait_original),
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

/**
 * What a variant's credible set (in a given resource+phenotype) colocalizes with, via
 * GET /v1/colocalization_by_variant/{variant}/{resource}/{phenotype}. This replaces the
 * colocalization_by_credible_set_id call, which only accepts region-format cs ids
 * (chr{N}:{start}-{end}_{L}) and 422s on the variant-format (FinnGen labs) and molecular-QTL
 * (eQTL Catalogue) cs ids that make up most credible sets — see the coloc router's cs-id parser.
 * Anchoring on the variant the user is viewing works for every cs-id format and is the same
 * "this signal colocalizes with…" question. Same simple-schema rows as before, so the ColocPair
 * mapping is unchanged; filtered to PP.H4 >= threshold and sorted descending.
 */
export const useColocByVariant = (
  variant: string | undefined,
  resource: string | undefined,
  trait: string | undefined,
  enabled: boolean
): UseQueryResult<ColocPair[], Error> => {
  return useQuery<ColocPair[]>({
    queryKey: ["coloc-by-variant", variant, resource, trait],
    queryFn: async (): Promise<ColocPair[]> => {
      const path = `/v1/colocalization_by_variant/${encodeURIComponent(
        toDashVariant(variant!)
      )}/${encodeURIComponent(resource!)}/${encodeURIComponent(trait!)}`;
      const { data } = await api.get<ColocApiRow[]>(`${path}?format=json`);
      // the upstream can return the same partner row more than once (observed for FinnGen GWAS
      // partners); collapse exact duplicates. NO PP.H4 cutoff — show all colocalization data.
      const seen = new Set<string>();
      const pairs: ColocPair[] = [];
      for (const row of data) {
        const pair: ColocPair = {
          resource2: row.resource,
          dataType2: row.data_type as CredibleSetDataType,
          trait2: row.trait,
          trait2Original: row.trait_original,
          quantLevel2: parseQuantLevel(row.trait_original),
          cellType2: row.cell_type,
          ppH4: row["PP.H4.abf"],
          clpp: row.clpp,
          cs2Size: row.cs_size,
          hit2: row.hit,
        };
        const key = `${pair.resource2}|${pair.dataType2}|${pair.trait2}|${pair.cellType2}|${pair.hit2}|${pair.ppH4}|${pair.clpp}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push(pair);
      }
      return pairs.sort((a, b) => b.ppH4 - a.ppH4);
    },
    enabled: enabled && !!variant && !!resource && !!trait,
    staleTime: Infinity,
  });
};

// harmonized per-phenotype metadata (GET /v1/resource_metadata/{resource}). one numeric NA -> null.
export interface PhenotypeMetadata {
  name: string;
  nCases: number | null;
  nControls: number | null;
  nSamples: number | null;
  traitType: string | null;
}

// raw resource_metadata row (snake_case TSV-derived JSON; numeric fields can be the string "NA").
interface ResourceMetadataApiRow {
  phenotype_code: string | number;
  phenotype_string: string;
  n_samples: number | string;
  n_cases: number | string;
  n_controls: number | string;
  trait_type: string;
}

const metaNum = (v: number | string | undefined): number | null => {
  if (v === undefined || v === null || v === "" || v === "NA") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

/**
 * Per-phenotype metadata for one resource (case/sample counts + name), keyed by phenotype_code.
 * Backs the phenotype tooltip's "N cases / N samples". Lazy + cached forever: only the resources the
 * user actually hovers are fetched, and each resource is fetched once (open_targets is ~5 MB / ~8 s,
 * so fetching it eagerly in stage-1 would gate every query — hence this is hover-gated per resource).
 * Resources without harmonized metadata 404; the hook swallows that to an empty map.
 */
export const useResourceMetadata = (
  resource: string | undefined,
  enabled: boolean
): UseQueryResult<Record<string, PhenotypeMetadata>, Error> => {
  return useQuery<Record<string, PhenotypeMetadata>>({
    queryKey: ["resource-metadata", resource],
    queryFn: async (): Promise<Record<string, PhenotypeMetadata>> => {
      try {
        const { data } = await api.get<ResourceMetadataApiRow[]>(
          `/v1/resource_metadata/${encodeURIComponent(resource!)}`,
          { params: { format: "json" } }
        );
        const out: Record<string, PhenotypeMetadata> = {};
        for (const row of data) {
          out[String(row.phenotype_code)] = {
            name: row.phenotype_string ?? "",
            nCases: metaNum(row.n_cases),
            nControls: metaNum(row.n_controls),
            nSamples: metaNum(row.n_samples),
            traitType: row.trait_type ?? null,
          };
        }
        return out;
      } catch {
        // resources without harmonized metadata (e.g. gnomad-only) -> no counts, not an error
        return {};
      }
    },
    enabled: enabled && !!resource,
    staleTime: Infinity,
    gcTime: Infinity,
  });
};

// one peak_to_genes row (snake_case JSON). only the fields we use are typed; the payload also carries
// the hurdle model stats + gene/peak coordinates which we don't surface here.
interface PeakGeneApiRow {
  peak_id: string;
  gene_id: string;
  symbol: string;
  cell_type: string;
}

// genes one ATAC peak regulates (GET /v1/peak_to_genes/{peak_id}). dash-format peak id (chr-start-end),
// which is exactly the caQTL credible-set trait id, so no reformatting is needed.
const fetchPeakGenes = async (peak: string): Promise<string[]> => {
  const { data } = await api.get<PeakGeneApiRow[]>(
    `/v1/peak_to_genes/${encodeURIComponent(peak)}`,
    { params: { format: "json" } }
  );
  // NOTE: each peak_to_genes row carries its own cell_type, but that is the cell type in which the
  // peak->gene LINK was detected — orthogonal to the caQTL discovery cell_type that keys the tissue
  // row. They rarely overlap, so filtering by the row's cell type would wrongly drop most genes. We
  // therefore take the union of symbols across all link cell types.
  return [...new Set(data.map((r) => r.symbol).filter(Boolean))].sort();
};

/**
 * Resolve a set of ATAC peaks to the union of genes they regulate, via peak_to_genes. Used by the
 * caQTL tissue-summary "linked genes" column. Each peak is its own query (keyed by peak id) so peaks
 * shared across rows are fetched once and cached forever; calling this from the row cell means only
 * the ~page-worth of currently rendered rows fetch at a time. Returns the deduped, sorted symbols.
 */
export const usePeakGenes = (
  peaks: string[],
  enabled: boolean
): { genes: string[]; isLoading: boolean; isError: boolean } => {
  const results = useQueries({
    queries: peaks.map((peak) => ({
      queryKey: ["peak-to-genes", peak],
      queryFn: () => fetchPeakGenes(peak),
      enabled: enabled && !!peak,
      staleTime: Infinity,
      gcTime: Infinity,
    })),
  });
  const genes = [...new Set(results.flatMap((r) => r.data ?? []))].sort();
  return {
    genes,
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
  };
};

/**
 * The upstream `{phenocode: phenostring}` map (GET /v1/trait_name_mapping). One call returns the
 * whole dictionary (~28k entries, covering both FinnGen GWAS phenocodes like AD_LO_EXMORE ->
 * "Alzheimer's disease (Late onset)…" and QTL dataset ids), so we fetch it once and cache forever.
 * Used by ColocSection to turn bare GWAS partner phenocodes into human-readable phenostrings.
 */
export const useTraitNameMapping = (enabled: boolean): UseQueryResult<Record<string, string>, Error> => {
  return useQuery<Record<string, string>>({
    queryKey: ["trait-name-mapping"],
    queryFn: async (): Promise<Record<string, string>> => {
      const { data } = await api.get<Record<string, string>>("/v1/trait_name_mapping");
      return data;
    },
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });
};

/* ────────────────────────────────────────────────────────────────────────────
 * PHENOTYPE SEARCH TAB (refactor.md §5) — a tab inside the variant table (TableContainer).
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
  has_credible_sets?: boolean;
  sample_size?: number;
  n_cases?: number | null;
  n_controls?: number | null;
}

interface PhenotypeSearchOptions {
  /** drop phenotypes without full summary stats (phenotype-search tab). */
  requireSummaryStats?: boolean;
  /** drop phenotypes without credible sets (main annotation search). */
  requireCredibleSets?: boolean;
}

/**
 * Fuzzy phenotype autocomplete. Two use cases (refactor.md §5):
 *   - main annotation search ({ requireCredibleSets: true }): annotates a phenotype's credible-set
 *     lead variants, so it must offer every phenotype WITH CREDIBLE SETS — including Open Targets,
 *     which has credible sets but no full summary stats.
 *   - phenotype-search tab ({ requireSummaryStats: true }): looks up per-variant summary stats, so it
 *     restricts to phenotypes that actually have them.
 * Both flags map to the matching /search query params (a phenotype's capability is a per-(resource,
 * data_type) fact the API precomputes). Debouncing is the caller's concern (it owns the input).
 */
export const usePhenotypeSearch = (
  query: string | undefined,
  { requireSummaryStats = false, requireCredibleSets = false }: PhenotypeSearchOptions = {}
): UseQueryResult<PhenotypeSearchHit[], Error> => {
  return useQuery<PhenotypeSearchHit[]>({
    queryKey: ["phenotype-search", query, requireSummaryStats, requireCredibleSets],
    queryFn: async (): Promise<PhenotypeSearchHit[]> => {
      const { data } = await api.get<PhenotypeSearchApiRow[]>("/v1/search", {
        // limit defaults to 10 upstream; a phenotype word (e.g. "asthma") can match dozens of
        // endpoints, so ask for the max (100). NOTE: the capability filters are applied AFTER the
        // index takes its top-`limit`, so a high limit also yields more matching rows.
        params: {
          q: query,
          types: "phenotypes",
          ...(requireSummaryStats ? { has_summary_stats: true } : {}),
          ...(requireCredibleSets ? { has_credible_sets: true } : {}),
          limit: 100,
          format: "json",
        },
      });
      return data.map((row) => ({
        code: row.code,
        name: row.name,
        resource: row.resource,
        dataType: row.data_type as DatasetDataType,
        hasSummaryStats: row.has_summary_stats ?? false,
        hasCredibleSets: row.has_credible_sets ?? false,
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

/* ────────────────────────────────────────────────────────────────────────────
 * GENE EVIDENCE TAB (refactor.md §6) — three independent gene-level reads through the BFF that feed
 * the new "Gene evidence" tab in the gene view (burden, expression, Mendelian gene-disease). These
 * are NOT credible-set data and do not flow through munge; each hook owns its own parse/sort.
 * ──────────────────────────────────────────────────────────────────────────── */

// parse a numeric TSV cell; "NA"/empty -> null (gene_based uses "NA" for missing, e.g. n_controls).
const parseNum = (v: string | undefined): number | null => {
  if (v === undefined || v === "" || v === "NA") {
    return null;
  }
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

/**
 * Parse the gene_based TSV body into typed burden rows, sorted by burden -log10(p) descending.
 * gene_based returns TSV (not JSON), so we split lines/tabs and index by header (mirrors the legacy
 * TSV hooks). Exported for unit testing the parser in isolation.
 */
export const parseGeneBurdenTsv = (tsv: string): GeneBurdenRow[] => {
  const lines = tsv.split("\n");
  if (lines.length === 0 || lines[0].trim() === "") {
    return [];
  }
  const header = lines[0].split("\t");
  const idx = header.reduce((acc, field, i) => {
    acc[field.replace("#", "")] = i;
    return acc;
  }, {} as { [key: string]: number });
  const rows: GeneBurdenRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].length === 0) {
      continue;
    }
    const f = lines[i].split("\t");
    rows.push({
      dataset: f[idx["dataset"]],
      trait: f[idx["trait"]],
      gene: f[idx["gene"]],
      geneId: f[idx["gene_id"]],
      annotation: f[idx["annotation"]],
      mlog10pBurden: parseNum(f[idx["mlog10p_burden"]]),
      beta: parseNum(f[idx["beta"]]),
      se: parseNum(f[idx["se"]]),
      totalVariants: parseNum(f[idx["total_variants"]]),
      totalVariantsPheno: parseNum(f[idx["total_variants_pheno"]]),
      nCases: parseNum(f[idx["n_cases"]]),
      nControls: parseNum(f[idx["n_controls"]]),
      traitOriginal: f[idx["trait_original"]],
      flags: f[idx["flags"]],
    });
  }
  // descending burden significance; nulls sort last
  return rows.sort((a, b) => (b.mlog10pBurden ?? -Infinity) - (a.mlog10pBurden ?? -Infinity));
};

/** Gene burden results for the gene view's Gene evidence tab (gene_based/{gene}, TSV). */
export const useGeneBurden = (gene: string | undefined): UseQueryResult<GeneBurdenRow[], Error> => {
  return useQuery<GeneBurdenRow[]>({
    queryKey: ["gene-burden", gene],
    queryFn: async () => {
      const { data } = await api.get<string>(`/v1/gene_based/${encodeURIComponent(gene!)}`);
      return parseGeneBurdenTsv(data);
    },
    enabled: !!gene,
    staleTime: 5 * 60 * 1000,
  });
};

// raw expression_by_gene JSON row; level is a numeric string the hook parses to a number.
interface GeneExpressionApiRow {
  resource: string;
  version: string;
  dataset: string;
  chrom: number;
  gene_start: number;
  gene_end: number;
  gene_name: string;
  gene_id: string;
  tissue_cell: string;
  level: string | number;
}

/** Gene expression levels per tissue/cell (expression_by_gene/{gene}, JSON), sorted level desc. */
export const useGeneExpression = (
  gene: string | undefined
): UseQueryResult<GeneExpressionRow[], Error> => {
  return useQuery<GeneExpressionRow[]>({
    queryKey: ["gene-expression", gene],
    queryFn: async () => {
      const { data } = await api.get<GeneExpressionApiRow[]>(
        `/v1/expression_by_gene/${encodeURIComponent(gene!)}`,
        { params: { format: "json" } }
      );
      return data
        .map((row): GeneExpressionRow => {
          const level = typeof row.level === "number" ? row.level : Number(row.level);
          return {
            resource: row.resource,
            version: row.version,
            dataset: row.dataset,
            geneName: row.gene_name,
            geneId: row.gene_id,
            tissueCell: row.tissue_cell,
            level: Number.isNaN(level) ? null : level,
          };
        })
        .sort((a, b) => (b.level ?? -Infinity) - (a.level ?? -Infinity));
    },
    enabled: !!gene,
    staleTime: 5 * 60 * 1000,
  });
};

// raw gene_disease JSON row; snake_case mapped to GeneDiseaseRow.
interface GeneDiseaseApiRow {
  resource: string;
  uuid: string;
  gene_symbol: string;
  disease_curie: string;
  disease_title: string;
  classification: string;
  mode_of_inheritance: string;
  submitter: string;
}

/** Mendelian gene-disease associations (gene_disease/{gene}, JSON). */
export const useGeneDisease = (
  gene: string | undefined
): UseQueryResult<GeneDiseaseRow[], Error> => {
  return useQuery<GeneDiseaseRow[]>({
    queryKey: ["gene-disease", gene],
    queryFn: async () => {
      const { data } = await api.get<GeneDiseaseApiRow[]>(
        `/v1/gene_disease/${encodeURIComponent(gene!)}`,
        { params: { format: "json" } }
      );
      return data.map((row) => ({
        resource: row.resource,
        uuid: row.uuid,
        geneSymbol: row.gene_symbol,
        diseaseCurie: row.disease_curie,
        diseaseTitle: row.disease_title,
        classification: row.classification,
        modeOfInheritance: row.mode_of_inheritance,
        submitter: row.submitter,
      }));
    },
    enabled: !!gene,
    staleTime: 5 * 60 * 1000,
  });
};
