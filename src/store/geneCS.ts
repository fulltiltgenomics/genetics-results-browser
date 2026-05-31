import { CSDatum, GeneModel } from "@/types/types.gene";
import { isCoding, isLoF } from "@/utils/coding";
import config from "@/config.json";

/**
 * raw credible-set row shape returned by the new genetics-results-api endpoints
 * credible_sets_by_gene (cis) and credible_sets_by_qtl_gene (trans). field names differ from the
 * legacy gene_cs TSV: aaf (not AF), no rsids, lowercase resource ids — mapped in groupCredibleSets.
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
  mlog10p: number;
  beta: number;
  se: number;
  pip: number;
  cs_id: string;
  cs_size: number;
  cs_min_r2: number;
  aaf: number | null;
  most_severe: string | null;
  gene_most_severe: string | null;
  // present only on credible_sets_by_qtl_gene (the molecular trait's gene body)
  trait_chr?: number;
  trait_start?: number;
  trait_end?: number;
}

/**
 * the entire gene view (CisView/CSPlot/DatasetOptions/store.gene) keys on config.gene_view.resources
 * dataName for colors, labels, sort order and the resource toggles. the new API instead returns
 * lowercase resource ids (finngen, ukbb, eqtl_catalogue, ...) plus a dataset, so we translate each
 * row to its legacy dataName here. unmapped rows (e.g. combined meta-analyses not in config) return
 * undefined and are dropped by the grouping so the view never shows a colorless, untoggleable row.
 */
export const mapToDataName = (
  resource: string,
  dataset: string,
  dataType: string
): string | undefined => {
  // dataset-specific buckets first — these split one upstream resource (finngen) into the
  // separate FG Core / Kanta / Drugs / Olink rows the legacy config models.
  const datasetMap: Record<string, string> = {
    FinnGen_R13: "FinnGen",
    FinnGen_kanta: "FinnGen_kanta",
    FinnGen_drugs: "FinnGen_drugs",
    FinnGen_Olink: "FinnGen_pQTL",
    UKB_PPP: "UKBB_pQTL",
  };
  if (datasetMap[dataset]) {
    return datasetMap[dataset];
  }
  // combined FinnGen meta-analyses (R13 + MVP + UKBB, with/without labs) are GWAS; surface them
  // under their own config buckets so they stay visible and individually toggleable.
  if (resource === "finngen_mvp_ukbb") {
    return "FinnGen_MVP_UKBB";
  }
  if (resource === "finngen_ukbb") {
    return "FinnGen_UKBB";
  }
  switch (resource) {
    case "ukbb":
      return dataType === "GWAS" ? "UKBB_119" : undefined;
    case "bbj":
      return "BBJ_79";
    case "eqtl_catalogue":
      return "eQTL_Catalogue_R7";
    case "finngen":
      if (dataType === "eQTL") return "FinnGen_eQTL";
      if (dataType === "pQTL") return "FinnGen_pQTL";
      return undefined;
    default:
      // open_targets and anything else not modelled in config — not shown in this view
      return undefined;
  }
};

const CS_NUMBER_REGEX = /_L?(\d+)$/;

/**
 * group the new flat JSON rows into one CSDatum per credible set, mirroring the legacy useCSQuery
 * grouping: a CS is identified by resource(dataName)|dataset|trait=cs_id and accumulates its member
 * variants into parallel arrays (variant/pos/pip/mlog10p/beta/se/consequence/af/gene/rsid).
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
    if (dataName === undefined) {
      continue;
    }
    const chr = String(row.chr);
    const variant = `${chr}:${row.pos}:${row.ref}:${row.alt}`;
    const trait = row.trait;
    const traitId = `${dataName}|${row.dataset}|${trait}`;
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

/**
 * raw row from genes_in_region. the new endpoint exposes only gene bodies (no exon structure), so
 * the gene track loses exon-level detail vs the legacy gene_model TSV — see geneModelsFromRegion.
 */
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
}

/**
 * adapt genes_in_region rows to the GeneModel shape CSPlot draws. the endpoint provides only gene
 * boundaries, so we model each gene as a single full-length "exon" (start..end): the gene line and
 * body still render and the strand arrow + click-through work, but individual exons are not drawn.
 * prefer the hgnc symbol for the label/click target, falling back to the raw gene_name (an ENSG when
 * no hgnc mapping exists).
 */
export const geneModelsFromRegion = (rows: GeneInRegionApiRow[]): GeneModel[] => {
  return rows.map((row) => ({
    geneName: row.hgnc_symbol ?? row.gene_name,
    ensg: row.gene_name.startsWith("ENSG") ? row.gene_name : "",
    chr: String(row.chrom),
    strand: row.gene_strand === "-" ? -1 : 1,
    exonStarts: [row.gene_start],
    exonEnds: [row.gene_end],
  }));
};

// resolve which config dataNames are GWAS so callers can identify cis GWAS rows if needed
export const GWAS_DATA_NAMES = new Set(
  config.gene_view.resources.filter((r) => r.dataType === "GWAS").map((r) => r.dataName)
);
