import { MRT_ColumnDef } from "material-react-table";
import { VariantResult, GnomadFreq, GnomadPop } from "../../../types/types.normalized";
import { cleanConsequence } from "../utils/tableutil";

/**
 * Columns for the credible-set-native main variant table (refactor.md §4).
 * Reads the new VariantResult shape (annotation + gnomad + filtered credibleSets) instead of the
 * legacy assoc/finemapped split. Trait counts come from credible-set membership, not p-filtered
 * associations.
 */

/** gnomAD AF for the selected population (undefined = overall). guards against missing data. */
const gnomadAf = (gnomad: GnomadFreq | undefined, pop: string | undefined): number | null => {
  if (!gnomad) return null;
  if (pop === undefined) return gnomad.afOverall;
  return gnomad.byPop[pop as GnomadPop] ?? null;
};

/** format an AF (or a dash when missing) — credible-set CS arrays may carry NaN/null. */
const afRepr = (af: number | null): string => {
  if (af === null || Number.isNaN(af)) return "-";
  if (af === 0) return "0";
  if (af < 0.001) return af.toExponential(2);
  return af.toPrecision(2);
};

export const getVariantMainTableColumnsNormalized = (
  selectedPopulation: string | undefined,
  showTraitCounts: boolean,
  hasBetas: boolean,
  hasCustomValues: boolean
): MRT_ColumnDef<VariantResult>[] => {
  let cols: MRT_ColumnDef<VariantResult>[] = [
    {
      accessorKey: "variant",
      header: "variant",
      id: "variant",
      filterFn: "contains",
      sortingFn: "variantSort",
      muiFilterTextFieldProps: { placeholder: "variant" },
      size: 110,
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
    },
    {
      accessorFn: (row) => cleanConsequence(row.annotation.consequence ?? ""),
      id: "consequence",
      header: "most severe",
      filterFn: "contains",
      muiFilterTextFieldProps: { placeholder: "consequence" },
      size: 120,
    },
    {
      accessorFn: (row) => row.annotation.gene ?? "",
      id: "gene",
      header: "most severe gene",
      filterFn: "contains",
      muiFilterTextFieldProps: { placeholder: "gene" },
      size: 100,
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
        accessorFn: (row) => row.credibleSets.length,
        id: "cs_count",
        header: "credible sets",
        filterFn: "greaterThan",
        muiFilterTextFieldProps: { placeholder: "filter" },
        sortingFn: "alphanumeric",
        sortDescFirst: true,
        size: 90,
      },
    ]);
  }

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
