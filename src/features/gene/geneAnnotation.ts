import type { GeneAnnotation } from "../../../bff/geneAnnotationTypes";
import { GeneModel } from "@/types/types.gene";

/** Links and gene-model geometry of the gene annotation tab, kept pure so they are tested directly. */

export interface ExternalLink {
  label: string;
  href: string;
}

export interface GeneIds {
  hgncId: string | null;
  ensemblId: string | null;
}

/**
 * Links to the gene's page in other resources. The ones built from the HGNC and Ensembl ids come
 * first and do not depend on mygene.info, so they are there when that record is missing.
 */
export const geneLinks = (ids: GeneIds, annotation: GeneAnnotation | null): ExternalLink[] => {
  const ensemblId = ids.ensemblId ?? annotation?.ensemblGeneId ?? null;
  const links: (ExternalLink | null)[] = [
    ensemblId
      ? {
          label: "gnomAD",
          href: `https://gnomad.broadinstitute.org/gene/${ensemblId}?dataset=gnomad_r4`,
        }
      : null,
    ensemblId ? { label: "CASCADE", href: `https://cascade.finngen.fi/gene/${ensemblId}` } : null,
    ids.hgncId
      ? {
          label: "ClinGen",
          href: `https://search.clinicalgenome.org/kb/genes/${ids.hgncId}`,
        }
      : null,
    annotation?.uniprotId
      ? {
          label: "UniProt",
          href: `https://www.uniprot.org/uniprotkb/${annotation.uniprotId}/entry`,
        }
      : null,
    ids.hgncId
      ? {
          label: "HGNC",
          href: `https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/${ids.hgncId}`,
        }
      : null,
    ensemblId
      ? {
          label: "Ensembl",
          href: `https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=${ensemblId}`,
        }
      : null,
    annotation?.ncbiGeneId
      ? {
          label: "NCBI Gene",
          href: `https://www.ncbi.nlm.nih.gov/gene/${annotation.ncbiGeneId}`,
        }
      : null,
    annotation?.omimId
      ? { label: "OMIM", href: `https://omim.org/entry/${annotation.omimId}` }
      : null,
    annotation?.pharmgkbId
      ? {
          label: "ClinPGx",
          href: `https://www.clinpgx.org/gene/${annotation.pharmgkbId}`,
        }
      : null,
  ];
  return links.filter((l): l is ExternalLink => !!l);
};

const PATHWAY_SOURCES = {
  kegg: {
    label: "KEGG",
    url: (id: string) => `https://www.kegg.jp/pathway/${id}`,
  },
  reactome: {
    label: "Reactome",
    url: (id: string) => `https://reactome.org/content/detail/${id}`,
  },
  wikipathways: {
    label: "WikiPathways",
    url: (id: string) => `https://www.wikipathways.org/pathways/${id}`,
  },
};

export const pathwaySource = (source: keyof typeof PATHWAY_SOURCES) => PATHWAY_SOURCES[source];

export const interproUrl = (id: string) => `https://www.ebi.ac.uk/interpro/entry/InterPro/${id}/`;
export const goUrl = (id: string) => `https://www.ebi.ac.uk/QuickGO/term/${id}`;

export const GO_ASPECTS = [
  { key: "BP", label: "biological process" },
  { key: "MF", label: "molecular function" },
  { key: "CC", label: "cellular component" },
] as const;

export interface ModelExon {
  // 1-based in transcription order, so exon 1 is at the right for a gene on the minus strand
  number: number;
  start: number;
  end: number;
  // the translated part, null for an exon that is entirely UTR
  cds: { start: number; end: number } | null;
}

export interface ModelLayout {
  start: number;
  end: number;
  exons: ModelExon[];
  // genomic midpoints of the introns wide enough to carry a strand arrow
  arrows: number[];
}

// an intron narrower than this share of the transcript has no room for an arrow
const MIN_ARROW_INTRON_FRACTION = 0.04;

export const layoutGeneModel = (model: GeneModel): ModelLayout => {
  const order = model.exonStarts
    .map((_, i) => i)
    .sort((a, b) => model.exonStarts[a] - model.exonStarts[b]);
  const n = order.length;
  const exons = order.map((i, rank) => {
    const cdsStart = model.cdsStarts[i];
    const cdsEnd = model.cdsEnds[i];
    return {
      number: model.strand === 1 ? rank + 1 : n - rank,
      start: model.exonStarts[i],
      end: model.exonEnds[i],
      cds: cdsStart != null && cdsEnd != null ? { start: cdsStart, end: cdsEnd } : null,
    };
  });
  const start = exons[0].start;
  const end = Math.max(...exons.map((e) => e.end));
  const arrows: number[] = [];
  for (let i = 0; i + 1 < exons.length; i++) {
    const gap = exons[i + 1].start - exons[i].end;
    if (gap / (end - start) >= MIN_ARROW_INTRON_FRACTION) {
      arrows.push(exons[i].end + gap / 2);
    }
  }
  return { start, end, exons, arrows };
};

export const formatSpan = (bp: number): string =>
  bp >= 1e6
    ? `${(bp / 1e6).toFixed(2)} Mb`
    : bp >= 1e3
      ? `${(bp / 1e3).toFixed(1)} kb`
      : `${bp} bp`;

const CHR_NAMES: Record<string, string> = {
  "23": "X",
  "24": "Y",
  "25": "MT",
  "26": "MT",
};
export const chrName = (chr: string): string => CHR_NAMES[chr] ?? chr;
