import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import api from "@/store/api";
import {
  parseExome,
  parseFeatures,
  parseResidues,
  type ExomeVariantRow,
  type FeatureRow,
  type ProteinModel,
  type ResidueRow,
  type VariantMapRow,
} from "./proteinTrack";

// here rather than in store/serverQuery.ts so the hooks ship with the section's lazy chunk

/** The deployment serves no protein-structure routes (finngen): the gene page hides the section. */
export class ProteinStructureNotConfigured extends Error {}
/** The routes exist but no release has loaded yet: the section says so quietly. */
export class ProteinStructureNotYetAvailable extends Error {}

const STALE = 5 * 60 * 1000;
// results-api's cap on one variant list (max_query_variants)
const MAX_VARIANTS_PER_REQUEST = 2000;

const failure = (e: unknown): { status?: number; detail: string } => {
  if (!isAxiosError(e)) return { detail: "" };
  let body: unknown = e.response?.data;
  // a TSV request's error body arrives as the JSON text
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = undefined;
    }
  }
  return {
    status: e.response?.status,
    detail: String((body as { detail?: unknown } | undefined)?.detail ?? ""),
  };
};

// a results-api with no release pointer registers none of these routes, so the 404 is
// FastAPI's own; a gene or protein the release does not hold is also a 404, with its own text
const throwIfAbsent = (e: unknown): number | undefined => {
  const { status, detail } = failure(e);
  if (status === 404 && (detail === "Not Found" || /not configured/i.test(detail))) {
    throw new ProteinStructureNotConfigured(detail);
  }
  if (status === 503) throw new ProteinStructureNotYetAvailable(detail);
  return status;
};

const retry = (failures: number, error: Error): boolean =>
  !(error instanceof ProteinStructureNotConfigured) &&
  !(error instanceof ProteinStructureNotYetAvailable) &&
  failures < 2;

interface ModelApiRow {
  model_file_id: string;
  accession: string;
  gene_name: string;
  source_label: string;
  window_index: number;
  n_windows: number;
  protein_start: number;
  protein_end: number;
  owned_start: number;
  owned_end: number;
}

/** The gene's model files; an empty list where the release holds none for it. */
export const useProteinModels = (
  gene: string | undefined,
): UseQueryResult<{ models: ProteinModel[]; release: string | null }, Error> =>
  useQuery({
    queryKey: ["protein-structure", "models", gene],
    queryFn: async () => {
      try {
        const res = await api.get<ModelApiRow[]>(`/v1/protein_structure/models/${encodeURIComponent(gene!)}`);
        return {
          release: (res.headers?.["x-dataset-version"] as string) ?? null,
          models: res.data.map(
            (m): ProteinModel => ({
              modelFileId: m.model_file_id,
              accession: m.accession,
              geneNames: String(m.gene_name ?? "").split(",").filter(Boolean),
              sourceLabel: m.source_label,
              windowIndex: Number(m.window_index),
              nWindows: Number(m.n_windows),
              proteinStart: Number(m.protein_start),
              proteinEnd: Number(m.protein_end),
              ownedStart: Number(m.owned_start),
              ownedEnd: Number(m.owned_end),
            }),
          ),
        };
      } catch (e) {
        if (throwIfAbsent(e) === 404) return { models: [], release: null };
        throw e;
      }
    },
    enabled: !!gene,
    staleTime: STALE,
    retry,
  });

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
