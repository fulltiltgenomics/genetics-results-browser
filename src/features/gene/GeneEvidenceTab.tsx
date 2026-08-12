import { useMemo, useState } from "react";
import {
  Box,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { MaterialReactTable, MRT_Cell, MRT_ColumnDef, MRT_RowData } from "material-react-table";
import {
  useGeneBurden,
  useGeneDisease,
  useGeneExpression,
} from "@/store/serverQuery";
import {
  GeneBurdenRow,
  GeneDiseaseRow,
  GeneExpressionRow,
} from "@/types/types.normalized";
import { naInfSort } from "../table/utils/sorting";
import { datasetDisplayName, formatTraitName, pValRepr } from "../table/utils/tableutil";
import GeneExpressionPlot from "./GeneExpressionPlot";
import { gtexTissueLabel } from "./gtexTissues";
import { hpaLevelLabel, hpaLevelRank, hpaTissueLabel } from "./hpa";

/**
 * Gene evidence tab (refactor.md §6). Surfaces gene-level evidence that is relevant to the gene but
 * not part of the credible-set visualization: gene burden, expression levels, and Mendelian
 * gene-disease associations. Each section fetches and renders independently so one failing/empty
 * source never blocks the others.
 */

// fixed-precision number cell; renders blank for null/NaN. generic over the row type so it satisfies
// MRT's Cell prop signature for any of the three evidence tables.
const numCell =
  (precision = 4) =>
  <T extends MRT_RowData>({ cell }: { cell: MRT_Cell<T, unknown> }) => {
    const v = cell.getValue<number | null>();
    return v == null || Number.isNaN(v) ? "" : v.toPrecision(precision);
  };

// thousands-separated integer cell; blank for null
const countCell = <T extends MRT_RowData>({ cell }: { cell: MRT_Cell<T, unknown> }) => {
  const v = cell.getValue<number | null>();
  return v == null ? "" : v.toLocaleString();
};

// burden significance cut, as -log10(p): the threshold genebass is pre-filtered at upstream
const BURDEN_MLOG10P_MIN = 4;

// shared by both expression tables, which carry the same dataset ids
const datasetColumn: MRT_ColumnDef<GeneExpressionRow> = {
  accessorKey: "dataset",
  header: "dataset",
  id: "dataset",
  size: 120,
  Cell: ({ cell }) => datasetDisplayName(cell.getValue<string>()),
};

/** small per-section wrapper handling loading / error / empty states consistently. */
const Section = ({
  title,
  isPending,
  isError,
  error,
  isEmpty,
  emptyText,
  children,
}: {
  title: string;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  isEmpty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) => (
  <Box sx={{ mb: 4 }}>
    <Typography variant="h6" sx={{ mb: 1 }}>
      {title}
    </Typography>
    {isPending ? (
      <Box display="flex" alignItems="center" gap={1}>
        <CircularProgress size={18} />
        <Typography variant="body2">loading…</Typography>
      </Box>
    ) : isError ? (
      <Typography color="error" variant="body2">
        failed to load: {error?.message}
      </Typography>
    ) : isEmpty ? (
      <Typography variant="body2" color="text.secondary">
        {emptyText}
      </Typography>
    ) : (
      children
    )}
  </Box>
);

const GeneEvidenceTab = ({ geneName }: { geneName: string }) => {
  const burden = useGeneBurden(geneName);
  const expression = useGeneExpression(geneName);
  const disease = useGeneDisease(geneName);
  const [gtexView, setGtexView] = useState<"plot" | "table">("plot");

  // genebass reaches the API already cut at mlog10p > 4 — its unfiltered export is 343M rows, so no
  // gene-indexed copy of it exists — while SCHEMA, BipEx and IBD arrive complete. Applying the same
  // cut to all of them makes one row mean the same thing whichever dataset it came from.
  const burdenRows = useMemo(
    () => (burden.data ?? []).filter((r) => (r.mlog10pBurden ?? -Infinity) > BURDEN_MLOG10P_MIN),
    [burden.data]
  );

  // the endpoint returns every expression resource in one response; they are split here because GTEx
  // (numeric median TPM) and HPA (immunohistochemistry) are not comparable in one table or plot
  const gtexRows = useMemo(
    () => (expression.data ?? []).filter((r) => r.resource === "gtex"),
    [expression.data]
  );
  const hpaRows = useMemo(
    () => (expression.data ?? []).filter((r) => r.resource === "hpa"),
    [expression.data]
  );
  const gtexVersion = gtexRows[0]?.version ?? "";

  const burdenColumns = useMemo<MRT_ColumnDef<GeneBurdenRow>[]>(
    () => [
      {
        accessorKey: "trait",
        header: "trait",
        id: "trait",
        size: 200,
        Cell: ({ cell }) => formatTraitName(cell.getValue<string>() ?? ""),
      },
      {
        accessorKey: "dataset",
        header: "dataset",
        id: "dataset",
        size: 110,
        Cell: ({ cell }) => datasetDisplayName(cell.getValue<string>() ?? ""),
      },
      { accessorKey: "annotation", header: "annotation", id: "annotation", size: 140 },
      {
        // sorted on mlog10p, not the rendered p-value: p underflows to 0 below ~1e-308 and every
        // such row would compare equal
        accessorKey: "mlog10pBurden",
        header: "p-value",
        id: "mlog10pBurden",
        sortingFn: naInfSort,
        sortDescFirst: true,
        size: 100,
        Cell: ({ cell }) => {
          const v = cell.getValue<number | null>();
          return v == null || Number.isNaN(v) ? "" : pValRepr(v);
        },
      },
      {
        accessorKey: "beta",
        header: "beta",
        id: "beta",
        sortingFn: naInfSort,
        size: 90,
        Cell: numCell(3),
      },
      {
        accessorKey: "nCases",
        header: "n cases",
        id: "nCases",
        sortingFn: naInfSort,
        size: 90,
        Cell: countCell,
      },
      {
        accessorKey: "nControls",
        header: "n controls",
        id: "nControls",
        sortingFn: naInfSort,
        size: 100,
        Cell: countCell,
      },
    ],
    []
  );

  // GTEx rows are numeric median TPM; HPA rows are categorical immunohistochemistry staining levels,
  // so that table shows the level as served rather than the parsed number
  const gtexColumns = useMemo<MRT_ColumnDef<GeneExpressionRow>[]>(
    () => [
      {
        accessorKey: "tissueCell",
        header: "tissue / cell",
        id: "tissueCell",
        size: 260,
        Cell: ({ cell }) => gtexTissueLabel(cell.getValue<string>()),
      },
      {
        accessorKey: "level",
        header: "median TPM",
        id: "level",
        sortingFn: naInfSort,
        sortDescFirst: true,
        size: 120,
        Cell: numCell(4),
      },
      datasetColumn,
    ],
    []
  );

  const hpaColumns = useMemo<MRT_ColumnDef<GeneExpressionRow>[]>(
    () => [
      {
        accessorKey: "tissueCell",
        header: "tissue / cell",
        id: "tissueCell",
        size: 260,
        Cell: ({ cell }) => hpaTissueLabel(cell.getValue<string>()),
      },
      {
        accessorKey: "levelRaw",
        header: "level",
        id: "levelRaw",
        // staining categories, so ordered by intensity rather than alphabetically
        sortingFn: (a, b) => hpaLevelRank(a.original.levelRaw) - hpaLevelRank(b.original.levelRaw),
        sortDescFirst: true,
        size: 120,
        Cell: ({ cell }) => hpaLevelLabel(cell.getValue<string>()),
      },
      datasetColumn,
    ],
    []
  );

  const diseaseColumns = useMemo<MRT_ColumnDef<GeneDiseaseRow>[]>(
    () => [
      { accessorKey: "diseaseTitle", header: "disease", id: "diseaseTitle", size: 240 },
      { accessorKey: "classification", header: "classification", id: "classification", size: 120 },
      {
        accessorKey: "modeOfInheritance",
        header: "mode of inheritance",
        id: "modeOfInheritance",
        size: 160,
      },
      { accessorKey: "submitter", header: "submitter", id: "submitter", size: 200 },
      { accessorKey: "resource", header: "source", id: "resource", size: 90 },
    ],
    []
  );

  const tableProps = {
    enableTopToolbar: true,
    enableColumnFilters: false,
    enableGlobalFilter: false,
    enableDensityToggle: false,
    muiTableBodyCellProps: { sx: { fontSize: "0.75rem" } },
    sortingFns: { naInfSort },
  } as const;

  return (
    <Box sx={{ p: 2 }}>
      <Typography sx={{ mb: 3 }} variant="body2" color="text.secondary">
        Gene-level evidence for <b>{geneName}</b> beyond the credible-set view: rare-variant burden
        tests, tissue/cell expression, and Mendelian gene-disease associations.
      </Typography>

      <Section
        title="Gene burden"
        isPending={burden.isPending}
        isError={burden.isError}
        error={burden.error}
        isEmpty={burdenRows.length === 0}
        emptyText="no burden results with p < 1e-4 for this gene">
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          associations with p &lt; 1e-4
        </Typography>
        <MaterialReactTable
          {...tableProps}
          data={burdenRows}
          columns={burdenColumns}
          enablePagination={burdenRows.length > 20}
          initialState={{ density: "compact", sorting: [{ id: "mlog10pBurden", desc: true }] }}
        />
      </Section>

      <Section
        title={`Expression (GTEx${gtexVersion ? ` ${gtexVersion}` : ""})`}
        isPending={expression.isPending}
        isError={expression.isError}
        error={expression.error}
        isEmpty={gtexRows.length === 0}
        emptyText="no GTEx expression data for this gene">
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={gtexView}
            onChange={(_e, value) => {
              // exclusive group emits null when the active button is re-clicked; ignore that.
              if (value) setGtexView(value);
            }}
            aria-label="GTEx expression view">
            <ToggleButton value="plot" aria-label="plot">
              plot
            </ToggleButton>
            <ToggleButton value="table" aria-label="table">
              table
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
        {gtexView === "plot" ? (
          <GeneExpressionPlot rows={gtexRows} />
        ) : (
          <MaterialReactTable
            {...tableProps}
            data={gtexRows}
            columns={gtexColumns}
            enablePagination={gtexRows.length > 20}
            initialState={{ density: "compact", sorting: [{ id: "level", desc: true }] }}
          />
        )}
      </Section>

      <Section
        title="Expression (Human Protein Atlas)"
        isPending={expression.isPending}
        isError={expression.isError}
        error={expression.error}
        isEmpty={hpaRows.length === 0}
        emptyText="no HPA expression data for this gene">
        <MaterialReactTable
          {...tableProps}
          data={hpaRows}
          columns={hpaColumns}
          enablePagination={hpaRows.length > 20}
          initialState={{ density: "compact", sorting: [{ id: "levelRaw", desc: true }] }}
        />
      </Section>

      <Section
        title="Gene-disease (Mendelian)"
        isPending={disease.isPending}
        isError={disease.isError}
        error={disease.error}
        isEmpty={(disease.data?.length ?? 0) === 0}
        emptyText="no gene-disease associations for this gene">
        <MaterialReactTable
          {...tableProps}
          data={disease.data ?? []}
          columns={diseaseColumns}
          enablePagination={(disease.data?.length ?? 0) > 20}
          initialState={{ density: "compact" }}
        />
      </Section>
    </Box>
  );
};

export default GeneEvidenceTab;
