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
// config.gene_view.resources dataName for eQTL Catalogue; its rows are labelled by tissue rather
// than by dataset, so the naming path needs to recognise them (see geneViewTraitName)
export const EQTL_CATALOGUE_DATA_NAME = "eQTL_Catalogue_R7";
const OPEN_TARGETS_DATA_NAME = "Open_Targets";

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
  // moved on. anchored, so the FinnGen_R13_UKBB* meta-analyses below are not swallowed here.
  if (/^FinnGen_R\d+$/.test(dataset)) {
    return "FinnGen";
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
    case "eqtl_catalogue":
      return EQTL_CATALOGUE_DATA_NAME;
    case "open_targets":
      return OPEN_TARGETS_DATA_NAME;
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

const CS_NUMBER_REGEX = /_L?(\d+)$/;

/**
 * eQTL Catalogue publishes each study/tissue at several quantification methods — encoded as the
 * suffix of trait_original (|ge, |exon, |tx, |txrev, |leafcutter, |majiq, |microarray, |aptamer).
 * they all report the same gene symbol as `trait`, so on a row labelled by gene + tissue the extra
 * methods are indistinguishable duplicates; this view keeps gene-level expression (ge) only.
 */
const isDroppedQuantificationMethod = (row: GeneCSApiRow): boolean =>
  row.resource === "eqtl_catalogue" && !(row.trait_original ?? "").endsWith("|ge");

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

/**
 * true when the API gave back the bare phenocode instead of a name: the credible-set endpoints
 * resolve `trait` from the same dictionary as /v1/trait_name_mapping but miss the FinnGen drug
 * (ATC_*_IRN) and lab (numeric OMOP code) traits, which then arrive with trait === trait_original.
 * QTL rows are excluded because their trait legitimately equals trait_original (a gene symbol or
 * ATAC peak id) and must not be looked up in a GWAS phenocode dictionary.
 */
const hasUnresolvedTraitName = (d: Pick<CSDatum, "dataType" | "trait" | "traitOriginal">): boolean =>
  d.dataType === "GWAS" && d.traitOriginal !== undefined && d.trait === d.traitOriginal;

/** whether a gene view needs the (2 MB) trait_name_mapping dictionary to label all its rows */
export const needsTraitNameMapping = (data: CSDatum[] | undefined): boolean =>
  data !== undefined && data.some(hasUnresolvedTraitName);

/**
 * the QTL context a credible set was called in, from the row's `cell_type` ("<tissue>|<condition>",
 * the same two fields the BFF splits out of the eQTL Catalogue phenotype_string). the condition
 * "naive" is the uninformative default and is dropped, matching the anno tables' dataset label.
 */
const formatCellType = (cellType: string | null | undefined): string => {
  if (!cellType) {
    return "";
  }
  const [tissue, condition] = cellType.split("|");
  const suffix = condition && condition !== "naive" ? `, ${condition.replace(/_/g, " ")}` : "";
  return `${tissue.replace(/_/g, " ")}${suffix}`;
};

/**
 * the upstream identifier worth showing beside a trait name, or undefined when the name says it all.
 * an eQTL Catalogue row is one QTD sub-dataset — the id is what you look the dataset up by, and the
 * `study` it belongs to (from resource_metadata, when the caller has it) is what names it in prose;
 * an Open Targets trait is a GCST study accession that the resolved display name hides.
 */
export const geneViewTraitCode = (d: CSDatum, study?: string | null): string | undefined => {
  if (d.resource === EQTL_CATALOGUE_DATA_NAME) {
    return study ? `${study} (${d.dataset})` : d.dataset;
  }
  if (d.resource === OPEN_TARGETS_DATA_NAME) {
    return d.traitOriginal;
  }
  return undefined;
};

/**
 * full display name of a credible set's trait. the API stores phenostrings with spaces replaced by
 * underscores ("Dementia_in_Alzheimer_disease"), so they are turned back here; `traitNames` (the
 * /v1/trait_name_mapping dictionary) fills in the phenocodes the API left unresolved. QTL rows get
 * their tissue or assay/platform appended so several rows of the same gene stay distinguishable.
 */
export const geneViewTraitName = (
  d: CSDatum,
  traitNames?: Record<string, string>,
  viewedGene?: string
): string => {
  const resolved = hasUnresolvedTraitName(d) ? traitNames?.[d.traitOriginal!] : undefined;
  // only the API's name is underscore-encoded; dictionary values are already spaced
  const name = resolved ?? d.trait.replace(/_/g, " ");

  let context = "";
  if (d.resource === EQTL_CATALOGUE_DATA_NAME) {
    // every eQTL Catalogue dataset is one tissue/condition of one study, and the QTD dataset id says
    // nothing; the tissue is what tells the many same-gene rows apart (the study is shown separately,
    // in place of the resource label)
    context = formatCellType(d.cellType);
  } else if (d.dataType === "pQTL") {
    // FinnGen carries its platform inline in the dataset id (FinnGen_Olink, FinnGen_Olink_5K);
    // UKB-PPP is the Olink 3K panel. kept consistent with the anno tables' datasetDisplayName.
    context =
      d.resource === "FinnGen_pQTL"
        ? d.dataset.replace(/^FinnGen_/, "").replace(/_/g, " ")
        : "Olink 3K";
  } else if (d.dataType === "eQTL" && d.resource === "FinnGen_eQTL") {
    // the single-cell datasets fine-map every cell type under one dataset id, so the cell type — not
    // the assay, which is the same for all of them — is what tells the same gene's rows apart. rows
    // without one fall back to the assay FinnGen carries inline in the dataset id (FinnGen_snRNAseq)
    context =
      formatCellType(d.cellType) || d.dataset.replace(/^FinnGen_/, "").replace(/_/g, " ");
  } else if (d.dataType === "caQTL") {
    // same single-cell split as the eQTLs above, but the trait here is an ATAC peak id: every cell
    // type a peak was fine-mapped in reuses it, so without the cell type the rows are identical
    context = formatCellType(d.cellType);
  }

  // a QTL row's trait is the molecular trait's gene symbol. CisView admits eQTL/pQTL rows only for
  // the gene being viewed, so there the symbol just repeats the page's gene — drop it and keep the
  // tissue/cell type/platform that actually tells those rows apart. sQTL rows carry no such filter
  // (FES's window shows FURIN and MAN2A2 sQTLs), so they keep their symbol: it is the only thing
  // marking them as another gene's signal. dropping it would leave nothing to show when a row has no
  // context either, hence the `context` guard.
  const repeatsViewedGene = d.dataType !== "GWAS" && !!viewedGene && d.trait === viewedGene;
  if (repeatsViewedGene && context) {
    return context;
  }
  return context ? `${name} ${context}` : name;
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

/** map of affected/affecting gene symbol -> the credible sets backing that gene in a list */
export type Gene2CS = { [gene: string]: CSDatum[] };

export interface GeneListFilters {
  maxCsSize: number;
  minLeadMlog10p: number;
  codingOnly: boolean;
}

// the two gene lists share one quality gate: a real lead signal, a non-huge CS, at least one
// variant. codingOnly is applied differently per list (cis: any coding variant; trans: per-variant)
// so it is handled by the callers below, not here.
const passesQualityGate = (d: CSDatum, f: GeneListFilters): boolean =>
  d.mlog10p.some((m) => m >= f.minLeadMlog10p) && d.csSize <= f.maxCsSize && d.variant.length > 0;

/**
 * "Variants in {inputGene} affect these genes" — the cis list.
 *
 * why this shape: `cisData` is the credible sets sitting in the input gene's region. a pQTL CS here
 * means variants in this locus drive some protein's level; that protein's gene is the CS `trait`
 * (the molecular trait symbol). we keep only pQTL CSs that actually contain a variant annotated to
 * the input gene (i.e. the signal really lives in this gene), then group them by the affected gene
 * = `trait`. each (trait, CS) pair is counted once even if several of the CS's variants map to the
 * input gene.
 */
export const buildAffectedGeneList = (
  cisData: CSDatum[],
  inputGene: string,
  filters: GeneListFilters
): Gene2CS => {
  const inputGeneLc = inputGene.toLowerCase();
  const seen = new Set<string>();
  const gene2cs: Gene2CS = {};
  for (const d of cisData) {
    if (d.dataType !== "pQTL" || !passesQualityGate(d, filters)) continue;
    if (filters.codingOnly && !d.isCoding.some((c) => c)) continue;
    if (!d.gene.some((g) => g.toLowerCase() === inputGeneLc)) continue;
    const key = `${d.trait}|${d.traitCSId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (gene2cs[d.trait] ??= []).push(d);
  }
  return gene2cs;
};

/**
 * "Variants in these genes affect {inputGene}" — the trans list.
 *
 * why this shape: `transData` is the credible sets where the input gene IS the molecular trait
 * (pQTL on its protein), so its member variants can live in other genes' loci. we group each pQTL
 * CS under every gene its variants are annotated to (excluding the "NA" placeholder), i.e. the loci
 * whose variants affect the input gene. codingOnly here filters per-variant: a gene qualifies only
 * via a coding variant. each (gene, CS) pair is counted once.
 */
export const buildAffectingGeneList = (
  transData: CSDatum[],
  filters: GeneListFilters
): Gene2CS => {
  const seen = new Set<string>();
  const gene2cs: Gene2CS = {};
  for (const d of transData) {
    if (d.dataType !== "pQTL" || !passesQualityGate(d, filters)) continue;
    d.gene.forEach((gene, i) => {
      if (gene === "NA" || (filters.codingOnly && !d.isCoding[i])) return;
      const key = `${gene}|${d.traitCSId}`;
      if (seen.has(key)) return;
      seen.add(key);
      (gene2cs[gene] ??= []).push(d);
    });
  }
  return gene2cs;
};
