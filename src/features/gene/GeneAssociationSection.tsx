import {
  memo,
  RefObject,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  Link,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import {
  useGeneAssociationSetIds,
  useGeneAssociationSummary,
  useGeneInfo,
  useGenesInRegion,
} from "@/store/serverQuery";
import { AssocTraitMode, CredibleSetKind, useGeneEvidenceStore } from "@/store/store.geneEvidence";
import { assocPerf } from "./assocPerf";
import AssocTable from "./AssocTable";
import { layoutGenes, VARIANT_COLOURS } from "./assocTrack";
import AssocTracks, { AssocTracksHandle, ViewFlags } from "./AssocTracks";
import { Section } from "./evidenceTable";
import { chrName, formatSpan } from "./geneAnnotation";
import {
  AssocRow,
  buildAssocIndex,
  buildAssocRows,
  computeAssocView,
  Region,
} from "./geneAssociation";
import { exportCredibleSets } from "./geneEvidenceExport";
import { RadioOption, RadioOptions, TRAIT_TYPE_OPTIONS } from "./traitTypeFilter";

/**
 * Variant association tab: every GWAS credible set with a variant in the gene or near it. A track
 * shows all of their variants at once over the genes of the locus; the table lists the sets, one
 * row each, and a click in the track narrows it to the sets with a variant there.
 */

// how far either side of the gene credible sets are loaded, and so how far the view zooms out
const PADDING = 500_000;
// share of the transcript left free at either end of the default view, so a variant in the first
// or last exon is not drawn on the edge
const PADDING_LABEL = `${PADDING / 1000} kb`;
const VIEW_MARGIN = 0.01;

const CREDIBLE_SET_KIND_OPTIONS: RadioOption<CredibleSetKind>[] = [
  { value: "all", label: "both SuSiE and pseudo credible sets" },
  { value: "susie", label: "only SuSiE credible sets" },
  { value: "pseudo", label: "only pseudo credible sets" },
];

const TRAIT_MODE_OPTIONS: RadioOption<AssocTraitMode>[] = [
  { value: "all", label: "all traits for each variant and dataset" },
  { value: "top", label: "only the top trait for each variant and dataset" },
];

const LEGEND = [
  { label: "LoF", colour: "lof", diamond: true },
  { label: "other coding", colour: "coding", diamond: false },
  { label: "non-coding", colour: "other", diamond: false },
] as const;
/**
 * The filter controls. Their own component, memoized, because they are a few dozen MUI components
 * that a click in the track or a keystroke in the search would otherwise render again each time.
 */
const Filters = memo(
  ({
    gene,
    search,
    onSearch,
  }: {
    gene: string;
    search: string;
    onSearch: (text: string) => void;
  }) => {
    const traitType = useGeneEvidenceStore((s) => s.assocTraitType);
    const credibleSetKind = useGeneEvidenceStore((s) => s.assocCredibleSetKind);
    const traitMode = useGeneEvidenceStore((s) => s.assocTraitMode);
    const minPip = useGeneEvidenceStore((s) => s.assocMinPip);
    const codingOnly = useGeneEvidenceStore((s) => s.assocCodingOnly);
    const setTraitType = useGeneEvidenceStore((s) => s.setAssocTraitType);
    const setCredibleSetKind = useGeneEvidenceStore((s) => s.setAssocCredibleSetKind);
    const setTraitMode = useGeneEvidenceStore((s) => s.setAssocTraitMode);
    const setMinPip = useGeneEvidenceStore((s) => s.setAssocMinPip);
    const setCodingOnly = useGeneEvidenceStore((s) => s.setAssocCodingOnly);
    // what was typed, kept apart from the number so "0." survives until the next digit
    const [minPipText, setMinPipText] = useState(String(minPip));
    return (
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          columnGap: 3,
          mb: 1,
        }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(3, max-content)",
            columnGap: 2,
          }}>
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
          <FormControlLabel
            sx={{ gridColumn: "1 / -1", mr: 0 }}
            control={
              <Checkbox
                size="small"
                sx={{ py: 0.25 }}
                checked={codingOnly}
                onChange={(e) => setCodingOnly(e.target.checked)}
              />
            }
            label={
              <Typography variant="body2">
                only credible sets with a coding variant of {gene}
              </Typography>
            }
          />
        </Box>
        <Tooltip
          title={
            codingOnly
              ? `a credible set is listed when a coding variant of ${gene} has at least this PIP in it`
              : "a credible set is listed when one of its variants has at least this PIP in it"
          }>
          <TextField
            size="small"
            // a text input: a number input writes the decimal separator of the browser's locale
            label={codingOnly ? "min coding PIP" : "min PIP"}
            value={minPipText}
            onChange={(e) => {
              setMinPipText(e.target.value);
              const v = Number(e.target.value.replace(",", "."));
              setMinPip(Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
            }}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { inputMode: "decimal" },
            }}
            sx={{ width: 130 }}
          />
        </Tooltip>
        <TextField
          size="small"
          label="search"
          placeholder="dataset or trait name"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ width: 280 }}
        />
      </Box>
    );
  }
);
Filters.displayName = "Filters";

const TrackControls = memo(
  ({ flags, tracks }: { flags: ViewFlags; tracks: RefObject<AssocTracksHandle | null> }) => (
    <>
      {LEGEND.map(({ label, colour, diamond }) => (
        <Typography
          key={label}
          variant="caption"
          color="text.secondary"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            whiteSpace: "nowrap",
          }}>
          <Box
            component="span"
            sx={(t) => ({
              width: 9,
              height: 9,
              bgcolor:
                colour === "other"
                  ? t.palette.text.secondary
                  : VARIANT_COLOURS[t.palette.mode][colour],
              opacity: colour === "other" ? 0.5 : 1,
              borderRadius: diamond ? 0 : "50%",
              transform: diamond ? "rotate(45deg) scale(0.85)" : "none",
            })}
          />
          {label}
        </Typography>
      ))}
      <Typography variant="caption" color="text.secondary" noWrap>
        · area: number of credible sets · faint: not in the table
      </Typography>
      <Box sx={{ display: "flex" }}>
        <Tooltip title="zoom in">
          <IconButton size="small" aria-label="zoom in" onClick={() => tracks.current?.zoomBy(0.5)}>
            <ZoomInIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={`zoom out, up to ${PADDING_LABEL} either side of the gene`}>
          <span>
            <IconButton
              size="small"
              aria-label="zoom out"
              disabled={flags.atLimits}
              onClick={() => tracks.current?.zoomBy(2)}>
              <ZoomOutIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="back to the gene">
          <span>
            <IconButton
              size="small"
              aria-label="reset zoom"
              disabled={flags.isDefault}
              onClick={() => tracks.current?.reset()}>
              <RestartAltIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </>
  )
);
TrackControls.displayName = "TrackControls";

const GeneAssociationSection = ({ geneName }: { geneName: string }) => {
  const info = useGeneInfo(geneName);
  const gene = info.data;
  // the gene body answers in a fraction of the time and already fills the default view; the
  // padded region follows, asked for only then so the two do not compete for the API
  const body = useGeneAssociationSummary(gene?.symbol, 0);
  const padded = useGeneAssociationSummary(body.data ? gene?.symbol : undefined, PADDING);
  const summary = padded.data ?? body.data;
  // once, for the summary that stays: the gene body's ids would be replaced within seconds
  const setIds = useGeneAssociationSetIds(
    gene?.symbol,
    summary?.window ?? 0,
    !!padded.data || padded.isError
  );
  const limits = useMemo<Region | null>(
    () => (gene ? { start: Math.max(1, gene.start - PADDING), end: gene.end + PADDING } : null),
    [gene]
  );
  const region = useGenesInRegion(gene?.chr, limits?.start, limits?.end);

  const traitType = useGeneEvidenceStore((s) => s.assocTraitType);
  const credibleSetKind = useGeneEvidenceStore((s) => s.assocCredibleSetKind);
  const traitMode = useGeneEvidenceStore((s) => s.assocTraitMode);
  const minPip = useGeneEvidenceStore((s) => s.assocMinPip);
  const codingOnly = useGeneEvidenceStore((s) => s.assocCodingOnly);
  const setCodingOnly = useGeneEvidenceStore((s) => s.setAssocCodingOnly);
  const [searchText, setSearchText] = useState("");
  // typing stays ahead of the recomputation it causes
  const search = useDeferredValue(searchText);
  const [selection, setSelection] = useState<Region | null>(null);
  const [viewFlags, setViewFlags] = useState<ViewFlags>({
    atLimits: false,
    isDefault: true,
  });
  const tracks = useRef<AssocTracksHandle>(null);

  // a selection is a place on one gene's chromosome
  useEffect(() => setSelection(null), [gene?.symbol]);

  const index = useMemo(() => (summary ? buildAssocIndex(summary) : null), [summary]);
  const view = useMemo(
    () =>
      index &&
      computeAssocView(index, {
        traitType,
        credibleSetKind,
        minPip,
        traitMode,
        search,
        codingOnly,
        selection,
      }),
    [index, traitType, credibleSetKind, minPip, traitMode, search, codingOnly, selection]
  );
  const rows = useMemo(() => (index && view ? buildAssocRows(index, view) : []), [index, view]);
  const trackGenes = useMemo(
    () => (gene ? layoutGenes(region.data ?? [], gene.symbol) : []),
    [region.data, gene]
  );
  const defaultView = useMemo<Region | null>(() => {
    if (!gene) {
      return null;
    }
    // the canonical transcript where the gene track has it, the gene record until then
    const focal = trackGenes.find((g) => g.focal) ?? gene;
    const margin = Math.ceil((focal.end - focal.start) * VIEW_MARGIN);
    return { start: focal.start - margin, end: focal.end + margin };
  }, [trackGenes, gene]);

  useEffect(() => {
    if (assocPerf) {
      assocPerf.tableRows = rows.length;
    }
  }, [rows]);

  const csIds =
    setIds.data && setIds.data.setsKey === summary?.setsKey ? setIds.data.csId : undefined;
  const hoverSet = useCallback((set: number | null) => tracks.current?.highlightSet(set), []);
  const download = useCallback(
    (sorted: AssocRow[]) => {
      if (index && csIds) {
        exportCredibleSets(index.summary.gene, sorted, index, csIds, minPip);
      }
    },
    [index, csIds, minPip]
  );

  const isPending = info.isPending || (!!gene && body.isPending);
  const error = info.error ?? body.error;
  const chr = gene ? chrName(gene.chr) : "";

  return (
    <Section
      isPending={isPending}
      isError={!!error}
      error={error}
      // the gene body can be empty where its surroundings are not
      isEmpty={!!padded.data && padded.data.sets.lead.length === 0}
      emptyText={`no GWAS credible sets within ${PADDING_LABEL} of this gene`}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        GWAS credible sets with a variant in {gene?.symbol} or within {PADDING_LABEL} of it
        {padded.isPending && " · loading the surroundings…"}
        {padded.isError && ` · the surroundings failed to load: ${padded.error.message}`}
      </Typography>
      <Filters gene={gene?.symbol ?? geneName} search={searchText} onSearch={setSearchText} />
      {index && view && limits && defaultView && (
        <Box
          sx={{
            // stays in view while the page scrolls down to the table
            position: "sticky",
            top: 0,
            zIndex: 2,
            bgcolor: "background.default",
            pt: 0.5,
          }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              minHeight: 34,
            }}>
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 1,
              }}>
              {selection ? (
                <Chip
                  size="small"
                  color="primary"
                  variant="outlined"
                  data-testid="assoc-selection"
                  label={
                    selection.end - selection.start < 1
                      ? `chr${chr}:${selection.start.toLocaleString()}`
                      : `chr${chr}:${selection.start.toLocaleString()}–${selection.end.toLocaleString()} · ${formatSpan(selection.end - selection.start + 1)}`
                  }
                  onDelete={() => setSelection(null)}
                />
              ) : null}
              <Typography variant="body2" color="text.secondary" noWrap>
                {selection
                  ? `the table lists the credible sets with a variant here`
                  : `${view.variantNSets.reduce((n, c) => n + (c > 0 ? 1 : 0), 0).toLocaleString()} variants in GWAS credible sets, each at its highest PIP`}
              </Typography>
            </Box>
            <TrackControls flags={viewFlags} tracks={tracks} />
          </Box>
          <AssocTracks
            ref={tracks}
            index={index}
            view={view}
            genes={trackGenes}
            limits={limits}
            defaultView={defaultView}
            selection={selection}
            onSelect={setSelection}
            onViewFlags={setViewFlags}
            complete={!!padded.data}
          />
        </Box>
      )}
      {index && view && rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="assoc-empty">
          {selection && view.rowsWithoutSelection > 0
            ? codingOnly && view.rowsWithoutCodingOnly > 0
              ? `no credible set with a coding variant of ${gene?.symbol} has a variant in the selection; ${view.rowsWithoutCodingOnly.toLocaleString()} other${view.rowsWithoutCodingOnly === 1 ? " does" : "s do"} — `
              : "no credible sets with a variant in the selection match these filters — "
            : codingOnly && view.rowsWithoutCodingOnly > 0
              ? `no credible sets with a coding variant of ${gene?.symbol} match these filters; ${view.rowsWithoutCodingOnly.toLocaleString()} other${view.rowsWithoutCodingOnly === 1 ? " does" : "s do"} — `
              : "no credible sets match these filters"}
          {codingOnly && view.rowsWithoutCodingOnly > 0 ? (
            <Link component="button" variant="body2" onClick={() => setCodingOnly(false)}>
              show {view.rowsWithoutCodingOnly === 1 ? "it" : "them"}
            </Link>
          ) : selection && view.rowsWithoutSelection > 0 ? (
            <Link component="button" variant="body2" onClick={() => setSelection(null)}>
              clear the selection
            </Link>
          ) : null}
        </Typography>
      ) : index ? (
        <AssocTable
          rows={rows}
          gene={index.summary.gene}
          csIds={csIds}
          onHoverSet={hoverSet}
          onDownload={download}
        />
      ) : null}
    </Section>
  );
};

export default GeneAssociationSection;
