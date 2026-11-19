import { useMemo, useState } from "react";
import { Box, IconButton, TextField, Tooltip, Typography } from "@mui/material";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import { MaterialReactTable, MRT_ColumnDef } from "material-react-table";
import {
  useDatasets,
  useGeneGwasCredibleSetRows,
  useGeneInfo,
  useGenesInRegion,
  useResourcesMetadata,
} from "@/store/serverQuery";
import { AssocTraitMode, CredibleSetKind, useGeneEvidenceStore } from "@/store/store.geneEvidence";
import { DownloadButton } from "../table/ExportToolbar";
import { UpOrDownIcon } from "../table/UpDownIcons";
import { LetterBadge } from "../table/DataTypeIcon";
import { naInfSort } from "../table/utils/sorting";
import {
  cleanConsequence,
  datasetDisplayName,
  PSEUDO_CS_TOOLTIP,
  pValRepr,
} from "../table/utils/tableutil";
import { evidenceTableProps, numCell, Section, sortedRows, truncatedCell } from "./evidenceTable";
import {
  annotateCredibleSets,
  CodingCredibleSetRow,
  CodingVariantSummary,
  filterCredibleSetRows,
  groupCodingCredibleSets,
  pseudoCredibleSetLookup,
  summarizeCodingVariants,
} from "./geneAssociation";
import { exportCodingCredibleSets } from "./geneEvidenceExport";
import GeneModelPlot, { ModelMark, ModelVariant, ModelView } from "./GeneModelPlot";
import { RadioOption, RadioOptions, TRAIT_TYPE_BADGE, TRAIT_TYPE_OPTIONS } from "./traitTypeFilter";

/**
 * Variant association tab: the GWAS credible sets that hold a coding variant of the gene, one row
 * per credible set. The canonical transcript above it carries a line for every coding variant the
 * table holds, and the variants of the set under the pointer as lollipops.
 */

// how far either side of the gene credible-set members are fetched, and so how far the view zooms out
const ZOOM_PADDING = 250_000;
const MIN_VIEW_SPAN = 200;
// share of the transcript left free at either end of the default view, so a variant in the first
// or last exon is not drawn on the edge
const VIEW_MARGIN = 0.01;

const CREDIBLE_SET_KIND_OPTIONS: RadioOption<CredibleSetKind>[] = [
  { value: "all", label: "both SuSiE and pseudo credible sets" },
  { value: "susie", label: "only SuSiE credible sets" },
  { value: "pseudo", label: "only pseudo credible sets" },
];

const absBeta = (r: CodingCredibleSetRow): number => {
  const beta = r.codingVariants[0].beta;
  return beta == null || Number.isNaN(beta) ? -1 : Math.abs(beta);
};

const TRAIT_MODE_OPTIONS: RadioOption<AssocTraitMode>[] = [
  { value: "all", label: "all traits for each variant and dataset" },
  { value: "top", label: "only the top trait for each variant and dataset" },
];

const columns: MRT_ColumnDef<CodingCredibleSetRow>[] = [
  {
    accessorFn: (row) =>
      row.quantitative == null ? "" : row.quantitative ? "quantitative" : "binary",
    header: "type",
    id: "type",
    size: 60,
    Cell: ({ cell }) => {
      const type = cell.getValue<"binary" | "quantitative" | "">();
      return type === "" ? "" : <LetterBadge {...TRAIT_TYPE_BADGE[type]} title={type} />;
    },
  },
  {
    accessorKey: "dataset",
    header: "dataset",
    id: "dataset",
    size: 170,
    Cell: ({ cell }) => truncatedCell(datasetDisplayName(cell.getValue<string>() ?? "")),
  },
  {
    accessorKey: "traitName",
    header: "trait",
    id: "traitName",
    size: 260,
    Cell: ({ cell }) => truncatedCell(cell.getValue<string>() ?? ""),
  },
  {
    accessorFn: (row) => (row.pseudo ? "pseudo" : "SuSiE"),
    header: "credible set",
    id: "kind",
    size: 135,
    Cell: ({ cell }) => {
      const kind = cell.getValue<string>();
      return kind === "pseudo" ? (
        <Box component="span" title={PSEUDO_CS_TOOLTIP} sx={{ color: "text.secondary" }}>
          pseudo
        </Box>
      ) : (
        kind
      );
    },
  },
  {
    accessorFn: (row) => row.codingVariants[0].variant,
    header: "top coding variant",
    id: "variant",
    size: 200,
    Cell: ({ row }) => {
      const [top, ...rest] = row.original.codingVariants;
      const more = rest.length > 0 ? ` +${rest.length}` : "";
      return truncatedCell(`${top.variant}${more}`);
    },
  },
  {
    accessorFn: (row) => cleanConsequence(row.codingVariants[0].consequence ?? ""),
    header: "consequence",
    id: "consequence",
    size: 145,
  },
  {
    accessorKey: "codingVariants.0.pip",
    header: "PIP",
    id: "codingVariants.0.pip",
    sortingFn: naInfSort,
    sortDescFirst: true,
    size: 80,
    Cell: numCell(3),
  },
  {
    // sorted on -log10(p): p underflows to 0 and would tie the strongest associations
    accessorKey: "codingVariants.0.mlog10p",
    header: "p-value",
    id: "codingVariants.0.mlog10p",
    sortingFn: naInfSort,
    sortDescFirst: true,
    size: 100,
    Cell: ({ cell }) => {
      const v = cell.getValue<number | null>();
      return v == null || Number.isNaN(v) ? "" : pValRepr(v);
    },
  },
  {
    accessorFn: (row) => row.codingVariants[0].beta,
    header: "beta",
    id: "beta",
    // by magnitude, so strong effects of either sign come first
    sortingFn: (a, b) => absBeta(a.original) - absBeta(b.original),
    sortDescFirst: true,
    size: 90,
    Cell: ({ cell }) => {
      const v = cell.getValue<number | null>();
      return v == null || Number.isNaN(v) ? (
        ""
      ) : (
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <UpOrDownIcon value={v} />
          <span>{v.toPrecision(3)}</span>
        </Box>
      );
    },
  },
  {
    accessorKey: "csSize",
    header: "n variants",
    id: "csSize",
    sortingFn: naInfSort,
    size: 115,
  },
  {
    accessorKey: "csMinR2",
    header: "min r2",
    id: "csMinR2",
    sortingFn: naInfSort,
    size: 90,
    Cell: numCell(3),
  },
];

const modelVariants = (cs: CodingCredibleSetRow): ModelVariant[] =>
  cs.variants.map((v) => ({
    pos: v.pos,
    pip: v.pip,
    variantClass: v.variantClass,
    title: `${v.variant} · ${v.consequence ? cleanConsequence(v.consequence) : "NA"} · PIP ${v.pip.toPrecision(3)}`,
  }));

const VariantTooltip = ({ variant }: { variant: CodingVariantSummary }) => (
  <Box sx={{ fontSize: "0.75rem", p: 0.5 }}>
    <Box sx={{ fontWeight: 700 }}>{variant.variant}</Box>
    <Box sx={{ mb: 1 }}>{variant.consequence ? cleanConsequence(variant.consequence) : "NA"}</Box>
    <Box
      component="table"
      sx={{
        borderSpacing: 0,
        "& td, & th": { p: 0, pr: 1.5, textAlign: "left", whiteSpace: "nowrap" },
        "& th": { fontWeight: 400, opacity: 0.7 },
      }}>
      <thead>
        <tr>
          <th>dataset</th>
          <th>top trait</th>
          <th>PIP</th>
          <th>p-value</th>
          <th>beta</th>
          <th>n variants</th>
          <th>traits</th>
        </tr>
      </thead>
      <tbody>
        {variant.datasets.map((d) => (
          <tr key={d.dataset}>
            <td>{datasetDisplayName(d.dataset)}</td>
            <Box
              component="td"
              sx={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>
              {d.traitName}
            </Box>
            <td>{d.pip.toPrecision(3)}</td>
            <td>{d.mlog10p == null ? "NA" : pValRepr(d.mlog10p)}</td>
            <td>{d.beta == null ? "NA" : d.beta.toPrecision(3)}</td>
            <td>{d.csSize}</td>
            <td>{d.nTraits}</td>
          </tr>
        ))}
      </tbody>
    </Box>
  </Box>
);

const GeneAssociationSection = ({ geneName }: { geneName: string }) => {
  const info = useGeneInfo(geneName);
  const gene = info.data;
  const region = useGenesInRegion(gene?.chr, gene?.start, gene?.end);
  const model = region.data?.find((g) => g.geneName === gene?.symbol);
  // the gene body answers in a fraction of the time and is all the table needs; the padded region
  // follows for the zoomed-out view and the counts beyond it
  const body = useGeneGwasCredibleSetRows(gene?.symbol, 0);
  const padded = useGeneGwasCredibleSetRows(body.data ? gene?.symbol : undefined, ZOOM_PADDING);
  const credibleSetRows = padded.data ?? body.data;
  const datasets = useDatasets();

  const traitType = useGeneEvidenceStore((s) => s.assocTraitType);
  const credibleSetKind = useGeneEvidenceStore((s) => s.assocCredibleSetKind);
  const traitMode = useGeneEvidenceStore((s) => s.assocTraitMode);
  const minCodingPip = useGeneEvidenceStore((s) => s.assocMinCodingPip);
  const setTraitType = useGeneEvidenceStore((s) => s.setAssocTraitType);
  const setCredibleSetKind = useGeneEvidenceStore((s) => s.setAssocCredibleSetKind);
  const setTraitMode = useGeneEvidenceStore((s) => s.setAssocTraitMode);
  const setMinCodingPip = useGeneEvidenceStore((s) => s.setAssocMinCodingPip);
  // what was typed, kept apart from the number so "0." survives until the next digit
  const [minPipText, setMinPipText] = useState(String(minCodingPip));
  const [search, setSearch] = useState("");
  const [shownKey, setShownKey] = useState<string | null>(null);
  // null is the default view: the transcript
  const [zoom, setZoom] = useState<ModelView | null>(null);

  const sets = useMemo(
    () => (gene ? groupCodingCredibleSets(credibleSetRows ?? [], gene.symbol) : []),
    [credibleSetRows, gene]
  );
  // only the resources that have a coding credible set here: Open Targets' metadata is several MB
  const resources = useMemo(() => [...new Set(sets.map((s) => s.resource))].sort(), [sets]);
  const metadata = useResourcesMetadata(resources);
  const isPseudo = useMemo(() => pseudoCredibleSetLookup(datasets.data), [datasets.data]);
  const allRows = useMemo(
    () => annotateCredibleSets(sets, metadata.data, isPseudo),
    [sets, metadata.data, isPseudo]
  );
  const rows = useMemo(
    () =>
      filterCredibleSetRows(allRows, {
        traitType,
        credibleSetKind,
        minCodingPip,
        traitMode,
        search,
      }),
    [allRows, traitType, credibleSetKind, minCodingPip, traitMode, search]
  );
  const marks = useMemo<ModelMark[]>(
    () =>
      summarizeCodingVariants(rows).map((v) => ({
        key: v.variant,
        pos: v.pos,
        variantClass: v.variantClass,
        tooltip: <VariantTooltip variant={v} />,
      })),
    [rows]
  );
  // the set last pointed at stays drawn, so the pointer can leave the table for the gene model
  const shown = rows.find((r) => r.key === shownKey) ?? null;
  const shownVariants = useMemo(() => (shown ? modelVariants(shown) : null), [shown]);

  const transcript = useMemo(() => {
    if (!model) {
      return null;
    }
    const start = Math.min(...model.exonStarts);
    const end = Math.max(...model.exonEnds);
    const margin = Math.ceil((end - start) * VIEW_MARGIN);
    return { start: start - margin, end: end + margin };
  }, [model]);
  const limits = gene && { start: gene.start - ZOOM_PADDING, end: gene.end + ZOOM_PADDING };
  const view = zoom ?? transcript;
  // keeps the span and slides the view back inside the fetched region
  const setView = (next: ModelView) => {
    if (!limits) {
      return;
    }
    const span = Math.min(
      Math.max(next.end - next.start, MIN_VIEW_SPAN),
      limits.end - limits.start
    );
    const start = Math.min(Math.max(next.start, limits.start), limits.end - span);
    setZoom({ start, end: start + span });
  };
  const zoomBy = (factor: number) => {
    if (view) {
      const mid = (view.start + view.end) / 2;
      const half = ((view.end - view.start) * factor) / 2;
      setView({ start: Math.round(mid - half), end: Math.round(mid + half) });
    }
  };
  const atLimits = !!view && !!limits && view.start <= limits.start && view.end >= limits.end;
  const inView =
    shown && view
      ? shown.variants.filter((v) => v.pos >= view.start && v.pos <= view.end).length
      : 0;

  const isPending = info.isPending || (!!gene && body.isPending);
  const error = info.error ?? body.error;

  return (
    <Section
      isPending={isPending}
      isError={!!error}
      error={error}
      isEmpty={sets.length === 0}
      emptyText="no GWAS credible sets with a coding variant in this gene">
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        GWAS credible sets that contain a coding variant of {gene?.symbol}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 3, mb: 1 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, max-content)", columnGap: 2 }}>
          <RadioOptions
            label="trait type"
            value={traitType}
            options={TRAIT_TYPE_OPTIONS}
            onChange={setTraitType}
          />
          <RadioOptions
            label="credible sets shown"
            value={credibleSetKind}
            options={CREDIBLE_SET_KIND_OPTIONS}
            onChange={setCredibleSetKind}
          />
          <RadioOptions
            label="traits shown"
            value={traitMode}
            options={TRAIT_MODE_OPTIONS}
            onChange={setTraitMode}
            spanLast
          />
        </Box>
        <TextField
          size="small"
          // a text input: a number input writes the decimal separator of the browser's locale
          label="min coding PIP"
          value={minPipText}
          onChange={(e) => {
            setMinPipText(e.target.value);
            const v = Number(e.target.value.replace(",", "."));
            setMinCodingPip(Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
          }}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { inputMode: "decimal" } }}
          sx={{ width: 130 }}
        />
        <TextField
          size="small"
          label="search"
          placeholder="dataset or trait name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ width: 280 }}
        />
      </Box>
      {model && view && (
        <Box
          sx={{
            // stays in view while the pointer moves down a long table
            position: "sticky",
            top: 0,
            zIndex: 2,
            bgcolor: "background.default",
            py: 1,
          }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {/* one line whatever the trait name's length, or the table below would jump */}
            <Typography
              variant="body2"
              noWrap
              sx={{ flex: 1, minWidth: 0 }}
              data-testid="shown-credible-set">
              {shown ? (
                <>
                  <b>{shown.traitName}</b> · {datasetDisplayName(shown.dataset)} · {inView} of{" "}
                  {shown.csSize} variant{shown.csSize === 1 ? "" : "s"} in view
                </>
              ) : (
                <Box component="span" sx={{ color: "text.secondary" }}>
                  point at a credible set to see its variants on the gene
                </Box>
              )}
            </Typography>
            <Tooltip title="zoom in">
              <IconButton size="small" aria-label="zoom in" onClick={() => zoomBy(0.5)}>
                <ZoomInIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={`zoom out, up to ${ZOOM_PADDING / 1000} kb either side of the gene`}>
              <span>
                <IconButton
                  size="small"
                  aria-label="zoom out"
                  disabled={atLimits}
                  onClick={() => zoomBy(2)}>
                  <ZoomOutIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="back to the transcript">
              <span>
                <IconButton
                  size="small"
                  aria-label="reset zoom"
                  disabled={zoom == null}
                  onClick={() => setZoom(null)}>
                  <RestartAltIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
          <GeneModelPlot
            model={model}
            view={view}
            onViewChange={setView}
            variants={shownVariants}
            marks={marks}
            exonTooltips={false}
          />
        </Box>
      )}
      {traitType !== "all" && metadata.isPending && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          loading trait types…
        </Typography>
      )}
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          no credible sets match these filters
        </Typography>
      ) : (
        <MaterialReactTable
          {...evidenceTableProps}
          // column widths come from the column sizes alone, never from the rows on the page
          layoutMode="grid"
          // eleven columns: the per-column menu button would cut the header names short
          enableColumnActions={false}
          data={rows}
          columns={columns}
          getRowId={(row) => row.key}
          enablePagination={rows.length > 20}
          initialState={{
            density: "compact",
            sorting: [{ id: "codingVariants.0.pip", desc: true }],
          }}
          muiTableBodyRowProps={({ row }) => ({
            onMouseEnter: () => setShownKey(row.id),
            selected: row.id === shownKey,
          })}
          renderBottomToolbarCustomActions={({ table }) => (
            <Box sx={{ p: "0.5rem" }}>
              <DownloadButton
                variant="outlined"
                label="DOWNLOAD TABLE"
                disabled={false}
                onClick={() => exportCodingCredibleSets(gene!.symbol, sortedRows(table))}
              />
            </Box>
          )}
        />
      )}
    </Section>
  );
};

export default GeneAssociationSection;
