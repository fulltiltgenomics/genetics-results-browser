import { MRT_ColumnDef } from "material-react-table";
import { Box, IconButton, Tooltip } from "@mui/material";
import ChatIcon from "@mui/icons-material/ChatBubbleOutline";
import {
  VariantResult,
  GnomadFreq,
  GnomadPop,
  CredibleSetMembership,
} from "../../../types/types.normalized";
import { cleanConsequence, pValRepr, formatTissue } from "../utils/tableutil";
import { UpOrDownIcon } from "../UpDownIcons";
import { DataTypeIcon } from "../DataTypeIcon";
import { GnomadAfTooltip } from "../../tooltips/GnomadAfTooltip";
import { GnomadConsequenceTooltip } from "../../tooltips/GnomadConsequenceTooltip";
import GeneTooltip from "../../tooltips/GeneToolTip";
import { PhenotypeTooltip } from "../../tooltips/PhenotypeTooltip";

/**
 * Columns for the credible-set-native main variant table (refactor.md §4).
 * Reads the new VariantResult shape (annotation + gnomad + filtered credibleSets) instead of the
 * legacy assoc/finemapped split. Trait counts come from credible-set membership, not p-filtered
 * associations.
 */

/** gnomAD AF for the selected population (undefined = overall). guards against missing data. */
export const gnomadAf = (gnomad: GnomadFreq | undefined, pop: string | undefined): number | null => {
  if (!gnomad) return null;
  if (pop === undefined) return gnomad.afOverall;
  return gnomad.byPop[pop as GnomadPop] ?? null;
};

/** format an AF (or a dash when missing) — credible-set CS arrays may carry NaN/null. */
export const afRepr = (af: number | null): string => {
  if (af === null || Number.isNaN(af)) return "-";
  if (af === 0) return "0";
  if (af < 0.001) return af.toExponential(2);
  return af.toPrecision(2);
};

/**
 * The "top association" for a variant: the (already stage-2 filtered) credible-set membership with
 * the largest mlog10p, i.e. the most significant trait. mlog10p can be null (some open_targets rows)
 * — those rank to the bottom. Returns undefined when the variant has no credible sets after filtering.
 */
const topCredibleSet = (row: VariantResult): CredibleSetMembership | undefined => {
  let best: CredibleSetMembership | undefined;
  let bestM = Number.NEGATIVE_INFINITY;
  for (const cs of row.credibleSets) {
    const m = cs.mlog10p ?? Number.NEGATIVE_INFINITY;
    if (best === undefined || m > bestM) {
      best = cs;
      bestM = m;
    }
  }
  return best;
};

const topMlog10p = (row: VariantResult): number =>
  topCredibleSet(row)?.mlog10p ?? Number.NEGATIVE_INFINITY;
const topBeta = (row: VariantResult): number =>
  topCredibleSet(row)?.beta ?? Number.NEGATIVE_INFINITY;

// "top association" label: resolved trait name, with the caQTL cell type (whose p-value/beta are
// shown) appended in parens after the peak.
const topAssocLabel = (
  cs: CredibleSetMembership,
  traitName: (resource: string, trait: string) => string
): string => {
  const name = traitName(cs.resource, cs.trait);
  return cs.dataType === "caQTL" && cs.cellType ? `${name} (${formatTissue(cs.cellType)})` : name;
};

/**
 * Count distinct traits (resource|trait) by direction of effect, mirroring the legacy traits up/down
 * columns. Each trait's direction is taken from its most significant (max mlog10p) credible set so a
 * trait counts once, even when the variant is in several of its credible sets.
 */
const traitDirectionCounts = (row: VariantResult): { up: number; down: number } => {
  const repByTrait = new Map<string, CredibleSetMembership>();
  for (const cs of row.credibleSets) {
    const key = `${cs.resource}|${cs.trait}`;
    const cur = repByTrait.get(key);
    if (!cur || (cs.mlog10p ?? Number.NEGATIVE_INFINITY) > (cur.mlog10p ?? Number.NEGATIVE_INFINITY)) {
      repByTrait.set(key, cs);
    }
  }
  let up = 0;
  let down = 0;
  for (const cs of repByTrait.values()) {
    if (cs.beta > 0) up += 1;
    else if (cs.beta < 0) down += 1;
  }
  return { up, down };
};

export const getVariantMainTableColumnsNormalized = (
  selectedPopulation: string | undefined,
  showTraitCounts: boolean,
  hasBetas: boolean,
  hasCustomValues: boolean,
  onAskAssistant?: (row: VariantResult) => void,
  // resolve a credible set's resource+trait to a human-readable name (falls back to the raw trait)
  traitName: (resource: string, trait: string) => string = (_r, t) => t
): MRT_ColumnDef<VariantResult>[] => {
  let cols: MRT_ColumnDef<VariantResult>[] = [
    {
      accessorKey: "variant",
      header: "variant",
      id: "variant",
      filterFn: "contains",
      sortingFn: "variantSort",
      muiFilterTextFieldProps: { placeholder: "variant" },
      size: 150,
      // speech-bubble hand-off to the assistant, inline in front of the variant id (replaces the
      // former row-actions column). seeds the chat with a variant-context prompt and routes to /chat.
      Cell: ({ row }) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: "2px" }}>
          {onAskAssistant && (
            <Tooltip title="Ask the assistant about this variant">
              <IconButton
                size="small"
                sx={{ p: "2px" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onAskAssistant(row.original);
                }}>
                <ChatIcon sx={{ fontSize: "0.9rem" }} />
              </IconButton>
            </Tooltip>
          )}
          <span>{row.original.variant}</span>
        </Box>
      ),
    },
    {
      accessorFn: (row) => row.annotation.rsid ?? "",
      id: "rsid",
      header: "rsid",
      filterFn: "contains",
      muiFilterTextFieldProps: { placeholder: "rsid" },
      size: 90,
    },
    {
      accessorFn: (row) => afRepr(gnomadAf(row.gnomad, selectedPopulation)),
      id: "gnomad_af",
      header: `${selectedPopulation || "global"} AF`,
      filterFn: "contains",
      muiFilterTextFieldProps: { placeholder: "filter" },
      sortingFn: (a, b) => {
        const av = gnomadAf(a.original.gnomad, selectedPopulation);
        const bv = gnomadAf(b.original.gnomad, selectedPopulation);
        // sort missing/NaN to the bottom
        const an = av === null || Number.isNaN(av) ? Number.POSITIVE_INFINITY : av;
        const bn = bv === null || Number.isNaN(bv) ? Number.POSITIVE_INFINITY : bv;
        return an - bn;
      },
      sortDescFirst: false,
      size: 80,
      // hover: per-population gnomAD AF log plot + gnomAD link (restored from the legacy table)
      Cell: ({ row }) => {
        const text = afRepr(gnomadAf(row.original.gnomad, selectedPopulation));
        if (!row.original.gnomad) return text;
        return (
          <GnomadAfTooltip variant={row.original.variant} gnomad={row.original.gnomad}>
            {text}
          </GnomadAfTooltip>
        );
      },
    },
    {
      accessorFn: (row) => cleanConsequence(row.annotation.consequence ?? ""),
      id: "consequence",
      header: "most severe",
      filterFn: "contains",
      muiFilterTextFieldProps: { placeholder: "consequence" },
      size: 120,
      // hover: all gnomAD VEP consequences and their genes (the column shows the most severe one)
      Cell: ({ row }) => (
        <GnomadConsequenceTooltip consequences={row.original.gnomad?.consequences}>
          {cleanConsequence(row.original.annotation.consequence ?? "")}
        </GnomadConsequenceTooltip>
      ),
    },
    {
      accessorFn: (row) => row.annotation.gene ?? "",
      id: "gene",
      header: "most severe gene",
      filterFn: "contains",
      muiFilterTextFieldProps: { placeholder: "gene" },
      size: 100,
      // hover: gene summary fetched on demand from mygene.info (restored from the legacy table)
      Cell: ({ row }) => {
        const gene = row.original.annotation.gene;
        if (!gene) return "";
        return <GeneTooltip geneName={gene} content={<span>{gene}</span>} />;
      },
    },
  ];

  if (showTraitCounts) {
    cols = cols.concat([
      {
        // distinct credible-set traits the variant is a member of (after stage-2 filtering)
        accessorFn: (row) => new Set(row.credibleSets.map((cs) => `${cs.resource}|${cs.trait}`)).size,
        id: "trait_count",
        header: "traits",
        filterFn: "greaterThan",
        muiFilterTextFieldProps: { placeholder: "filter" },
        sortingFn: "alphanumeric",
        sortDescFirst: true,
        size: 70,
      },
      {
        // distinct traits whose representative (most significant) credible set has a positive beta
        accessorFn: (row) => traitDirectionCounts(row).up,
        id: "traits_up",
        header: "traits up",
        Header: () => (
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            traits
            <UpOrDownIcon value={1} />
          </span>
        ),
        filterFn: "greaterThan",
        muiFilterTextFieldProps: { placeholder: "filter" },
        sortingFn: "alphanumeric",
        sortDescFirst: true,
        size: 70,
      },
      {
        // distinct traits whose representative credible set has a negative beta
        accessorFn: (row) => traitDirectionCounts(row).down,
        id: "traits_down",
        header: "traits down",
        Header: () => (
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            traits
            <UpOrDownIcon value={-1} />
          </span>
        ),
        filterFn: "greaterThan",
        muiFilterTextFieldProps: { placeholder: "filter" },
        sortingFn: "alphanumeric",
        sortDescFirst: true,
        size: 70,
      },
    ]);
  }

  // top association (most significant credible set) + its p-value and beta, mirroring the legacy
  // variant table's "top association"/p-value/beta columns — now sourced from credible-set membership.
  cols = cols.concat([
    {
      accessorFn: (row) => {
        const cs = topCredibleSet(row);
        return cs ? topAssocLabel(cs, traitName) : "";
      },
      id: "top_assoc",
      header: "top association",
      filterFn: "contains",
      enableSorting: false,
      muiFilterTextFieldProps: { placeholder: "top association" },
      size: 200,
      // data-type letter badge (e.g. [G] GWAS) in front of the resolved trait name; caQTL shows the
      // cell type of the displayed p-value/beta in parens after the peak.
      Cell: ({ row }) => {
        const cs = topCredibleSet(row.original);
        if (!cs) return "";
        return (
          <Box sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <DataTypeIcon dataType={cs.dataType} />
            <PhenotypeTooltip
              resource={cs.resource}
              phenocode={cs.traitOriginal}
              phenostring={traitName(cs.resource, cs.trait)}
              dataType={cs.dataType}
              dataset={cs.dataset}
              content={
                <span style={{ textDecoration: "underline dotted", cursor: "help" }}>
                  {topAssocLabel(cs, traitName)}
                </span>
              }
            />
          </Box>
        );
      },
    },
    {
      accessorFn: (row) => topMlog10p(row),
      id: "top_pval",
      header: "p-value",
      enableColumnFilter: false,
      sortingFn: (a, b) => topMlog10p(a.original) - topMlog10p(b.original),
      sortDescFirst: true,
      size: 70,
      Cell: ({ row }) => {
        const cs = topCredibleSet(row.original);
        if (!cs || cs.mlog10p === null) return "";
        return <span>{pValRepr(cs.mlog10p)}</span>;
      },
    },
    {
      accessorFn: (row) => topBeta(row),
      id: "top_beta",
      header: "beta",
      enableColumnFilter: false,
      sortingFn: (a, b) => topBeta(a.original) - topBeta(b.original),
      sortDescFirst: true,
      size: 60,
      Cell: ({ row }) => {
        const cs = topCredibleSet(row.original);
        if (!cs) return "";
        return (
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <UpOrDownIcon value={cs.beta} />
            <span>{cs.beta ? cs.beta.toFixed(2) : ""}</span>
          </Box>
        );
      },
    },
  ]);

  if (hasBetas) {
    cols = cols.concat([
      {
        accessorFn: (row) => (row.beta !== undefined ? row.beta.toFixed(2) : ""),
        header: "my beta",
        id: "beta",
        filterFn: "contains",
        muiFilterTextFieldProps: { placeholder: "my beta" },
        size: 60,
      },
    ]);
  }

  if (hasCustomValues) {
    cols = cols.concat([
      {
        accessorFn: (row) => row.value ?? "",
        header: "my value",
        id: "value",
        filterFn: "contains",
        muiFilterTextFieldProps: { placeholder: "my value" },
        size: 60,
      },
    ]);
  }

  return cols;
};
