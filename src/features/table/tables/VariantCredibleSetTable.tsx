import { useEffect, useMemo, useState } from "react";
import { Box, Chip, Skeleton, Typography } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import type { MRT_ColumnDef } from "material-react-table";
import { DatasetMeta, GroupedCredibleSet, VariantResult } from "../../../types/types.normalized";
import { classifyCisTrans, groupCredibleSets } from "../../../store/munge.normalized";
import { useDataStore } from "../../../store/store";
import { pValRepr, formatTissue, makeTraitNameResolver, PSEUDO_CS_TOOLTIP } from "../utils/tableutil";
import { HtmlTooltip } from "../../tooltips/HtmlTooltip";
import { UpOrDownIcon } from "../UpDownIcons";
import { naInfSort } from "../utils/sorting";
import { DataTypeIcon } from "../DataTypeIcon";
import { PhenotypeTooltip } from "../../tooltips/PhenotypeTooltip";
import { PhenoSumstatsArrow } from "../PhenoSumstatsLink";
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

// human-readable dataset label. eQTL Catalogue sub-datasets (QTD…) are enriched (BFF) with their
// study + tissue + condition, shown in place of the bare QTD id; everything else just spaces out the
// dataset id. a multi-membership group appends its count.
const datasetLabel = (g: GroupedCredibleSet, datasets: Record<string, DatasetMeta>): string => {
  const meta = datasets[g.dataset];
  let base: string;
  if (g.resource === "eqtl_catalogue" && meta?.study) {
    const study = meta.study.replace(/_/g, " ");
    const tissue = (meta.tissueLabel ?? "").replace(/_/g, " ");
    // "naive" is the uninformative default condition — omit it, show only real perturbations.
    const cond =
      meta.condition && meta.condition !== "naive" ? `, ${meta.condition.replace(/_/g, " ")}` : "";
    base = `${study}: ${tissue}${cond}`;
  } else {
    base = g.dataset.replace(/_/g, " ");
  }
  return g.count === 1 ? base : `${base} (${g.count})`;
};

const getColumns = (
  traitName: (resource: string, trait: string) => string,
  // resources whose credible sets are pseudo — their PIP cells render greyed with a caveat tooltip.
  pseudoResources: Set<string>,
  // cis-window half-width (Mb) for the [cis]/[trans] label on QTL traits.
  cisWindow: number,
  // dataset metadata map (keyed by dataset id) for resolving eQTL Catalogue QTD ids to human names.
  datasets: Record<string, DatasetMeta>
): MRT_ColumnDef<GroupedCredibleSet>[] => {
  // caQTL shows the peak's linked gene(s), or the peak id when none resolved, with the cell type(s) in
  // parens (the peak itself goes in a tooltip); other QTLs/GWAS show the resolved trait name.
  const displayName = (g: GroupedCredibleSet): string => {
    if (g.dataType === "caQTL") {
      const genes = (g.geneTargets ?? []).map((t) => t.symbol);
      const base = genes.length ? genes.join(", ") : g.trait;
      const cells = distinctCellTypes(g);
      return cells.length ? `${base} (${cells.map(formatTissue).join(", ")})` : base;
    }
    return traitName(g.resource, g.trait);
  };
  return [
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
    accessorFn: (row) => datasetLabel(row, datasets),
    id: "dataset",
    header: "dataset",
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "dataset" },
    size: 160,
    // when a group spans multiple cell types, list each cell type's p-value / beta in a tooltip
    Cell: ({ row }) => {
      const g = row.original;
      const label = datasetLabel(g, datasets);
      const meta = datasets[g.dataset];
      // eQTL Catalogue: the human name hides the QTD id, so surface it (plus provenance) in a tooltip.
      if (g.resource === "eqtl_catalogue" && meta?.study) {
        return (
          <HtmlTooltip
            title={
              <Box>
                <div>{g.dataset}</div>
                <div>{meta.study.replace(/_/g, " ")}</div>
                <div>
                  {(meta.tissueLabel ?? "").replace(/_/g, " ")}
                  {meta.condition ? ` / ${meta.condition.replace(/_/g, " ")}` : ""}
                </div>
                {meta.sampleSize ? <div>n = {meta.sampleSize}</div> : null}
              </Box>
            }>
            <span style={{ textDecoration: "underline dotted" }}>{label}</span>
          </HtmlTooltip>
        );
      }
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
    // trait display: GWAS/ATC/study ids -> human-readable; gene-based QTL -> gene symbol; caQTL ->
    // the peak's linked gene(s). QTLs get a [cis]/[trans] suffix relative to the current cis window.
    accessorFn: (row) => {
      const ct = classifyCisTrans(row, cisWindow);
      return ct ? `${displayName(row)} [${ct}]` : displayName(row);
    },
    id: "trait",
    header: "trait",
    Cell: ({ row }) => {
      const g = row.original;
      const name = displayName(g);
      const ct = classifyCisTrans(g, cisWindow);
      const suffix = ct ? (
        <Box component="span" sx={{ color: "text.secondary", fontSize: "0.7rem", ml: "4px" }}>
          [{ct}]
        </Box>
      ) : null;
      // right-arrow handoff to the sumstats tab, before the trait name (null unless sumstats-capable)
      const arrow = (
        <PhenoSumstatsArrow
          resource={g.resource}
          trait={g.trait}
          traitOriginal={g.traitOriginal}
          dataType={g.dataType}
        />
      );

      // caQTL: the trait is an ATAC peak; the gene(s)/cell type(s) render inline, the peak goes in a
      // tooltip so every table reads as gene-centric.
      if (g.dataType === "caQTL") {
        return (
          <HtmlTooltip
            title={
              <Box>
                <div>ATAC peak: {g.trait}</div>
                {(g.geneTargets ?? []).length === 0 && <div>no linked gene resolved</div>}
              </Box>
            }>
            <Box component="span" sx={{ cursor: "help" }}>
              <span style={{ textDecoration: "underline dotted" }}>{name}</span>
              {suffix}
            </Box>
          </HtmlTooltip>
        );
      }

      const labelSpan = (
        <span style={{ textDecoration: "underline dotted", cursor: "help" }}>{name}</span>
      );
      const inner =
        g.quantLevel && g.quantLevel !== "ge" ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
            {labelSpan}
            <Chip
              label={g.quantLevel}
              size="small"
              variant="outlined"
              sx={{ height: "16px", fontSize: "0.65rem", "& .MuiChip-label": { px: "5px" } }}
            />
            {suffix}
          </Box>
        ) : (
          <Box component="span">
            {labelSpan}
            {suffix}
          </Box>
        );
      return (
        <Box sx={{ display: "flex", alignItems: "center" }}>
          {arrow}
          <PhenotypeTooltip
            resource={g.resource}
            phenocode={g.traitOriginal}
            phenostring={name}
            dataType={g.dataType}
            dataset={g.dataset}
            content={inner}
          />
        </Box>
      );
    },
    // sort/filter on the displayed name (gene symbol for QTLs, linked gene(s) for caQTL)
    sortingFn: (rowA, rowB) => displayName(rowA.original).localeCompare(displayName(rowB.original)),
    filterFn: (row, _id, filterValue) =>
      displayName(row.original).toLowerCase().includes(String(filterValue).toLowerCase()),
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
      const isPseudo = pseudoResources.has(row.resource);
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
            <>
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
              {isPseudo && <Box sx={{ marginTop: "6px", maxWidth: "320px" }}>{PSEUDO_CS_TOOLTIP}</Box>}
            </>
          }>
          {/* pseudo CS PIPs are heuristic, so grey them (theme-aware) and lean on the tooltip caveat */}
          <Box component="span" sx={isPseudo ? { color: "text.secondary" } : undefined}>
            {Number.isNaN(row.maxPip) ? "-" : row.maxPip.toPrecision(3)}
          </Box>
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
};

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

// cheap skeleton shown the instant a row expands. Rendering the real interactive MaterialReactTable
// is the slow part of an expand (it builds dozens of MUI Tooltip/Box/Chip components, heavily
// amplified by dev-mode + StrictMode) — not data, the rows are already in memory. This is a handful
// of plain Skeleton bars so the panel opens immediately; the full sortable/filterable table swaps in
// a frame later. row count is hinted from the real data so the placeholder is the right height.
const DetailSkeleton = ({ rowHint }: { rowHint: number }) => (
  <Box sx={{ display: "flex", flexDirection: "column", gap: "4px" }}>
    {Array.from({ length: Math.min(Math.max(rowHint, 1), 8) }).map((_, i) => (
      <Skeleton key={i} variant="rounded" height={22} width="100%" />
    ))}
  </Box>
);

const VariantCredibleSetTable = (props: { data: VariantResult }) => {
  // resolve trait display names from the store directly so every caller (variant results, data-type
  // comparison, phenotype summary) shows the same resolved name — no per-caller traitName prop to
  // forget (a missing prop is exactly why the data-type comparison detail showed raw codes).
  const phenotypes = useDataStore((state) => state.normalizedData?.phenotypes);
  const resources = useDataStore((state) => state.normalizedData?.resources);
  const datasets = useDataStore((state) => state.normalizedData?.datasets);
  const cisWindow = useDataStore((state) => state.cisWindow);
  const traitName = useMemo(() => makeTraitNameResolver(phenotypes), [phenotypes]);
  const pseudoResources = useMemo(
    () => new Set((resources ?? []).filter((r) => r.hasPseudoCredibleSets).map((r) => r.id)),
    [resources]
  );
  const grouped = useMemo(
    () => groupCredibleSets(props.data.credibleSets),
    [props.data.credibleSets]
  );
  const columns = useMemo(
    () => getColumns(traitName, pseudoResources, cisWindow, datasets ?? {}),
    [traitName, pseudoResources, cisWindow, datasets]
  );

  // defer the heavy MaterialReactTable mount so the detail panel opens instantly with the skeleton
  // above; double rAF guarantees the skeleton paints before the MRT mount blocks the main thread.
  // cancels on unmount so a quick collapse-before-paint doesn't upgrade a dead panel.
  const [showInteractive, setShowInteractive] = useState(false);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShowInteractive(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Typography sx={{ marginBottom: "10px", fontWeight: "bold" }}>
        Credible sets / fine-mapping results
      </Typography>
      <Typography sx={{ marginBottom: "10px" }}>
        The credible sets across all phenotypes and QTLs that contain this variant, after the current
        PIP / resource / data-type filters.
      </Typography>
      {!showInteractive ? (
        <DetailSkeleton rowHint={grouped.length} />
      ) : (
      <MaterialReactTable
        columns={columns}
        data={grouped}
        enableTopToolbar={false}
        // data/columns are memoized; keep MRT from auto-resetting the page on change to avoid the
        // reset -> setState -> re-render loop (see VariantMainTable) and to hold position on re-render.
        autoResetPageIndex={false}
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
            <ColocSection row={row.original} variant={props.data.variant} />
          </>
        )}
      />
      )}
    </Box>
  );
};

export default VariantCredibleSetTable;
