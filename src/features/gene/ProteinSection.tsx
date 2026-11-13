import { Fragment, lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { DEFAULT_MAX_CS_SIZE, DEFAULT_MIN_LEAD_MLOG10P, pseudoDataNames } from "@/store/geneCS";
import { useDatasets, useGeneCredibleSets } from "@/store/serverQuery";
import { useNearViewport } from "../structure/useNearViewport";
import { VIEW_SPEC_VERSION, type ViewSpec } from "../structure/viewSpec";
import type { LiveSelection, ResidueHandler } from "../structure/StructureViewer";
import {
  ProteinStructureNotConfigured,
  ProteinStructureNotYetAvailable,
  useGeneExomeVariants,
  useProteinFeatures,
  useProteinModels,
  useProteinResidues,
  useVariantProteinMap,
} from "./proteinApi";
import ProteinTrack, { PseudoMark, type TrackSelection } from "./ProteinTrack";
import {
  accessionsOf,
  featureTrackRows,
  filePositionsIn,
  indexModel,
  missenseCandidates,
  ownerRows,
  placeVariants,
  trackCredibleSets,
  windowOwning,
  windowsOf,
  type PlacedVariant,
  type ProteinModel,
} from "./proteinTrack";

/**
 * The gene's protein for the gene evidence tab: a track along the amino-acid axis linked both
 * ways to the 3D model. Renders nothing at all where the deployment serves no protein
 * structures.
 *
 * Default export because the tab loads it lazily; the viewer is a further lazy chunk, and
 * Mol* a third behind that.
 */

const StructureView = lazy(() =>
  import("../structure/StructureViewer").then((m) => ({ default: m.StructureView })),
);

const NO_SELECTION: LiveSelection = { positions: [], focus: false };

const NO_ROW_EXPLANATION =
  "The release's variant-to-residue map serves no protein row for these. Either the variant is " +
  "not a missense change on the canonical UniProt isoform under the release's annotation, or it " +
  "is on a protein this deployment does not serve.";

// a note writes the pseudo mark as a bare "*"; on screen each one carries its explanation
const withPseudoMarks = (note: string) =>
  note.split("*").map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <PseudoMark />}
      {part}
    </Fragment>
  ));

const Busy = ({ children }: { children: React.ReactNode }) => (
  <Box display="flex" alignItems="center" gap={1}>
    <CircularProgress size={18} />
    <Typography variant="body2">{children}</Typography>
  </Box>
);

interface Selection extends TrackSelection {
  /** a selection made on the structure leaves the camera where the reader put it; the linked
   * scene has Mol*'s own click-to-centre switched off for the same reason */
  from: "track" | "structure";
}

const Protein = ({ geneName, models }: { geneName: string; models: ProteinModel[] }) => {
  const residues = useProteinResidues(geneName, true);
  const features = useProteinFeatures(geneName, true);
  // the same query the credible-set tab runs, so this is its cached answer and not a request
  const credibleSets = useGeneCredibleSets(geneName);
  const exome = useGeneExomeVariants(geneName, true);
  const { data: datasets } = useDatasets();
  const pseudoResources = useMemo(() => pseudoDataNames(datasets), [datasets]);

  const accessions = useMemo(() => accessionsOf(models), [models]);
  const [accessionChoice, setAccessionChoice] = useState<string>();
  const accession = accessionChoice && accessions.includes(accessionChoice) ? accessionChoice : accessions[0];
  const windows = useMemo(() => windowsOf(models, accession), [models, accession]);
  const [windowChoice, setWindowChoice] = useState<string>();
  const shown = windows.find((w) => w.modelFileId === windowChoice) ?? windows[0];

  const [selection, setSelection] = useState<Selection | null>(null);
  const [marker, setMarker] = useState<number | null>(null);
  const [zoom, setZoom] = useState<[number, number] | null>(null);

  const owners = useMemo(() => ownerRows(residues.data ?? [], accession), [residues.data, accession]);
  const length = owners.length > 0 ? owners[owners.length - 1].proteinPosition : windows[windows.length - 1].proteinEnd;
  const fullDomain = useMemo<[number, number]>(() => [1, length], [length]);
  const featureRows = useMemo(() => featureTrackRows(features.data ?? [], accession), [features.data, accession]);
  const index = useMemo(
    () => indexModel(residues.data ?? [], shown.modelFileId),
    [residues.data, shown.modelFileId],
  );

  const variantsSettled = !credibleSets.isPending && !exome.isPending;
  const candidates = useMemo(
    () =>
      variantsSettled
        ? missenseCandidates(
            geneName,
            trackCredibleSets(geneName, credibleSets.data ?? []),
            exome.data ?? [],
            pseudoResources,
          )
        : [],
    [variantsSettled, geneName, credibleSets.data, exome.data, pseudoResources],
  );
  const candidateIds = useMemo(() => candidates.map((c) => c.variant).sort(), [candidates]);
  const map = useVariantProteinMap(candidateIds, variantsSettled);
  const placement = useMemo(
    () => (map.data ? placeVariants(candidates, map.data, accession, accessions) : undefined),
    [candidates, map.data, accession, accessions],
  );

  const select = (start: number, end: number, variants?: PlacedVariant[]) => {
    setSelection({ start, end, variants: variants?.map((v) => v.variant), from: "track" });
    // the structure follows the selection to whichever model file owns where it starts
    const owner = variants
      ? windows.find((w) => w.modelFileId === variants[0].modelFileId)
      : windowOwning(windows, start);
    if (owner) setWindowChoice(owner.modelFileId);
  };

  const spec = useMemo<ViewSpec>(
    () => ({
      version: VIEW_SPEC_VERSION,
      modelFileId: shown.modelFileId,
      accession,
      gene: geneName,
      residues: [],
      colourMode: "plddt",
      omitted: { residues: 0, labels: 0 },
    }),
    [shown.modelFileId, accession, geneName],
  );
  const inModel = useMemo(
    () => (selection ? filePositionsIn(index, selection.start, selection.end) : undefined),
    [selection, index],
  );
  const live = useMemo<LiveSelection>(
    () => (selection && inModel ? { positions: inModel.positions, focus: selection.from === "track" } : NO_SELECTION),
    [selection, inModel],
  );
  const onResidue = useCallback<ResidueHandler>(
    (kind, filePosition) => {
      const position = filePosition === null ? undefined : index.byFile.get(filePosition)?.proteinPosition;
      if (kind === "hover") setMarker(position ?? null);
      else if (position !== undefined) setSelection({ start: position, end: position, from: "structure" });
    },
    [index],
  );

  if (residues.isPending) return <Busy>loading the protein…</Busy>;
  if (residues.isError) {
    return (
      <Typography color="error" variant="body2">
        failed to load: {residues.error.message}
      </Typography>
    );
  }

  const otherGenes = shown.geneNames.filter((g) => g.toLowerCase() !== geneName.toLowerCase());
  const selected = (placement?.placed ?? []).filter((v) => selection?.variants?.includes(v.variant));
  const residueName = (p: number) => {
    const r = owners[p - 1]?.proteinPosition === p ? owners[p - 1] : owners.find((o) => o.proteinPosition === p);
    return r ? `${r.residue}${p}` : String(p);
  };

  return (
    <>
      <Typography variant="body2" sx={{ mb: 0.5 }} data-testid="protein-identity">
        UniProt {accession} · {length.toLocaleString()} residues · {shown.sourceLabel}
      </Typography>
      {otherGenes.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
          {accession} is the product of {[geneName, ...otherGenes].join(" and ")}: the protein and its
          structure are the same on each of those gene pages, the variants shown are {geneName}&apos;s.
        </Typography>
      )}
      {accessions.length > 1 && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5, flexWrap: "wrap" }}>
          <Typography variant="caption" color="text.secondary">
            {geneName} has {accessions.length} UniProt accessions in this release; one is shown at a time:
          </Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={accession}
            aria-label="UniProt accession"
            onChange={(_e, value) => {
              if (!value) return;
              setAccessionChoice(value);
              setWindowChoice(undefined);
              setSelection(null);
              setZoom(null);
            }}>
            {accessions.map((a) => (
              <ToggleButton key={a} value={a} sx={{ py: 0, textTransform: "none" }}>
                {a}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      )}

      <ProteinTrack
        domain={zoom ?? fullDomain}
        owners={owners}
        windows={windows}
        shownModelFileId={shown.modelFileId}
        featureRows={featureRows}
        variants={placement?.placed ?? []}
        selection={selection}
        marker={marker}
        onSelectRange={(start, end) => select(start, end)}
        onSelectVariants={(vs) => select(vs[0].aaPos, vs[0].aaPos, vs)}
        onShowWindow={setWindowChoice}
      />

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }} data-testid="protein-variant-note">
        {!variantsSettled || map.isLoading ? (
          "placing variants…"
        ) : map.isError ? (
          `the variants could not be placed on the protein: ${map.error.message}`
        ) : !placement || placement.total === 0 ? (
          `no missense variants of ${geneName} among its credible sets and exome results`
        ) : (
          <>
            {placement.placed.length} missense variant{placement.placed.length === 1 ? "" : "s"} placed by residue.
            {placement.noRow > 0 && (
              <>
                {" "}
                <Tooltip title={NO_ROW_EXPLANATION} arrow>
                  <Box component="span" sx={{ cursor: "help", borderBottom: "1px dotted" }} data-testid="protein-no-row">
                    {placement.noRow} of {placement.total} variants have no served protein row
                  </Box>
                </Tooltip>
                .
              </>
            )}
            {placement.onOtherAccession > 0 &&
              ` ${placement.onOtherAccession} of ${placement.total} are placed on another accession of ${geneName}, not on ${accession}.`}
            {placement.onOtherGene > 0 &&
              ` ${placement.onOtherGene} of ${placement.total} are placed only on another gene's protein (${placement.otherGenes.join(", ")}).`}
          </>
        )}
        {(credibleSets.isError || exome.isError) &&
          ` The ${[credibleSets.isError && "credible-set", exome.isError && "exome"].filter(Boolean).join(" and ")} variants failed to load.`}
        {features.isError && " The feature rows failed to load."}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }} data-testid="protein-set-filters">
        credible sets as the Credible sets tab first shows them (lead p ≤ 1e-{DEFAULT_MIN_LEAD_MLOG10P}, at
        most {DEFAULT_MAX_CS_SIZE} variants, QTL sets only for {geneName} itself), from every resource
        whatever that tab&apos;s resource switches say
      </Typography>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5, flexWrap: "wrap", minHeight: 30 }}>
        <Typography variant="body2" data-testid="protein-selection">
          {!selection
            ? "drag along the track to select a region, or click a variant or a residue"
            : selected.length > 0
              ? `selected ${selected.map((v) => `${v.label} (${v.variant})`).join(", ")}`
              : selection.start === selection.end
                ? `selected residue ${residueName(selection.start)}`
                : `selected residues ${selection.start}–${selection.end}`}
        </Typography>
        {selection && (
          <>
            {selection.end > selection.start && (
              <Button size="small" onClick={() => setZoom([selection.start, selection.end])}>
                zoom to selection
              </Button>
            )}
            <Button size="small" onClick={() => setSelection(null)}>
              clear
            </Button>
          </>
        )}
        {zoom && (
          <Button size="small" onClick={() => setZoom(null)}>
            show whole protein
          </Button>
        )}
        {marker !== null && (
          <Typography variant="caption" color="text.secondary" data-testid="protein-structure-pointer">
            pointer on the structure: {residueName(marker)}
          </Typography>
        )}
      </Box>

      {selected.map((v) => (
        <Typography key={v.variant} variant="caption" color="text.secondary" sx={{ display: "block" }} data-testid="protein-selected-notes">
          {selected.length > 1 && `${v.label}: `}
          {withPseudoMarks(v.notes.join("; "))}
        </Typography>
      ))}

      {windows.length > 1 && (
        <Box sx={{ mt: 1 }} data-testid="protein-window-control">
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Typography variant="body2">structure window</Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={shown.modelFileId}
              aria-label="structure window"
              onChange={(_e, value) => value && setWindowChoice(value)}>
              {windows.map((w) => (
                <ToggleButton key={w.modelFileId} value={w.modelFileId} sx={{ py: 0 }}>
                  {w.windowIndex}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="body2">
              showing window {shown.windowIndex} of {shown.nWindows}: residues{" "}
              {shown.proteinStart.toLocaleString()}–{shown.proteinEnd.toLocaleString()}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            This protein is modelled as {shown.nWindows} overlapping windows, each a separate prediction
            in its own coordinates, and one is shown at a time. Distances between residues in different
            windows are not defined. The structure numbers residues from 1 within the window; the track
            and the text here use protein positions.
          </Typography>
        </Box>
      )}
      {selection && inModel && inModel.outside > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }} data-testid="protein-outside-note">
          {inModel.outside.toLocaleString()} of the {(selection.end - selection.start + 1).toLocaleString()} selected
          residues are outside the model shown and are not highlighted on it.
        </Typography>
      )}

      <Suspense fallback={<Busy>loading the structure viewer…</Busy>}>
        <StructureView spec={spec} live={live} onResidue={onResidue} />
      </Suspense>
    </>
  );
};

// the track's rough height, held while the section waits to be scrolled to
const PLACEHOLDER_HEIGHT = 240;

const ProteinSection = ({ geneName }: { geneName: string }) => {
  const models = useProteinModels(geneName);
  // the models probe is a few hundred bytes and decides whether the section exists; the
  // residue table runs to megabytes, so it and everything after it wait for the reader
  const frame = useRef<HTMLDivElement>(null);
  const { seen } = useNearViewport(frame);

  if (models.error instanceof ProteinStructureNotConfigured) {
    return null;
  }

  const release = models.data?.release;
  let body: React.ReactNode;
  if (models.isPending) {
    body = <Busy>loading…</Busy>;
  } else if (models.error instanceof ProteinStructureNotYetAvailable) {
    body = (
      <Typography variant="body2" color="text.secondary">
        protein structure data is not yet available
      </Typography>
    );
  } else if (models.isError) {
    body = (
      <Typography color="error" variant="body2">
        failed to load: {models.error.message}
      </Typography>
    );
  } else if (models.data.models.length === 0) {
    body = (
      <Typography variant="body2" color="text.secondary">
        no predicted structure for this gene
      </Typography>
    );
  } else if (!seen) {
    body = <Box sx={{ height: PLACEHOLDER_HEIGHT }} data-testid="protein-deferred" />;
  } else {
    body = <Protein geneName={geneName} models={models.data.models} />;
  }

  return (
    <Box ref={frame} sx={{ mb: 4 }} data-testid="protein-section">
      <Typography variant="h6" sx={{ mb: 1 }}>
        Protein structure and variants
        {release && (
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            release {release}
          </Typography>
        )}
      </Typography>
      {body}
    </Box>
  );
};

export default ProteinSection;
