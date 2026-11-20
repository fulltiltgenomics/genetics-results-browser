import {
  memo,
  RefObject,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { alpha } from "@mui/material/styles";
import {
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import {
  useGeneAssociationSetIds,
  useGeneAssociationSummary,
  useGeneInfo,
  useGenesInRegion,
} from "@/store/serverQuery";
import {
  AssocVariantMode,
  CredibleSetKind,
  useGeneEvidenceStore,
} from "@/store/store.geneEvidence";
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
  collapseToTopTrait,
  computeAssocView,
  KIND_MIN_PIP,
  Region,
  Selection,
  selectionRange,
  setsWithVariants,
  variantsInRegion,
} from "./geneAssociation";
import { exportCredibleSets } from "./geneEvidenceExport";
import { RadioOption, RadioOptions, TRAIT_TYPE_OPTIONS } from "./traitTypeFilter";

/**
 * Variant association tab: every GWAS credible set with a variant in the gene or near it. A track
 * shows all of their variants at once over the genes of the locus, and never loses one: the filters
 * fade what they turn away. The table lists the sets that pass with a variant in the track's view,
 * or those of the variant or region picked in the track.
 */

// how far either side of the gene credible sets are loaded, and so how far the view zooms out
const PADDING = 500_000;
const PADDING_LABEL = `${PADDING / 1000} kb`;
// share of the transcript left free at either end of the default view, so a variant in the first
// or last exon is not drawn on the edge
const VIEW_MARGIN = 0.01;

const CREDIBLE_SET_KIND_OPTIONS: RadioOption<CredibleSetKind>[] = [
  { value: "all", label: "both SuSiE and pseudo credible sets" },
  { value: "susie", label: "only SuSiE credible sets" },
  { value: "pseudo", label: "only pseudo credible sets" },
];

const VARIANT_MODE_OPTIONS: RadioOption<AssocVariantMode>[] = [
  { value: "any", label: "credible sets with any variant" },
  { value: "coding", label: `with a coding variant PIP > ${KIND_MIN_PIP}` },
  { value: "lof", label: `with a LoF variant PIP > ${KIND_MIN_PIP}` },
];

const MODE_CHIP: Record<AssocVariantMode, string> = {
  any: "",
  coding: `coding variant PIP > ${KIND_MIN_PIP}`,
  lof: `LoF variant PIP > ${KIND_MIN_PIP}`,
};

// holds what is typed itself, so a keystroke renders this field and whatever the search changes,
// not the controls beside it
const SearchField = ({ onSearch }: { onSearch: (text: string) => void }) => {
  const [text, setText] = useState("");
  const change = (value: string) => {
    setText(value);
    // the field stays ahead of the recomputation the search causes
    startTransition(() => onSearch(value));
  };
  return (
    <TextField
      size="small"
      label="search"
      placeholder="dataset or trait name"
      value={text}
      onChange={(e) => change(e.target.value)}
      slotProps={{
        inputLabel: { shrink: true },
        input: {
          endAdornment: text && (
            <InputAdornment position="end">
              <IconButton
                size="small"
                edge="end"
                aria-label="clear search"
                onClick={() => change("")}>
                <ClearIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
      sx={{ width: 280 }}
    />
  );
};

/**
 * The filters: which credible sets pass. Each fades the track and filters the table, and none
 * takes anything off the track. Their own component, memoized, because they are a few dozen MUI
 * components that a click in the track or a change of the search would otherwise render again.
 */
const Filters = memo(
  ({ onSearch, searchKey }: { onSearch: (text: string) => void; searchKey: number }) => {
    const traitType = useGeneEvidenceStore((s) => s.assocTraitType);
    const credibleSetKind = useGeneEvidenceStore((s) => s.assocCredibleSetKind);
    const mode = useGeneEvidenceStore((s) => s.assocVariantMode);
    const setTraitType = useGeneEvidenceStore((s) => s.setAssocTraitType);
    const setCredibleSetKind = useGeneEvidenceStore((s) => s.setAssocCredibleSetKind);
    const setMode = useGeneEvidenceStore((s) => s.setAssocVariantMode);
    return (
      <Box sx={{ mb: 1 }}>
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 3 }}>
          <Box
            sx={{ display: "grid", gridTemplateColumns: "repeat(3, max-content)", columnGap: 2 }}>
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
              label="variant kind"
              value={mode}
              options={VARIANT_MODE_OPTIONS}
              onChange={setMode}
            />
          </Box>
          <SearchField key={searchKey} onSearch={onSearch} />
        </Box>
      </Box>
    );
  }
);
Filters.displayName = "Filters";

const Swatch = ({
  colour,
  diamond = false,
  edge,
  faint = false,
}: {
  colour: "lof" | "coding" | "other";
  diamond?: boolean;
  edge?: boolean;
  faint?: boolean;
}) => (
  <Box
    component="span"
    aria-hidden
    sx={(t) => {
      const fill =
        colour === "other"
          ? alpha(t.palette.text.secondary, 0.7)
          : VARIANT_COLOURS[t.palette.mode][colour];
      return {
        display: "inline-block",
        boxSizing: "border-box",
        width: 10,
        height: 10,
        mr: 0.5,
        border: edge ? `2px solid ${t.palette.text.primary}` : "none",
        bgcolor: fill,
        opacity: faint ? 0.3 : 1,
        borderRadius: diamond ? 0 : "50%",
        transform: diamond ? "rotate(45deg) scale(0.85)" : "none",
      };
    }}
  />
);

// what the marks of the track mean; a legend only, the filters are above it
const Legend = memo(({ gene }: { gene: string }) => (
  <Typography
    variant="caption"
    color="text.secondary"
    data-testid="assoc-legend"
    sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 1.5, minWidth: 0 }}>
    <span>
      <Swatch colour="lof" diamond />
      LoF
    </span>
    <span>
      <Swatch colour="coding" />
      other coding
    </span>
    <span>
      <Swatch colour="coding" edge />
      coding in {gene}
    </span>
    <span>
      <Swatch colour="other" />
      non-coding
    </span>
    <span>·</span>
    <span>
      <Swatch colour="other" faint />
      faint: in no credible set that passes the filters
    </span>
    <span>· area: number of credible sets</span>
  </Typography>
));
Legend.displayName = "Legend";

const TrackControls = memo(
  ({ flags, tracks }: { flags: ViewFlags; tracks: RefObject<AssocTracksHandle | null> }) => (
    <Box sx={{ display: "flex", ml: "auto" }}>
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
  // what the padded summary covers
  const loaded = useMemo<Region | null>(
    () => (gene ? { start: Math.max(1, gene.start - PADDING), end: gene.end + PADDING } : null),
    [gene]
  );
  const region = useGenesInRegion(gene?.chr, loaded?.start, loaded?.end);

  const traitType = useGeneEvidenceStore((s) => s.assocTraitType);
  const credibleSetKind = useGeneEvidenceStore((s) => s.assocCredibleSetKind);
  const traitMode = useGeneEvidenceStore((s) => s.assocTraitMode);
  const mode = useGeneEvidenceStore((s) => s.assocVariantMode);
  const setTraitType = useGeneEvidenceStore((s) => s.setAssocTraitType);
  const setCredibleSetKind = useGeneEvidenceStore((s) => s.setAssocCredibleSetKind);
  const setTraitMode = useGeneEvidenceStore((s) => s.setAssocTraitMode);
  const setMode = useGeneEvidenceStore((s) => s.setAssocVariantMode);
  const [search, setSearch] = useState("");
  // remounts the search field, which holds its own text, to empty it from outside
  const [searchKey, setSearchKey] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  // where the track has come to rest; null until it has moved
  const [viewRegion, setViewRegion] = useState<Region | null>(null);
  // a stretch the table stays on while the track moves
  const [pinned, setPinned] = useState<Region | null>(null);
  const [viewFlags, setViewFlags] = useState<ViewFlags>({ atLimits: false, isDefault: true });
  const tracks = useRef<AssocTracksHandle>(null);
  const topTrait = traitMode === "top";

  // a selection, a view and a pin are places on one gene's chromosome
  useEffect(() => {
    setSelection(null);
    setViewRegion(null);
    setPinned(null);
  }, [gene?.symbol]);

  const index = useMemo(() => (summary ? buildAssocIndex(summary) : null), [summary]);
  const selected = useMemo(
    () => (index && selection ? selectionRange(index, selection) : null),
    [index, selection]
  );
  const view = useMemo(
    () => index && computeAssocView(index, { traitType, credibleSetKind, mode, search, selected }),
    [index, traitType, credibleSetKind, mode, search, selected]
  );
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
  // how far the view zooms out: as far as the loaded region reaches on both sides of the drawn
  // transcript, so the widest view has it in the middle. The gene record the region is padded
  // around covers every transcript, and the drawn one can sit at one end of it
  const limits = useMemo<Region | null>(() => {
    if (!loaded || !defaultView) {
      return null;
    }
    const centre = (defaultView.start + defaultView.end) / 2;
    const half = Math.min(centre - loaded.start, loaded.end - centre);
    return { start: Math.ceil(centre - half), end: Math.floor(centre + half) };
  }, [loaded, defaultView]);

  // what the table is about: the selection where there is one, and otherwise a stretch of the
  // chromosome, pinned or the track's view
  const tableRegion = pinned ?? viewRegion ?? defaultView;
  const selectedVariant =
    selection?.kind === "variant" && selected && selected[1] > selected[0] ? selected[0] : null;
  const table = useMemo(() => {
    if (!index || !view || !tableRegion) {
      return null;
    }
    const range = selected ?? variantsInRegion(index.variantPos, tableRegion);
    const passing = setsWithVariants(index, view.sets, range);
    // the top trait is picked among the sets the table is about, so a set is never dropped for
    // one that is not there
    const { sets, more } = topTrait
      ? collapseToTopTrait(index, passing, selectedVariant)
      : { sets: passing, more: undefined };
    return {
      sets,
      more,
      nPassing: passing.length,
      nInScope: setsWithVariants(index, index.allSets, range).length,
    };
  }, [index, view, tableRegion, selected, selectedVariant, topTrait]);
  const rows = useMemo(
    () =>
      index && table
        ? buildAssocRows(index, table.sets, {
            more: table.more,
            selectedVariant,
            region: viewRegion ?? defaultView,
          })
        : [],
    [index, table, selectedVariant, viewRegion, defaultView]
  );

  useEffect(() => {
    if (assocPerf) {
      assocPerf.tableRows = rows.length;
    }
  }, [rows]);

  const settleView = useCallback(
    (next: Region) =>
      startTransition(() =>
        setViewRegion((current) =>
          current?.start === next.start && current.end === next.end ? current : next
        )
      ),
    []
  );
  // the counts follow the view on every frame, so they are written straight into their element
  const viewCounts = useRef("");
  const viewCountEl = useRef<HTMLSpanElement | null>(null);
  const hasSelection = selection != null;
  const showViewCount = useCallback(
    (count: number, shown: number) => {
      viewCounts.current =
        shown === count && !hasSelection
          ? `${count.toLocaleString()} variants in view`
          : `${count.toLocaleString()} variants in view, ${shown.toLocaleString()} in credible sets that ${
              hasSelection ? "pass the filters and hold the selection" : "pass the filters"
            }`;
      if (viewCountEl.current) {
        viewCountEl.current.textContent = viewCounts.current;
      }
    },
    [hasSelection]
  );
  const attachViewCount = useCallback((el: HTMLSpanElement | null) => {
    viewCountEl.current = el;
    if (el) {
      el.textContent = viewCounts.current;
    }
  }, []);

  const csIds =
    setIds.data && setIds.data.setsKey === summary?.setsKey ? setIds.data.csId : undefined;
  const hoverSet = useCallback((set: number | null) => tracks.current?.highlightSet(set), []);
  const openSets = useCallback((sets: number[]) => tracks.current?.showSets(sets), []);
  const download = useCallback(
    (sorted: AssocRow[]) => {
      if (index && csIds) {
        exportCredibleSets(index.summary.gene, sorted, index, csIds);
      }
    },
    [index, csIds]
  );

  const isPending = info.isPending || (!!gene && body.isPending);
  const error = info.error ?? body.error;
  const chr = gene ? chrName(gene.chr) : "";
  const stretch = (r: Region) =>
    `chr${chr}:${r.start.toLocaleString()}–${r.end.toLocaleString()} · ${formatSpan(r.end - r.start + 1)}`;
  const scopeLabel = selection
    ? selection.kind === "variant"
      ? "with this variant"
      : "with a variant in the region"
    : pinned
      ? "with a variant in the pinned stretch"
      : "with a variant in view";
  // every restriction in force, each put away from its chip
  const filterChips: { label: string; clear: () => void }[] = [
    traitType !== "all" && { label: `${traitType} traits`, clear: () => setTraitType("all") },
    credibleSetKind !== "all" && {
      label: credibleSetKind === "susie" ? "SuSiE only" : "pseudo only",
      clear: () => setCredibleSetKind("all"),
    },
    mode !== "any" && { label: MODE_CHIP[mode], clear: () => setMode("any") },
    search.trim() !== "" && {
      label: `search: ${search.trim()}`,
      clear: () => {
        setSearch("");
        setSearchKey((k) => k + 1);
      },
    },
  ].filter((c) => !!c);

  const topTraitBox = (
    <FormControlLabel
      sx={{ ml: 0, mr: 1 }}
      control={
        <Checkbox
          size="small"
          sx={{ py: 0.25 }}
          checked={topTrait}
          onChange={(e) => setTraitMode(e.target.checked ? "top" : "all")}
        />
      }
      label={
        <Typography variant="body2">
          top trait only: one row per{" "}
          {selectedVariant != null ? "dataset" : "lead variant and dataset"}
        </Typography>
      }
    />
  );

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
      <Filters onSearch={setSearch} searchKey={searchKey} />
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
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minHeight: 34 }}>
            <Legend gene={index.summary.gene} />
            <TrackControls flags={viewFlags} tracks={tracks} />
          </Box>
          <Typography
            variant="body2"
            color="text.secondary"
            noWrap
            data-testid="assoc-status"
            sx={{ height: 24 }}>
            <span ref={attachViewCount} data-testid="assoc-view-count" /> · each at its highest PIP
            in any credible set
          </Typography>
          <AssocTracks
            ref={tracks}
            index={index}
            view={view}
            genes={trackGenes}
            limits={limits}
            defaultView={defaultView}
            selection={selection}
            selectedVariant={selectedVariant}
            onSelect={setSelection}
            onViewFlags={setViewFlags}
            onViewSettled={settleView}
            onViewCount={showViewCount}
            complete={!!padded.data}
          />
          {table && tableRegion && (
            <Box
              data-testid="assoc-table-bar"
              sx={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                columnGap: 1,
                rowGap: 0.5,
                pt: 2,
                pb: 0.5,
              }}>
              {topTraitBox}
              {selection ? (
                <Chip
                  size="small"
                  color="primary"
                  data-testid="assoc-selection"
                  label={selection.kind === "variant" ? selection.id : stretch(selection)}
                  onDelete={() => setSelection(null)}
                />
              ) : pinned ? (
                <Chip
                  size="small"
                  color="primary"
                  data-testid="assoc-scope"
                  icon={<PushPinOutlinedIcon />}
                  label={`pinned to ${stretch(pinned)}`}
                  onDelete={() => setPinned(null)}
                />
              ) : (
                <Tooltip title="follows the track's view; click to pin the table to this stretch">
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    data-testid="assoc-scope"
                    icon={<PushPinOutlinedIcon />}
                    label="in view"
                    onClick={() => setPinned(tableRegion)}
                  />
                </Tooltip>
              )}
              {filterChips.map((chip) => (
                <Chip
                  key={chip.label}
                  size="small"
                  variant="outlined"
                  label={chip.label}
                  onDelete={chip.clear}
                />
              ))}
              <Typography variant="body2" color="text.secondary" data-testid="assoc-accounting">
                {topTrait &&
                  `${table.sets.length.toLocaleString()} row${table.sets.length === 1 ? "" : "s"} for `}
                {table.nPassing.toLocaleString()} of the {table.nInScope.toLocaleString()} credible
                sets {scopeLabel}
              </Typography>
            </Box>
          )}
        </Box>
      )}
      {index && view && rows.length === 0 && (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="assoc-empty"
          sx={{ mb: 0.5 }}>
          no credible sets {scopeLabel} pass the filters
        </Typography>
      )}
      {index && (
        <AssocTable
          rows={rows}
          csIds={csIds}
          selected={selectedVariant != null}
          collapsed={topTrait}
          onHoverSet={hoverSet}
          onOpenSets={openSets}
          onDownload={download}
        />
      )}
    </Section>
  );
};

export default GeneAssociationSection;
