import { useMemo } from "react";
import { Box, Chip, Typography } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import type { MRT_ColumnDef } from "material-react-table";
import { GroupedCredibleSet, VariantResult } from "../../../types/types.normalized";
import { groupCredibleSets } from "../../../store/munge.normalized";
import { pValRepr, formatTissue } from "../utils/tableutil";
import { HtmlTooltip } from "../../tooltips/HtmlTooltip";
import { UpOrDownIcon } from "../UpDownIcons";
import { naInfSort } from "../utils/sorting";
import { DataTypeIcon } from "../DataTypeIcon";
import ColocSection from "./ColocSection";

// numeric comparator that pushes NaN to the bottom regardless of sort direction
const numDescNaNLast = (a: number, b: number): number => {
  const an = Number.isNaN(a) ? Number.NEGATIVE_INFINITY : a;
  const bn = Number.isNaN(b) ? Number.NEGATIVE_INFINITY : b;
  return an - bn;
};

/**
 * The single per-variant detail table for the credible-set-only data model (refactor.md §4).
 *
 * Renders groupCredibleSets() over the variant's ALREADY-filtered credibleSets. A group can collapse
 * several credible-set memberships (e.g. a caQTL peak fine-mapped in many cell types) into one row;
 * the displayed p-value / beta / PIP come from the group's REPRESENTATIVE membership (the one with the
 * highest PIP), and when a group spans multiple cell types the dataset cell gets a per-cell-type
 * tooltip and the expanded row shows a per-cell-type stats table.
 */

// guard: grouped arrays coerce a null mlog10p to NaN, and a missing/grouped value can be undefined.
const num = (v: number | undefined): string =>
  v === undefined || Number.isNaN(v) ? "-" : `${v}`;

const pipRepr = (p: number): string => (Number.isNaN(p) ? "-" : p.toPrecision(3));

// index of the representative membership in a group's parallel arrays: the highest-PIP one (its
// p-value/beta/cell type are what the row displays, consistent with the row's maxPip).
const repIndex = (g: GroupedCredibleSet): number => {
  let idx = 0;
  let best = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < g.pip.length; i++) {
    const p = g.pip[i];
    if (!Number.isNaN(p) && p > best) {
      best = p;
      idx = i;
    }
  }
  return idx;
};

// distinct non-null cell types in a group; >1 means the group spans several cell types (caQTL etc.)
const distinctCellTypes = (g: GroupedCredibleSet): string[] => [
  ...new Set(g.cellTypes.filter((c): c is string => !!c)),
];

interface CellTypeStat {
  cellType: string | null;
  mlog10p: number;
  beta: number;
  pip: number;
  csSize: number;
  csMinR2: number;
}

// per-membership stats for a group, sorted by PIP descending (drives the dataset tooltip + sub-table)
const cellTypeStats = (g: GroupedCredibleSet): CellTypeStat[] =>
  g.cellTypes
    .map((cellType, i) => ({
      cellType,
      mlog10p: g.mlog10p[i],
      beta: g.beta[i],
      pip: g.pip[i],
      csSize: g.csSize[i],
      csMinR2: g.csMinR2[i],
    }))
    .sort((a, b) => numDescNaNLast(b.pip, a.pip));

const th = { fontWeight: "bold", textAlign: "start" as const, paddingRight: "12px" };
const td = { paddingRight: "12px" };

// shared cell-type stats rows (cell type | p-value | beta | PIP), used by the dataset tooltip
const CellTypeRows = ({ stats }: { stats: CellTypeStat[] }) => (
  <>
    {stats.map((s, i) => (
      <tr key={`${s.cellType}-${i}`}>
        <td style={td}>{s.cellType ? formatTissue(s.cellType) : "-"}</td>
        <td style={td}>{Number.isNaN(s.mlog10p) ? "-" : pValRepr(s.mlog10p)}</td>
        <td style={td}>
          <UpOrDownIcon value={s.beta} withValue precision={3} />
        </td>
        <td>{pipRepr(s.pip)}</td>
      </tr>
    ))}
  </>
);

const getColumns = (
  traitName: (resource: string, trait: string) => string
): MRT_ColumnDef<GroupedCredibleSet>[] => [
  {
    accessorKey: "dataType",
    header: "type",
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "type" },
    size: 70,
    // data-type letter badge + label, matching the main table's "top association" column
    Cell: ({ row }) => (
      <Box sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <DataTypeIcon dataType={row.original.dataType} />
        <span>{row.original.dataType}</span>
      </Box>
    ),
  },
  {
    accessorFn: (row) =>
      row.count === 1
        ? row.dataset.replace(/_/g, " ")
        : `${row.dataset.replace(/_/g, " ")} (${row.count})`,
    id: "dataset",
    header: "dataset",
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "dataset" },
    size: 160,
    // when a group spans multiple cell types, list each cell type's p-value / beta in a tooltip
    Cell: ({ row }) => {
      const g = row.original;
      const label =
        g.count === 1 ? g.dataset.replace(/_/g, " ") : `${g.dataset.replace(/_/g, " ")} (${g.count})`;
      if (distinctCellTypes(g).length <= 1) return label;
      return (
        <HtmlTooltip
          title={
            <table>
              <thead>
                <tr>
                  <th style={th}>cell type</th>
                  <th style={th}>p-value</th>
                  <th style={th}>beta</th>
                  <th style={{ ...th, paddingRight: 0 }}>PIP</th>
                </tr>
              </thead>
              <tbody>
                <CellTypeRows stats={cellTypeStats(g)} />
              </tbody>
            </table>
          }>
          <span style={{ textDecoration: "underline dotted" }}>{label}</span>
        </HtmlTooltip>
      );
    },
  },
  {
    // resolved phenotype name (GWAS/ATC/study ids -> human-readable; QTL gene symbols pass through).
    // for caQTL the peak spans cell types, so the representative cell type is shown in parens.
    accessorFn: (row) => {
      const idx = repIndex(row);
      const name = traitName(row.resource, row.trait);
      const cell = row.dataType === "caQTL" ? row.cellTypes[idx] : null;
      return cell ? `${name} (${formatTissue(cell)})` : name;
    },
    id: "trait",
    header: "trait",
    Cell: ({ row }) => {
      const idx = repIndex(row.original);
      const name = traitName(row.original.resource, row.original.trait);
      const cell = row.original.dataType === "caQTL" ? row.original.cellTypes[idx] : null;
      const label = cell ? `${name} (${formatTissue(cell)})` : name;
      return row.original.quantLevel && row.original.quantLevel !== "ge" ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span>{label}</span>
          <Chip
            label={row.original.quantLevel}
            size="small"
            variant="outlined"
            sx={{ height: "16px", fontSize: "0.65rem", "& .MuiChip-label": { px: "5px" } }}
          />
        </Box>
      ) : (
        label
      );
    },
    // sort/filter on the resolved name; the accessorFn returns a ReactElement that MRT can't compare
    sortingFn: (rowA, rowB) =>
      traitName(rowA.original.resource, rowA.original.trait).localeCompare(
        traitName(rowB.original.resource, rowB.original.trait)
      ),
    filterFn: (row, _id, filterValue) =>
      traitName(row.original.resource, row.original.trait)
        .toLowerCase()
        .includes(String(filterValue).toLowerCase()),
    muiFilterTextFieldProps: { placeholder: "trait" },
  },
  {
    accessorFn: (row) => {
      const top = row.mlog10p[repIndex(row)];
      return Number.isNaN(top) || top === undefined ? "-" : pValRepr(top);
    },
    id: "mlog10p",
    header: "p-value",
    sortingFn: (a, b) => numDescNaNLast(a.original.mlog10p[repIndex(a.original)], b.original.mlog10p[repIndex(b.original)]),
    sortDescFirst: true,
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "filter" },
    size: 70,
  },
  {
    accessorFn: (row) => <UpOrDownIcon value={row.beta[repIndex(row)]} withValue precision={3} />,
    id: "beta",
    header: "beta",
    // sort by absolute effect size (largest |beta| first when descending)
    sortingFn: (rowA, rowB) =>
      numDescNaNLast(
        Math.abs(rowA.original.beta[repIndex(rowA.original)]),
        Math.abs(rowB.original.beta[repIndex(rowB.original)])
      ),
    sortDescFirst: true,
    size: 70,
  },
  {
    accessorFn: (row) => {
      const ttRows = row.phenocodes.map((phenocode, i) => (
        <tr key={`${phenocode}-${i}`}>
          <td>{phenocode}</td>
          <td style={{ textAlign: "center" }}>{num(row.csSize[i])}</td>
          <td style={{ textAlign: "center" }}>{num(row.csMinR2[i])}</td>
          <td>{Number.isNaN(row.pip[i]) ? "-" : row.pip[i].toPrecision(3)}</td>
        </tr>
      ));
      return (
        <HtmlTooltip
          title={
            <table>
              <thead>
                <tr>
                  <th style={{ fontWeight: "bold", textAlign: "start" }}>trait</th>
                  <th style={{ fontWeight: "bold", textAlign: "start" }}>cs size</th>
                  <th style={{ fontWeight: "bold", textAlign: "start" }}>cs min r2</th>
                  <th style={{ fontWeight: "bold", textAlign: "start" }}>PIP</th>
                </tr>
              </thead>
              <tbody>{ttRows}</tbody>
            </table>
          }>
          <span>{Number.isNaN(row.maxPip) ? "-" : row.maxPip.toPrecision(3)}</span>
        </HtmlTooltip>
      );
    },
    id: "pip",
    header: "PIP",
    // sort by the group's max PIP (highest first when descending)
    sortingFn: (rowA, rowB) => numDescNaNLast(rowA.original.maxPip, rowB.original.maxPip),
    sortDescFirst: true,
    size: 80,
  },
];

// expanded-row table of every cell type a group's credible set is fine-mapped in, with stats.
// shown before the colocalization section when the group spans more than one cell type.
const CellTypeStatsTable = ({ group }: { group: GroupedCredibleSet }) => (
  <Box sx={{ marginBottom: "16px" }}>
    <Typography sx={{ marginBottom: "6px", fontWeight: "bold" }}>
      Cell types ({distinctCellTypes(group).length})
    </Typography>
    <table style={{ borderCollapse: "collapse", fontSize: "0.75rem" }}>
      <thead>
        <tr>
          <th style={th}>cell type</th>
          <th style={th}>p-value</th>
          <th style={th}>beta</th>
          <th style={th}>PIP</th>
          <th style={th}>cs size</th>
          <th style={{ ...th, paddingRight: 0 }}>cs min r2</th>
        </tr>
      </thead>
      <tbody>
        {cellTypeStats(group).map((s, i) => (
          <tr key={`${s.cellType}-${i}`}>
            <td style={td}>{s.cellType ? formatTissue(s.cellType) : "-"}</td>
            <td style={td}>{Number.isNaN(s.mlog10p) ? "-" : pValRepr(s.mlog10p)}</td>
            <td style={td}>
              <UpOrDownIcon value={s.beta} withValue precision={3} />
            </td>
            <td style={td}>{pipRepr(s.pip)}</td>
            <td style={td}>{num(s.csSize)}</td>
            <td>{num(s.csMinR2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </Box>
);

const VariantCredibleSetTable = (props: {
  data: VariantResult;
  traitName?: (resource: string, trait: string) => string;
}) => {
  const traitName = props.traitName ?? ((_r: string, t: string) => t);
  const grouped = useMemo(
    () => groupCredibleSets(props.data.credibleSets),
    [props.data.credibleSets]
  );
  const columns = useMemo(() => getColumns(traitName), [traitName]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Typography sx={{ marginBottom: "10px", fontWeight: "bold" }}>
        Credible sets / fine-mapping results
      </Typography>
      <Typography sx={{ marginBottom: "10px" }}>
        The credible sets across all phenotypes and QTLs that contain this variant, after the current
        PIP / resource / data-type filters.
      </Typography>
      <MaterialReactTable
        columns={columns}
        data={grouped}
        enableTopToolbar={false}
        // default ordering: most credible (PIP desc), then most significant (mlog10p desc), then
        // largest effect (|beta| desc). users can re-sort any of these columns.
        initialState={{
          showColumnFilters: true,
          density: "compact",
          sorting: [
            { id: "pip", desc: true },
            { id: "mlog10p", desc: true },
            { id: "beta", desc: true },
          ],
        }}
        muiTableProps={{ sx: { tableLayout: "fixed" } }}
        muiTableBodyCellProps={{ sx: { fontSize: "0.75rem" } }}
        sortingFns={{ naInfSort }}
        // stable row id so MRT keeps the coloc detail-panel expanded across re-renders (the lazy
        // coloc query resolving would otherwise reset index-keyed expansion state)
        getRowId={(row) => row.id}
        // per-CS colocalization is fetched lazily only when a row's detail panel is expanded; the
        // per-cell-type stats table (for multi-cell-type groups) precedes the colocalization section
        renderDetailPanel={({ row }) => (
          <>
            {distinctCellTypes(row.original).length > 1 && (
              <CellTypeStatsTable group={row.original} />
            )}
            <ColocSection row={row.original} />
          </>
        )}
      />
    </Box>
  );
};

export default VariantCredibleSetTable;
