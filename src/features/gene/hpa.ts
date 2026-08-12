/**
 * Human Protein Atlas immunohistochemistry rows, as served by expression_by_gene.
 *
 * `tissue_cell` packs HPA's organ, tissue and cell-type columns as `organ|tissue|cell_type`. The
 * organ and tissue are usually the same word ("lung|lung|macrophages") and differ only where HPA
 * numbers several samples of one organ ("endometrium|endometrium_2|glandular_cells"), so the display
 * label drops a segment the next one already refines.
 *
 * `level` is a staining category, not a number: High / Medium / Low / Not_detected.
 */

export const hpaTissueLabel = (tissueCell: string): string =>
  tissueCell
    .split("|")
    .filter((part, i, parts) => i === parts.length - 1 || !parts[i + 1].startsWith(part))
    .map((part) => part.replace(/_/g, " "))
    .join(", ");

export const hpaLevelLabel = (level: string): string => level.replace(/_/g, " ");

const LEVEL_RANK: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
  "not detected": 0,
};

// staining intensity as an orderable number so the table can sort high → not detected; unrecognised
// levels sort below all known ones rather than mixing into them
export const hpaLevelRank = (level: string): number =>
  LEVEL_RANK[hpaLevelLabel(level).toLowerCase()] ?? -1;
