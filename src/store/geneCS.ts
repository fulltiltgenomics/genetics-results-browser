import { GeneModel } from "@/types/types.gene";

/**
 * one member of a credible set, as the genetics-results-api credible-set endpoints return it
 */
export interface GeneCSApiRow {
  resource: string;
  version: string;
  dataset: string;
  data_type: string;
  trait: string;
  trait_original: string;
  cell_type: string | null;
  chr: number;
  pos: number;
  ref: string;
  alt: string;
  // null where the source has no statistic for the member: Open Targets omits mlog10p and se on
  // many rows, the NMR meta-analysis omits all four
  mlog10p: number | null;
  beta: number | null;
  se: number | null;
  pip: number;
  cs_id: string;
  cs_size: number;
  cs_min_r2: number | null;
  aaf: number | null;
  most_severe: string | null;
  gene_most_severe: string | null;
}

/** raw row from genes_in_region (format=json, so the exon columns arrive as real arrays) */
export interface GeneInRegionApiRow {
  gene_name: string;
  chrom: number;
  gene_start: number;
  gene_end: number;
  gene_strand: string;
  gene_type: string;
  hgnc_symbol: string | null;
  hgnc_name: string | null;
  hgnc_alias_symbol: string | null;
  hgnc_prev_symbol: string | null;
  exon_starts?: number[];
  exon_ends?: number[];
  cds_starts?: (number | null)[];
  cds_ends?: (number | null)[];
}

/**
 * adapt genes_in_region rows to the GeneModel shape the gene tracks draw. prefer the hgnc symbol for
 * the label, falling back to the raw gene_name (an ENSG when no hgnc mapping exists).
 *
 * a row with no exon arrays falls back to one full-length "exon" spanning the gene: the API serves
 * exons only for GENCODE releases that have an exon file, and a results-api predating them serves
 * none at all. that keeps the gene body, the strand arrow and the click-through working, which is
 * exactly what the track did before exons existed.
 */
export const geneModelsFromRegion = (rows: GeneInRegionApiRow[]): GeneModel[] => {
  return rows.map((row) => {
    const hasExons = !!row.exon_starts?.length && row.exon_starts.length === row.exon_ends?.length;
    const exonStarts = hasExons ? row.exon_starts! : [row.gene_start];
    const exonEnds = hasExons ? row.exon_ends! : [row.gene_end];
    const blank = exonStarts.map(() => null);
    return {
      geneName: row.hgnc_symbol ?? row.gene_name,
      ensg: row.gene_name.startsWith("ENSG") ? row.gene_name : "",
      chr: String(row.chrom),
      strand: row.gene_strand === "-" ? -1 : 1,
      exonStarts,
      exonEnds,
      cdsStarts: hasExons && row.cds_starts?.length === exonStarts.length ? row.cds_starts : blank,
      cdsEnds: hasExons && row.cds_ends?.length === exonEnds.length ? row.cds_ends : blank,
    };
  });
};
