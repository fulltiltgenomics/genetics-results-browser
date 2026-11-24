import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import api from "@/store/api";
import type { ProteinModel } from "./proteinTrack";

// apart from proteinApi.ts because the gene page's tab strip asks this one question of every
// gene, so it is in the main bundle; the rest ships with the section's lazy chunk

/** The deployment serves no protein-structure routes (finngen): the gene page offers no protein tab. */
export class ProteinStructureNotConfigured extends Error {}
/** The routes exist but no release has loaded yet: the section says so quietly. */
export class ProteinStructureNotYetAvailable extends Error {}

export const STALE = 5 * 60 * 1000;

export const failure = (e: unknown): { status?: number; detail: string } => {
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
export const throwIfAbsent = (e: unknown): number | undefined => {
  const { status, detail } = failure(e);
  if (status === 404 && (detail === "Not Found" || /not configured/i.test(detail))) {
    throw new ProteinStructureNotConfigured(detail);
  }
  if (status === 503) throw new ProteinStructureNotYetAvailable(detail);
  return status;
};

export const retry = (failures: number, error: Error): boolean =>
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
