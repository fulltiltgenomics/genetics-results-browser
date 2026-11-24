import { CSDatum, GeneModel } from "@/types/types.gene";
import { isCoding, isLoF } from "@/utils/coding";

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

/**
 * the protein track's credible sets are grouped per data name, a bucket that splits one upstream
 * resource (finngen) by dataset and data type. rows no bucket covers return undefined and are
 * dropped by the grouping.
 */
export const EQTL_CATALOGUE_DATA_NAME = "eQTL_Catalogue_R7";
const OPEN_TARGETS_DATA_NAME = "Open_Targets";
// Open Targets' GTEx v10 and IBDverse QTLs share the open_targets resource with its GWAS but are
// labelled by tissue like eQTL Catalogue's
const OPEN_TARGETS_QTL_DATA_NAME = "Open_Targets_QTL";

export const mapToDataName = (
  resource: string,
  dataset: string,
  dataType: string
): string | undefined => {
  // dataset-specific buckets first — these split one upstream resource (finngen) into the
  // separate FG Core / Kanta / Drugs / Olink rows the legacy config models.
  const datasetMap: Record<string, string> = {
    FinnGen_kanta: "FinnGen_kanta",
    FinnGen_drugs: "FinnGen_drugs",
    FinnGen_Olink: "FinnGen_pQTL",
    UKB_PPP: "UKBB_pQTL",
  };
  if (datasetMap[dataset]) {
    return datasetMap[dataset];
  }
  // the FinnGen core GWAS dataset carries its release inline (FinnGen_R13, FinnGen_R14, ...), so
  // match any release: pinning one release silently emptied the whole FG Core bucket when the API
  // moved on. anchored, so the FinnGen_R14_MVP_UKBB_AOU meta-analysis below is not swallowed here.
  if (/^FinnGen_R\d+$/.test(dataset)) {
    return "FinnGen";
  }
  // the combined FinnGen meta-analysis is GWAS; surface it under its own config bucket so it
  // stays visible and individually toggleable.
  if (resource === "finngen_mvp_ukbb_aou") {
    return "FinnGen_MVP_UKBB_AOU";
  }
  switch (resource) {
    case "eqtl_catalogue":
      return EQTL_CATALOGUE_DATA_NAME;
    case "open_targets":
      return dataType === "GWAS" ? OPEN_TARGETS_DATA_NAME : OPEN_TARGETS_QTL_DATA_NAME;
    case "finngen":
      if (dataType === "eQTL") return "FinnGen_eQTL";
      if (dataType === "pQTL") return "FinnGen_pQTL";
      // caQTL trait is an ATAC peak id (not a gene symbol); it still gets its own config bucket so
      // the cis/trans plot colors + toggles it instead of dropping it
      if (dataType === "caQTL") return "FinnGen_caQTL";
      return undefined;
    default:
      // anything not modelled in config.gene_view.resources — not shown in this view
      return undefined;
  }
};

/**
 * config dataNames whose credible sets are pseudo (built from summary stats + LD around the lead
 * variant, not fine-mapped), derived from the /v1/datasets flag rather than hardcoded so the gene
 * view cannot drift from the anno tables. the flag is per dataset but uniform within a resource for
 * everything this view shows, so mapping the resource id alone is enough.
 */
export const pseudoDataNames = (
  datasets: { resource: string; dataType: string; hasPseudoCredibleSets: boolean }[] | undefined
): Set<string> => {
  const out = new Set<string>();
  for (const d of datasets ?? []) {
    if (!d.hasPseudoCredibleSets) {
      continue;
    }
    // /v1/datasets lowercases the data type ("gwas"); the credible-set rows use "GWAS"
    const dataName = mapToDataName(d.resource, "", d.dataType.toUpperCase());
    if (dataName !== undefined) {
      out.add(dataName);
    }
  }
  return out;
};

// the set-level thresholds the protein track applies
export const DEFAULT_MAX_CS_SIZE = 50;
export const DEFAULT_MIN_LEAD_MLOG10P = 10;

/**
 * Whether a credible set counts as evidence about this gene at all: an eQTL or pQTL set only
 * when the gene is its molecular trait, a lead at least as strong as the threshold, and a set
 * no larger than the cap.
 */
export const passesSetFilters = (
  d: CSDatum,
  geneName: string,
  { maxCsSize, minLeadMlog10p }: { maxCsSize: number; minLeadMlog10p: number }
): boolean =>
  ((d.dataType !== "eQTL" && d.dataType !== "pQTL") ||
    d.trait.toLowerCase() === geneName.toLowerCase()) &&
  d.mlog10p.some((mlog10p) => mlog10p !== null && mlog10p >= minLeadMlog10p) &&
  d.csSize <= maxCsSize &&
  d.variant.length > 0;

const CS_NUMBER_REGEX = /_L?(\d+)$/;

/**
 * eQTL Catalogue publishes each study/tissue at several quantification methods — encoded as the
 * suffix of trait_original (|ge, |exon, |tx, |txrev, |leafcutter, |majiq, |microarray, |aptamer).
 * they all report the same gene symbol as `trait`, so on a row labelled by gene + tissue the extra
 * methods are indistinguishable duplicates; this view keeps gene-level expression (ge) only. Open
 * Targets QTLs carry the same suffixes and are treated the same way.
 */
const isDroppedQuantificationMethod = (row: GeneCSApiRow): boolean =>
  (row.resource === "eqtl_catalogue" ||
    (row.resource === "open_targets" && row.data_type !== "GWAS")) &&
  !(row.trait_original ?? "").endsWith("|ge");

/**
 * group the flat JSON rows into one CSDatum per credible set: a CS is identified by
 * resource(dataName)|dataset|trait=cs_id and accumulates its member variants into parallel arrays
 * (variant/pos/pip/mlog10p/beta/se/consequence/af/gene/rsid).
 *
 * `traitKey` lets the trans path key the trait on the molecular-trait gene (the upstream `trait`
 * already is the gene symbol for QTL rows, so cis and trans share the same key here).
 */
export const groupCredibleSets = (rows: GeneCSApiRow[]): CSDatum[] => {
  const traitCS2data: Record<string, CSDatum> = {};
  const trait2uniqCS: Record<string, Set<string>> = {};
  const seenVariantCSIds = new Set<string>();

  for (const row of rows) {
    const dataName = mapToDataName(row.resource, row.dataset, row.data_type);
    if (dataName === undefined || isDroppedQuantificationMethod(row)) {
      continue;
    }
    const chr = String(row.chr);
    const variant = `${chr}:${row.pos}:${row.ref}:${row.alt}`;
    const trait = row.trait;
    // the cell type belongs in the key: FinnGen's single-cell datasets (FinnGen_ATACseq,
    // FinnGen_snRNAseq) fine-map every cell type under one dataset id and reuse the cs_id across
    // them, so keying on dataset+trait+cs_id alone collapsed a peak's cell types into a single row
    // whose variants were the union of all of them, but whose cs_size was whichever row arrived
    // first — a 94-variant row could report (and be filtered as) a credible set of 4.
    const traitId = `${dataName}|${row.dataset}|${row.cell_type ?? ""}|${trait}`;
    const traitCSId = `${traitId}=${row.cs_id}`;

    // the API can emit the same variant twice within a CS (e.g. multi-annotation rows); keep first
    if (seenVariantCSIds.has(variant + traitCSId)) {
      continue;
    }
    seenVariantCSIds.add(variant + traitCSId);

    if (!traitCS2data[traitCSId]) {
      const csNumberMatch = row.cs_id.match(CS_NUMBER_REGEX);
      traitCS2data[traitCSId] = {
        resource: dataName,
        dataset: row.dataset,
        dataType: row.data_type,
        trait,
        traitOriginal: row.trait_original,
        cellType: row.cell_type,
        traitId,
        traitCSId,
        csId: row.cs_id,
        csNumber: csNumberMatch ? parseInt(csNumberMatch[1]) : 1,
        csSize: row.cs_size,
        csMinR2: row.cs_min_r2,
        chr,
        variant: [],
        pos: [],
        pip: [],
        mlog10p: [],
        beta: [],
        se: [],
        numberOfCSs: 0,
        consequence: [],
        isCoding: [],
        isLoF: [],
        af: [],
        gene: [],
        rsid: [],
      };
    }

    // the new most_severe carries the "_variant" suffix the legacy coding helpers don't expect
    const consequence = row.most_severe ?? "NA";
    const cleaned = consequence.replace("_variant", "");
    const cs = traitCS2data[traitCSId];
    cs.variant.push(variant);
    cs.pos.push(row.pos);
    cs.pip.push(row.pip);
    cs.mlog10p.push(row.mlog10p);
    cs.beta.push(row.beta);
    cs.se.push(row.se);
    cs.consequence.push(consequence);
    cs.isCoding.push(isCoding(cleaned));
    cs.isLoF.push(isLoF(cleaned));
    cs.af.push(row.aaf == null ? "NA" : String(row.aaf));
    cs.gene.push(row.gene_most_severe ?? "NA");
    cs.rsid.push("NA"); // not provided by the new endpoints

    if (!trait2uniqCS[traitId]) {
      trait2uniqCS[traitId] = new Set<string>();
    }
    trait2uniqCS[traitId].add(row.cs_id);
  }

  return Object.values(traitCS2data).map((cs) => ({
    ...cs,
    numberOfCSs: trait2uniqCS[cs.traitId].size,
  }));
};

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
