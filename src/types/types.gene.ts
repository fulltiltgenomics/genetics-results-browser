/**
 * One gene drawn as a model. The body is min(exonStarts)..max(exonEnds) — the span of the ONE
 * transcript being drawn, GENCODE's Ensembl-canonical one, and deliberately not the gene
 * record's own start and end. A gene record spans every transcript it has, which for TUBA1C
 * is 86 kb against a 9.5 kb canonical transcript, so drawing the record puts the exons in a
 * corner of a long bare line and the gene reads as being somewhere it is not. A row the API
 * sent no exons for arrives as one full-length exon, so the same min/max gives the record
 * back where that is all there is.
 *
 * The exon arrays are positional and equal length: exon i spans exonStarts[i]..exonEnds[i]
 * and its translated part is cdsStarts[i]..cdsEnds[i], null where that exon is entirely UTR.
 */
export type GeneModel = {
  geneName: string;
  ensg: string;
  chr: string;
  strand: number;
  exonStarts: number[];
  exonEnds: number[];
  cdsStarts: (number | null)[];
  cdsEnds: (number | null)[];
};
