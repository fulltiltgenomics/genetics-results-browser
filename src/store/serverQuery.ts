import { useQuery, UseQueryResult } from "@tanstack/react-query";
import axios from "axios";
import { Config, DataType, Phenotype, TableData } from "../types/types";
import { CSDatum, GeneModel } from "@/types/types.gene";
import config from "@/config.json";
import { mungeGeneModelResponse } from "./serverMunge";

export const useConfigQuery = (): UseQueryResult<Config, Error> => {
  return useQuery<Config>({
    queryKey: ["config"],
    queryFn: async (): Promise<Config> => {
      const { data } = await axios.get<Config>("/api/v1/config");
      return data;
    },
  });
};

export const useServerQuery = (
  variantInput: string | undefined
): UseQueryResult<TableData, Error> => {
  return useQuery<TableData>({
    queryKey: ["table-data", variantInput],
    queryFn: async (): Promise<TableData> => {
      let { data } = await axios.post<TableData>("${config.api_url}/results", {
        variants: variantInput,
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
      const response = await axios.get<string>(
        `${config.api_url}/gene_model_by_gene/${gene}/${config.gene_view.gene_padding}`
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
      const response = await axios.get<string>(
        `${config.api_url}/gene_model/${chr}/${start}/${end}`
      );
      return mungeGeneModelResponse(response.data);
    },
    enabled: !!chr && !!start && !!end,
  });
};

// export const _useCSQuery = (gene: string | undefined): UseQueryResult<CSDatum[], Error> => {
//   return useQuery<CSDatum[]>({
//     queryKey: ["_cs-data", gene],
//     queryFn: () =>
//       axios.get<string>(`${config.api_url}/gene_cs/${gene}?padding=500000`).then((response) => {
//         const rows = response.data.split("\n");
//         const header = rows[0].split("\t");
//         const headerIndex = header.reduce((acc, field) => {
//           acc[field.replace("#", "")] = header.indexOf(field);
//           return acc;
//         }, {} as { [key: string]: number });
//         const trait2data: { [trait: string]: CSDatum } = {};
//         const trait2uniqCS: { [trait: string]: Set<string> } = {};
//         const csRegex = /_L?(\d+)$/;
//         for (let i = 1; i < rows.length; i++) {
//           if (rows[i].length === 0) {
//             continue;
//           }
//           if (rows[i].startsWith("!")) {
//             throw Error(rows[i].slice(1));
//           }
//           const fields = rows[i].split("\t");
//           const resource = fields[headerIndex["resource"]];
//           if (resource === "eQTL_Catalogue_R7") {
//             //TODO remove this
//             continue;
//           }
//           const dataset = fields[headerIndex["dataset"]];
//           const trait = fields[headerIndex["trait"]];
//           const variant = `${fields[headerIndex["chr"]]}:${fields[headerIndex["pos"]]}:${
//             fields[headerIndex["ref"]]
//           }:${fields[headerIndex["alt"]]}`;
//           const pos = fields[headerIndex["pos"]];
//           const pip = fields[headerIndex["pip"]];
//           const mlog10p = fields[headerIndex["mlog10p"]];
//           const csId = fields[headerIndex["cs_id"]];
//           const traitId = `${resource}|${dataset}|${trait}`;
//           const traitCSId = `${traitId}=${csId}`;
//           const chr = fields[headerIndex["chr"]];
//           if (!trait2data[traitId]) {
//             trait2data[traitId] = {
//               resource: resource,
//               dataset: dataset,
//               trait: trait,
//               traitId: traitId,
//               chr: chr,
//               variant: [],
//               pos: [],
//               pip: [],
//               mlog10p: [],
//               beta: [],
//               se: [],
//               csId: [],
//               traitCSId: [],
//               csNumber: [],
//               numberOfCSs: 0,
//               csSize: [],
//               csMinR2: [],
//             };
//           }
//           trait2data[traitId].variant.push(variant);
//           trait2data[traitId].pos.push(parseInt(pos));
//           trait2data[traitId].pip.push(parseFloat(pip));
//           trait2data[traitId].mlog10p.push(parseFloat(mlog10p));
//           trait2data[traitId].beta.push(parseFloat(fields[headerIndex["beta"]]));
//           trait2data[traitId].se.push(parseFloat(fields[headerIndex["se"]]));
//           trait2data[traitId].traitCSId.push(traitCSId);
//           trait2data[traitId].csId.push(csId);
//           trait2data[traitId].csNumber.push(parseInt(csId.match(csRegex)![1]));
//           trait2data[traitId].csSize.push(parseFloat(fields[headerIndex["cs_size"]]));
//           trait2data[traitId].csMinR2.push(parseFloat(fields[headerIndex["cs_min_r2"]]));
//           if (!trait2uniqCS[traitId]) {
//             trait2uniqCS[traitId] = new Set<string>();
//           }
//           trait2uniqCS[traitId].add(csId);
//         }
//         const data = Object.keys(trait2data).map((traitId) => ({
//           resource: trait2data[traitId].resource,
//           dataset: trait2data[traitId].dataset,
//           trait: trait2data[traitId].trait,
//           traitId: traitId,
//           chr: trait2data[traitId].chr,
//           variant: trait2data[traitId].variant,
//           pos: trait2data[traitId].pos,
//           pip: trait2data[traitId].pip,
//           mlog10p: trait2data[traitId].mlog10p,
//           beta: trait2data[traitId].beta,
//           se: trait2data[traitId].se,
//           csId: trait2data[traitId].csId,
//           traitCSId: trait2data[traitId].traitCSId,
//           csNumber: trait2data[traitId].csNumber,
//           csSize: trait2data[traitId].csSize,
//           csMinR2: trait2data[traitId].csMinR2,
//           numberOfCSs: trait2uniqCS[traitId].size,
//         }));
//         return data;
//       }),
//     enabled: !!gene,
//     staleTime: Infinity,
//   });
// };

export const useCSQuery = (gene: string | undefined): UseQueryResult<CSDatum[], Error> => {
  return useQuery<CSDatum[]>({
    queryKey: ["cs-data", gene],
    queryFn: () =>
      axios
        .get<string>(`${config.api_url}/gene_cs/${gene}?padding=${config.gene_view.gene_padding}`)
        .then((response) => {
          const rows = response.data.split("\n");
          const header = rows[0].split("\t");
          const headerIndex = header.reduce((acc, field) => {
            acc[field.replace("#", "")] = header.indexOf(field);
            return acc;
          }, {} as { [key: string]: number });
          const traitCS2data: { [traitCSId: string]: CSDatum } = {};
          const trait2uniqCS: { [trait: string]: Set<string> } = {};
          const csRegex = /_L?(\d+)$/;
          for (let i = 1; i < rows.length; i++) {
            if (rows[i].length === 0) {
              continue;
            }
            if (rows[i].startsWith("!")) {
              throw Error(rows[i].slice(1));
            }
            const fields = rows[i].split("\t");
            const resource = fields[headerIndex["resource"]];
            if (resource === "eQTL_Catalogue_R7") {
              //TODO remove this
              continue;
            }
            const dataset = fields[headerIndex["dataset"]];
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
            if (!traitCS2data[traitCSId]) {
              traitCS2data[traitCSId] = {
                resource: resource,
                dataset: dataset,
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
                // traitCSId: [],
                numberOfCSs: 0,
              };
            }
            traitCS2data[traitCSId].variant.push(variant);
            traitCS2data[traitCSId].pos.push(parseInt(pos));
            traitCS2data[traitCSId].pip.push(parseFloat(pip));
            traitCS2data[traitCSId].mlog10p.push(parseFloat(mlog10p));
            traitCS2data[traitCSId].beta.push(parseFloat(fields[headerIndex["beta"]]));
            traitCS2data[traitCSId].se.push(parseFloat(fields[headerIndex["se"]]));
            if (!trait2uniqCS[traitId]) {
              trait2uniqCS[traitId] = new Set<string>();
            }
            trait2uniqCS[traitId].add(csId);
          }
          const data = Object.keys(traitCS2data).map((traitCSId) => ({
            resource: traitCS2data[traitCSId].resource,
            dataset: traitCS2data[traitCSId].dataset,
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
          }));
          return data;
        }),
    enabled: !!gene,
    staleTime: Infinity,
  });
};

export const useTraitMetadataQuery = (
  traits: { resource: string; phenocode: string }[] | undefined
): UseQueryResult<{ [key: string]: Phenotype }, Error> => {
  return useQuery<{ [key: string]: Phenotype }>({
    queryKey: ["trait-metadata", traits],
    queryFn: () => {
      const response = axios
        .post<string>(`${config.api_url}/trait_metadata`, traits)
        .then((response) => {
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

// TODO hash
const isCoding = (mostSevere: string): boolean => {
  return (
    mostSevere === "missense" ||
    mostSevere === "frameshift" ||
    mostSevere === "inframe insertion" ||
    mostSevere === "inframe deletion" ||
    mostSevere === "transcript ablation" ||
    mostSevere === "stop gained" ||
    mostSevere === "stop lost" ||
    mostSevere === "start lost" ||
    mostSevere === "splice acceptor" ||
    mostSevere === "splice donor" ||
    mostSevere === "incomplete terminal codon" ||
    mostSevere === "protein altering" ||
    mostSevere === "coding sequence"
  );
};

const isLoF = (mostSevere: string): boolean => {
  return (
    mostSevere === "transcript ablation" ||
    mostSevere === "splice acceptor" ||
    mostSevere === "splice donor" ||
    mostSevere === "stop gained" ||
    mostSevere === "frameshift" ||
    mostSevere === "stop lost" ||
    mostSevere === "start lost"
  );
};

export const useVariantAnnotationQuery = (
  variants: string[] | undefined
): UseQueryResult<{ [key: string]: { [key: string]: string | boolean } }, Error> => {
  if (!variants || variants.length === 0) {
    return useQuery<{ [key: string]: { [key: string]: string | boolean } }>({
      queryKey: ["variant-annotation", "none"],
      queryFn: () => Promise.resolve({}),
      enabled: false,
    });
  }
  return useQuery<{ [key: string]: { [key: string]: string | boolean } }>({
    queryKey: ["variant-annotation", variants],
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
      const response = axios
        .post<string>(`${config.api_url}/variant_annotation/${chr}/${start}/${end}`, variants)
        .then((response) => {
          // console.time("variant annotation parsing");
          const rows = response.data.split("\n");
          const header = rows[0].split("\t");
          const headerIndex = header.reduce((acc, field) => {
            acc[field.replace("#", "")] = header.indexOf(field);
            return acc;
          }, {} as { [key: string]: number });
          // TODO typing
          const var2anno = {} as { [key: string]: { [key: string]: string | boolean } };
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
            var2anno[variant] = {
              rsid: fields[headerIndex["rsids"]],
              consequence: consequence,
              isCoding: isCoding(consequence),
              isLoF: isLoF(consequence),
              af: fields[headerIndex["AF"]],
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
