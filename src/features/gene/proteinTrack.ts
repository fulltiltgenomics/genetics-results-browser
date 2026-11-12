import type { CSDatum } from "@/types/types.gene";
import { DEFAULT_MAX_CS_SIZE, DEFAULT_MIN_LEAD_MLOG10P, passesSetFilters } from "@/store/geneCS";

/**
 * Pure shaping for the gene page's protein section: what the track draws and how a position
 * on it maps to a residue of one model file. Nothing here touches React, the network or Mol*.
 *
 * Two numberings meet here. A protein position counts along the UniProt sequence; a file
 * position is the residue number written in one model file, which is what the structure
 * viewer addresses. They coincide for a protein with one model file and differ in every
 * window after the first of a protein that is split across several.
 */

export interface ProteinModel {
  modelFileId: string;
  accession: string;
  /** every gene the release lists this accession under, the page's own gene among them */
  geneNames: string[];
  sourceLabel: string;
  windowIndex: number;
  nWindows: number;
  proteinStart: number;
  proteinEnd: number;
  ownedStart: number;
  ownedEnd: number;
}

export interface ResidueRow {
  accession: string;
  modelFileId: string;
  filePosition: number;
  proteinPosition: number;
  residue: string;
  isOwner: boolean;
  plddt: number;
}

export interface FeatureRow {
  accession: string;
  source: string;
  featureType: string;
  start: number;
  end: number;
  description: string | null;
  evidenceTier: string | null;
}

export interface VariantMapRow {
  variant: string;
  accession: string;
  /** the gene the map files the row under, which for a shared protein need not be the page's */
  geneName: string;
  aaPos: number;
  aaRef: string;
  aaAlt: string;
  modelFileId: string;
  filePosition: number;
}

export interface ExomeVariantRow {
  variant: string;
  gene: string;
  annotation: string;
  dataset: string;
  trait: string;
  mlog10p: number | null;
}

export type VariantSource = "cs" | "exome";

export interface CandidateVariant {
  variant: string;
  sources: VariantSource[];
  /** one line per source saying what the page knows about the variant there */
  notes: string[];
  /** a note carries the pseudo mark, which the reader is owed the explanation of */
  pseudo: boolean;
  /** in credible sets, and every one of them is a pseudo credible set */
  pseudoOnly: boolean;
}

export interface PlacedVariant extends CandidateVariant {
  aaPos: number;
  label: string;
  modelFileId: string;
  filePosition: number;
}

export interface Placement {
  placed: PlacedVariant[];
  /** candidates the map serves no row for at all */
  noRow: number;
  /** candidates with no row on the accession shown and one on another accession of this gene */
  onOtherAccession: number;
  /** candidates whose rows are all on proteins that are not this gene's */
  onOtherGene: number;
  /** the genes the map files those rows under */
  otherGenes: string[];
  total: number;
}

const na = (v: string | undefined): string | null => (v == null || v === "" || v === "NA" ? null : v);

/** header-keyed rows of a results-api TSV body; a ragged or empty body gives no rows */
export const parseTsv = (text: string): Record<string, string>[] => {
  const lines = text.split("\n");
  const header = lines[0]?.replace(/\r$/, "").split("\t") ?? [];
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = lines[i].replace(/\r$/, "").split("\t");
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) row[header[c]] = cells[c];
    rows.push(row);
  }
  return rows;
};

export const parseResidues = (text: string): ResidueRow[] =>
  parseTsv(text)
    .map((r) => ({
      accession: r.accession,
      modelFileId: r.model_file_id,
      filePosition: Number(r.file_position),
      proteinPosition: Number(r.protein_position),
      residue: r.residue,
      isOwner: r.is_owner === "true",
      plddt: Number(r.plddt),
    }))
    .filter((r) => Number.isInteger(r.filePosition) && Number.isInteger(r.proteinPosition));

export const parseFeatures = (text: string): FeatureRow[] =>
  parseTsv(text)
    .map((r) => ({
      accession: r.accession,
      source: r.source,
      featureType: r.feature_type,
      start: Number(r.start),
      end: Number(r.end),
      description: na(r.description),
      evidenceTier: na(r.evidence_tier),
    }))
    .filter((f) => Number.isFinite(f.start) && Number.isFinite(f.end));

export const parseExome = (text: string): ExomeVariantRow[] =>
  parseTsv(text).map((r) => ({
    variant: `${r.chr}:${r.pos}:${r.ref}:${r.alt}`,
    gene: r.gene,
    annotation: r.annotation,
    dataset: r.dataset,
    trait: r.trait,
    mlog10p: na(r.mlog10p) === null ? null : Number(r.mlog10p),
  }));

/** accessions in the order the release lists them */
export const accessionsOf = (models: ProteinModel[]): string[] => [
  ...new Set(models.map((m) => m.accession)),
];

export const windowsOf = (models: ProteinModel[], accession: string): ProteinModel[] =>
  models.filter((m) => m.accession === accession).sort((a, b) => a.windowIndex - b.windowIndex);

/**
 * The window whose model file a residue is shown in: the one that owns it. Windows overlap,
 * so a position can sit in two files; exactly one owns it, and that is the one whose
 * neighbourhood around the residue is most complete.
 */
export const windowOwning = (windows: ProteinModel[], position: number): ProteinModel | undefined =>
  windows.find((w) => position >= w.ownedStart && position <= w.ownedEnd) ??
  windows.find((w) => position >= w.proteinStart && position <= w.proteinEnd);

/** the protein end to end, each position once: the owner rows of one accession */
export const ownerRows = (residues: ResidueRow[], accession: string): ResidueRow[] => {
  const byPosition = new Map<number, ResidueRow>();
  for (const r of residues) {
    if (r.accession === accession && r.isOwner && !byPosition.has(r.proteinPosition)) {
      byPosition.set(r.proteinPosition, r);
    }
  }
  return [...byPosition.values()].sort((a, b) => a.proteinPosition - b.proteinPosition);
};

export interface ModelIndex {
  byProtein: Map<number, ResidueRow>;
  byFile: Map<number, ResidueRow>;
}

/** every residue one model file holds, owned or not, addressable in either numbering */
export const indexModel = (residues: ResidueRow[], modelFileId: string): ModelIndex => {
  const index: ModelIndex = { byProtein: new Map(), byFile: new Map() };
  for (const r of residues) {
    if (r.modelFileId !== modelFileId) continue;
    index.byProtein.set(r.proteinPosition, r);
    index.byFile.set(r.filePosition, r);
  }
  return index;
};

/** file positions of a protein range in one model, and how much of the range that model lacks */
export const filePositionsIn = (
  index: ModelIndex,
  start: number,
  end: number,
): { positions: number[]; outside: number } => {
  const positions: number[] = [];
  for (let p = start; p <= end; p++) {
    const row = index.byProtein.get(p);
    if (row) positions.push(row.filePosition);
  }
  return { positions, outside: end - start + 1 - positions.length };
};

const isMissense = (annotation: string): boolean => /^missense(_variant)?$/.test(annotation);
const sameGene = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * The credible sets that count on the track: the ones the Credible sets tab shows with its
 * controls where they start. Its resource switches are not followed.
 */
export const trackCredibleSets = (gene: string, credibleSets: CSDatum[]): CSDatum[] =>
  credibleSets.filter((d) =>
    passesSetFilters(d, gene, { maxCsSize: DEFAULT_MAX_CS_SIZE, minLeadMlog10p: DEFAULT_MIN_LEAD_MLOG10P }),
  );

interface SetTally {
  sets: Set<string>;
  maxPip: number;
}

/**
 * The variants the page itself calls missense in this gene, from the two sets it holds.
 * These are only the candidates: whether and where one lands on the protein is the
 * release's variant-to-residue map's answer, not the page's annotation.
 *
 * `pseudoResources` are the resources whose credible sets are pseudo: counted apart, and
 * their PIP never written without the mark the rest of the app puts on it.
 */
export const missenseCandidates = (
  gene: string,
  credibleSets: CSDatum[],
  exome: ExomeVariantRow[],
  pseudoResources: ReadonlySet<string> = new Set(),
): CandidateVariant[] => {
  const cs = new Map<string, { fine: SetTally; pseudo: SetTally }>();
  for (const set of credibleSets) {
    set.variant.forEach((variant, i) => {
      if (!sameGene(set.gene[i], gene) || !isMissense(set.consequence[i])) return;
      const seen = cs.get(variant) ?? {
        fine: { sets: new Set<string>(), maxPip: 0 },
        pseudo: { sets: new Set<string>(), maxPip: 0 },
      };
      const tally = pseudoResources.has(set.resource) ? seen.pseudo : seen.fine;
      tally.sets.add(set.traitCSId);
      tally.maxPip = Math.max(tally.maxPip, set.pip[i] ?? 0);
      cs.set(variant, seen);
    });
  }
  const ex = new Map<string, { n: number; top: ExomeVariantRow }>();
  for (const row of exome) {
    if (!sameGene(row.gene, gene) || !isMissense(row.annotation)) continue;
    const seen = ex.get(row.variant);
    if (!seen) ex.set(row.variant, { n: 1, top: row });
    else {
      seen.n += 1;
      if ((row.mlog10p ?? -Infinity) > (seen.top.mlog10p ?? -Infinity)) seen.top = row;
    }
  }
  return [...new Set([...cs.keys(), ...ex.keys()])].map((variant) => {
    const sources: VariantSource[] = [];
    const notes: string[] = [];
    const inCs = cs.get(variant);
    if (inCs) {
      sources.push("cs");
      if (inCs.fine.sets.size > 0) {
        notes.push(`in ${plural(inCs.fine.sets.size, "credible set")}, highest PIP ${inCs.fine.maxPip.toPrecision(2)}`);
      }
      if (inCs.pseudo.sets.size > 0) {
        notes.push(
          `in ${plural(inCs.pseudo.sets.size, "pseudo credible set")}*, highest PIP* ${inCs.pseudo.maxPip.toPrecision(2)}`,
        );
      }
    }
    const inExome = ex.get(variant);
    if (inExome) {
      sources.push("exome");
      const p = inExome.top.mlog10p;
      notes.push(
        `${plural(inExome.n, "exome association")}, strongest ${inExome.top.trait}` +
          (p === null ? "" : ` (-log10 p ${p.toPrecision(3)})`),
      );
    }
    const pseudo = !!inCs && inCs.pseudo.sets.size > 0;
    return { variant, sources, notes, pseudo, pseudoOnly: pseudo && inCs.fine.sets.size === 0 };
  });
};

/**
 * `geneAccessions` are the accessions the release lists under the page's gene: a map row on
 * any other accession is another gene's protein, whatever gene name the row carries.
 */
export const placeVariants = (
  candidates: CandidateVariant[],
  mapRows: VariantMapRow[],
  accession: string,
  geneAccessions: string[],
): Placement => {
  const rowsOf = new Map<string, VariantMapRow[]>();
  for (const row of mapRows) rowsOf.set(row.variant, [...(rowsOf.get(row.variant) ?? []), row]);
  const placed: PlacedVariant[] = [];
  const otherGenes = new Set<string>();
  let noRow = 0;
  let onOtherAccession = 0;
  let onOtherGene = 0;
  for (const candidate of candidates) {
    const rows = rowsOf.get(candidate.variant);
    const row = rows?.find((r) => r.accession === accession);
    if (!rows) noRow += 1;
    else if (row) {
      placed.push({
        ...candidate,
        aaPos: row.aaPos,
        label: `p.${row.aaRef}${row.aaPos}${row.aaAlt}`,
        modelFileId: row.modelFileId,
        filePosition: row.filePosition,
      });
    } else if (rows.some((r) => geneAccessions.includes(r.accession))) onOtherAccession += 1;
    else {
      onOtherGene += 1;
      rows.forEach((r) => otherGenes.add(r.geneName || r.accession));
    }
  }
  placed.sort((a, b) => a.aaPos - b.aaPos);
  return {
    placed,
    noRow,
    onOtherAccession,
    onOtherGene,
    otherGenes: [...otherGenes].sort(),
    total: candidates.length,
  };
};

export interface VariantMarker {
  aaPos: number;
  variants: PlacedVariant[];
}

/** one marker per residue of one source's row: variants at the same residue share it */
export const markersOf = (placed: PlacedVariant[], source: VariantSource): VariantMarker[] => {
  const byResidue = new Map<number, PlacedVariant[]>();
  for (const v of placed) {
    if (v.sources.includes(source)) byResidue.set(v.aaPos, [...(byResidue.get(v.aaPos) ?? []), v]);
  }
  return [...byResidue.entries()]
    .map(([aaPos, variants]) => ({ aaPos, variants }))
    .sort((a, b) => a.aaPos - b.aaPos);
};

// AlphaFold's own confidence bands and colours, as the structure's cartoon is coloured
export const PLDDT_BANDS = [
  { name: "very high (> 90)", min: 90, colour: "#0053d6" },
  { name: "confident (70 – 90)", min: 70, colour: "#65cbf3" },
  { name: "low (50 – 70)", min: 50, colour: "#ffdb13" },
  { name: "very low (≤ 50)", min: -Infinity, colour: "#ff7d45" },
] as const;

export const plddtBand = (plddt: number): number => {
  const band = PLDDT_BANDS.findIndex((b) => plddt > b.min);
  return band === -1 ? PLDDT_BANDS.length - 1 : band;
};

export interface PlddtRun {
  start: number;
  end: number;
  band: number;
}

/**
 * The pLDDT strip as runs of one band. The domain is cut into at most `bins` equal slices
 * and neighbours in the same band are merged: a 34,350-residue protein draws as a few hundred
 * rectangles instead of one per residue. A slice takes the lowest band any of its residues
 * has: a mean would draw a band none of them is in and hide a short low-confidence stretch.
 */
export const plddtRuns = (owners: ResidueRow[], start: number, end: number, bins: number): PlddtRun[] => {
  const span = end - start + 1;
  const n = Math.max(1, Math.min(Math.floor(bins), span));
  // band + 1 of the least confident residue seen, 0 for a slice with none
  const lowest = new Uint8Array(n);
  for (const r of owners) {
    if (r.proteinPosition < start || r.proteinPosition > end || !Number.isFinite(r.plddt)) continue;
    const bin = Math.min(n - 1, Math.floor(((r.proteinPosition - start) * n) / span));
    lowest[bin] = Math.max(lowest[bin], plddtBand(r.plddt) + 1);
  }
  const runs: PlddtRun[] = [];
  for (let bin = 0; bin < n; bin++) {
    if (lowest[bin] === 0) continue;
    const band = lowest[bin] - 1;
    const from = start + Math.ceil((bin * span) / n);
    const to = start + Math.ceil(((bin + 1) * span) / n) - 1;
    const last = runs[runs.length - 1];
    if (last && last.band === band && last.end === from - 1) last.end = to;
    else runs.push({ start: from, end: to, band });
  }
  return runs;
};

export interface FeatureTrackRow {
  key: string;
  source: string;
  featureType: string;
  features: FeatureRow[];
}

// domain-scale annotation first, then secondary structure, then single sites; a type not
// named here sorts after these, alphabetically
const TYPE_ORDER = ["TED domain", "Chain", "Domain", "Region", "Repeat", "Helix", "Beta strand", "Turn"];
const typeRank = (type: string): number => {
  const i = TYPE_ORDER.indexOf(type);
  return i === -1 ? TYPE_ORDER.length : i;
};

/** one row per source and feature type of one accession */
export const featureTrackRows = (features: FeatureRow[], accession: string): FeatureTrackRow[] => {
  const rows = new Map<string, FeatureTrackRow>();
  for (const f of features) {
    if (f.accession !== accession) continue;
    const key = `${f.source}|${f.featureType}`;
    const row = rows.get(key) ?? { key, source: f.source, featureType: f.featureType, features: [] };
    row.features.push(f);
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, features: [...row.features].sort((a, b) => a.start - b.start) }))
    .sort(
      (a, b) =>
        typeRank(a.featureType) - typeRank(b.featureType) ||
        a.featureType.localeCompare(b.featureType) ||
        a.source.localeCompare(b.source),
    );
};
