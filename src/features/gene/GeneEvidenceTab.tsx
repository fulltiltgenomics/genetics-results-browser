import { useMemo } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
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

  const burdenColumns = useMemo<MRT_ColumnDef<GeneBurdenRow>[]>(
    () => [
      { accessorKey: "trait", header: "trait", id: "trait", size: 200 },
      { accessorKey: "dataset", header: "dataset", id: "dataset", size: 110 },
      { accessorKey: "annotation", header: "annotation", id: "annotation", size: 140 },
      {
        accessorKey: "mlog10pBurden",
        header: "-log10(p)",
        id: "mlog10pBurden",
        sortingFn: naInfSort,
        sortDescFirst: true,
        size: 100,
        Cell: numCell(4),
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
        Cell: ({ cell }) => {
          const v = cell.getValue<number | null>();
          return v == null ? "" : v.toLocaleString();
        },
      },
    ],
    []
  );

  const expressionColumns = useMemo<MRT_ColumnDef<GeneExpressionRow>[]>(
    () => [
      { accessorKey: "tissueCell", header: "tissue / cell", id: "tissueCell", size: 240 },
      {
        accessorKey: "level",
        header: "level",
        id: "level",
        sortingFn: naInfSort,
        sortDescFirst: true,
        size: 120,
        Cell: numCell(4),
      },
      { accessorKey: "resource", header: "resource", id: "resource", size: 100 },
      { accessorKey: "dataset", header: "dataset", id: "dataset", size: 120 },
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
        isEmpty={(burden.data?.length ?? 0) === 0}
        emptyText="no burden results for this gene">
        <MaterialReactTable
          {...tableProps}
          data={burden.data ?? []}
          columns={burdenColumns}
          enablePagination={(burden.data?.length ?? 0) > 20}
          initialState={{ density: "compact", sorting: [{ id: "mlog10pBurden", desc: true }] }}
        />
      </Section>

      <Section
        title="Expression"
        isPending={expression.isPending}
        isError={expression.isError}
        error={expression.error}
        isEmpty={(expression.data?.length ?? 0) === 0}
        emptyText="no expression data for this gene">
        <MaterialReactTable
          {...tableProps}
          data={expression.data ?? []}
          columns={expressionColumns}
          enablePagination={(expression.data?.length ?? 0) > 20}
          initialState={{ density: "compact", sorting: [{ id: "level", desc: true }] }}
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
