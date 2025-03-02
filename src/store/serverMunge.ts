import { GeneModel } from "@/types/types.gene";

export const mungeGeneModelResponse = (data: string): GeneModel[] => {
  const rows = data.split("\n");
  const header = rows[0].split("\t");
  const headerIndex = header.reduce((acc, field) => {
    acc[field.replace("#", "")] = header.indexOf(field);
    return acc;
  }, {} as { [key: string]: number });
  const geneModels = [] as GeneModel[];
  const gene2exons = {} as {
    [key: string]: { ensg: string; strand: number; exonStarts: number[]; exonEnds: number[] };
  };
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length === 0) {
      continue;
    }
    const fields = rows[i].split("\t");
    const geneName = fields[headerIndex["Gene name"]];
    const ensg = fields[headerIndex["Gene stable ID version"]].split(".")[0];
    const strand = parseInt(fields[headerIndex["Strand"]]);
    const exonStart = parseInt(fields[headerIndex["Exon region start (bp)"]]);
    const exonEnd = parseInt(fields[headerIndex["Exon region end (bp)"]]);
    if (!gene2exons[geneName]) {
      gene2exons[geneName] = { ensg: ensg, strand: strand, exonStarts: [], exonEnds: [] };
    }
    gene2exons[geneName].exonStarts.push(exonStart);
    gene2exons[geneName].exonEnds.push(exonEnd);
  }
  for (const geneName in gene2exons) {
    geneModels.push({
      geneName: geneName,
      ensg: gene2exons[geneName].ensg,
      strand: gene2exons[geneName].strand,
      exonStarts: gene2exons[geneName].exonStarts,
      exonEnds: gene2exons[geneName].exonEnds,
    });
  }
  return geneModels;
};
