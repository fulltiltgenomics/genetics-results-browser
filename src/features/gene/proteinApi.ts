import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import api from "@/store/api";
import { failure, retry, STALE, throwIfAbsent } from "./proteinModels";
import {
  parseExome,
  parseFeatures,
  parseResidues,
  type ExomeVariantRow,
  type FeatureRow,
  type ResidueRow,
  type VariantMapRow,
} from "./proteinTrack";

// here rather than in store/serverQuery.ts so the hooks ship with the section's lazy chunk

// results-api's cap on one variant list (max_query_variants)
const MAX_VARIANTS_PER_REQUEST = 2000;

const tsvRows = async <T>(path: string, parse: (text: string) => T[]): Promise<T[]> => {
  try {
    // TSV always: the JSON form of the residue table is refused (413) for the largest proteins
    const res = await api.get<string>(path, { params: { format: "tsv" }, responseType: "text" });
    return parse(res.data);
  } catch (e) {
    if (throwIfAbsent(e) === 404) return [];
    throw e;
  }
};

export const useProteinResidues = (gene: string, enabled: boolean): UseQueryResult<ResidueRow[], Error> =>
  useQuery({
    queryKey: ["protein-structure", "residues", gene],
    queryFn: () => tsvRows(`/v1/protein_structure/residues/${encodeURIComponent(gene)}`, parseResidues),
    enabled,
    staleTime: STALE,
    retry,
  });

export const useProteinFeatures = (gene: string, enabled: boolean): UseQueryResult<FeatureRow[], Error> =>
  useQuery({
    queryKey: ["protein-structure", "features", gene],
    queryFn: () => tsvRows(`/v1/protein_structure/features/${encodeURIComponent(gene)}`, parseFeatures),
    enabled,
    staleTime: STALE,
    retry,
  });

/** Exome association rows inside the gene body, every annotation class. */
export const useGeneExomeVariants = (gene: string, enabled: boolean): UseQueryResult<ExomeVariantRow[], Error> =>
  useQuery({
    queryKey: ["gene-exome-variants", gene],
    queryFn: async () => {
      try {
        const res = await api.get<string>(`/v1/exome_results_by_gene/${encodeURIComponent(gene)}`, {
          params: { format: "tsv" },
          responseType: "text",
        });
        return parseExome(res.data);
      } catch (e) {
        if (failure(e).status === 404) return [];
        throw e;
      }
    },
    enabled,
    staleTime: STALE,
    retry,
  });

type MapApiRow = Record<string, string>;

/** The release's variant-to-residue rows for a variant list; a variant it does not place has none. */
export const useVariantProteinMap = (
  variants: string[],
  enabled: boolean,
): UseQueryResult<VariantMapRow[], Error> =>
  useQuery({
    queryKey: ["protein-structure", "variant-map", variants],
    queryFn: async () => {
      const rows: VariantMapRow[] = [];
      for (let i = 0; i < variants.length; i += MAX_VARIANTS_PER_REQUEST) {
        const res = await api.post<MapApiRow[]>(
          "/v1/variant_annotation/protein",
          { variants: variants.slice(i, i + MAX_VARIANTS_PER_REQUEST) },
          { params: { format: "json" } },
        );
        for (const r of res.data) {
          rows.push({
            variant: r.variant,
            accession: r.accession,
            geneName: r.gene_name === "NA" ? "" : (r.gene_name ?? ""),
            aaPos: Number(r.aa_pos),
            aaRef: r.aa_ref,
            aaAlt: r.aa_alt,
            modelFileId: r.model_file_id,
            filePosition: Number(r.file_position),
          });
        }
      }
      return rows;
    },
    enabled: enabled && variants.length > 0,
    staleTime: STALE,
  });
