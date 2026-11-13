import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import api from "@/store/api";

// here rather than in store/serverQuery.ts so the hook ships in the viewer's lazy chunk:
// serverQuery is part of the main bundle every visitor downloads

/** The release holds no model under this id: the viewer refuses rather than drawing another. */
export class StructureModelNotFound extends Error {}
/** results-api has no protein-structure release loaded (yet). */
export class StructureReleaseUnavailable extends Error {}

/**
 * One model file as PDB text. results-api stores and sends it gzipped; the BFF passthrough
 * decodes it, so the text arrives here either way.
 */
export const useStructureModel = (
  modelFileId: string,
  enabled: boolean,
): UseQueryResult<string, Error> =>
  useQuery({
    enabled,
    queryKey: ["protein-structure", "model", modelFileId],
    queryFn: async () => {
      try {
        const res = await api.get<string>(
          `/v1/protein_structure/structure/${encodeURIComponent(modelFileId)}`,
          { responseType: "text" },
        );
        return res.data;
      } catch (e) {
        const status = isAxiosError(e) ? e.response?.status : undefined;
        if (status === 404) throw new StructureModelNotFound(modelFileId);
        if (status === 503) throw new StructureReleaseUnavailable(modelFileId);
        throw e;
      }
    },
    // a model file is megabytes of text and immutable within a release
    staleTime: Infinity,
    retry: (failures, error) =>
      !(error instanceof StructureModelNotFound) &&
      !(error instanceof StructureReleaseUnavailable) &&
      failures < 2,
  });
