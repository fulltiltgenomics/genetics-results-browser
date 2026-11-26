import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, CircularProgress, Link, Typography, useTheme } from "@mui/material";
import { downloadBlob } from "../chat/downloadBlob";
import { pdbFileName, viewSpecToPml } from "./pml";
import { base64ByteLength, base64ToBytes } from "../chat/fileMarker";
import {
  StructureModelNotFound,
  StructureReleaseUnavailable,
  useStructureModel,
} from "./structureApi";
import type { LiveDrawn, Scene } from "./molstarScene";
import { useNearViewport } from "./useNearViewport";
import {
  AF3_SOURCE_LABEL,
  LIVE_ATOMS_MAX,
  LIVE_LIST_MAX,
  MAX_LABELS,
  SELECTION_COLOUR,
  MAX_SPEC_BYTES,
  NEIGHBOURHOOD_COLOUR,
  ROLE_COLOURS,
  VIEW_ROLES,
  modelSource,
  parseViewSpecText,
  type ViewRole,
  type ViewSpec,
  type ViewSpecResult,
} from "./viewSpec";

const ROLE_LABELS: Record<ViewRole, string> = {
  case: "case",
  control: "control",
  both: "case and control",
  neutral: "other",
};

// the score ranges behind the names Mol*'s pLDDT theme gives its legend rows; the colours
// come from the theme itself. A row whose name is not here is shown by name alone
const PLDDT_RANGES: Record<string, string> = {
  "Very High": "> 90",
  Confident: "70 – 90",
  Low: "50 – 70",
  "Very Low": "≤ 50",
};

const CANVAS_HEIGHT = 440;
// about four rows of entries; the caps on regions and listed labels still allow more
const LABEL_LIST_MAX_HEIGHT = 92;

/** a legend row that stands for residues in the scene: pointing at it emphasises them there */
interface LegendEntry {
  key: string;
  kind: "residue" | "region";
  text: string;
  /** absent for a region the spec gave no colour: nothing in the scene is painted for it */
  colour?: string;
  /** residue numbers as written in the model file, ascending; only ones the model holds */
  positions: number[];
}

const span = (first: number, last: number): string => (first === last ? String(first) : `${first}–${last}`);

// a label with a number in it ("p.V600E") already says where it is; one without ("hotspot")
// gets the residue number the hover text and the model file use
const entryText = (label: string, filePosition: number): string =>
  /\d/.test(label) ? label : `${label} · ${filePosition}`;

type SceneState =
  | { status: "parked" }
  | { status: "rendering" }
  | { status: "ready"; scene: Scene }
  | { status: "no-webgl" }
  | { status: "context-lost" }
  | { status: "failed"; message: string };

const decodeUtf8 = (base64: string): string | null => {
  try {
    return new TextDecoder().decode(base64ToBytes(base64));
  } catch {
    return null;
  }
};

const Swatch = ({ colour, round, children }: { colour: string; round?: boolean; children: React.ReactNode }) => (
  <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
    <Box
      sx={{ width: 12, height: 12, bgcolor: colour, borderRadius: round ? "50%" : "2px", flex: "none" }}
    />
    <Typography variant="caption">{children}</Typography>
  </Box>
);

const LegendButton = ({
  entry,
  marked,
  centred,
  onEmphasise,
  onCentre,
}: {
  entry: LegendEntry;
  marked: boolean;
  centred: boolean;
  onEmphasise: (by: "pointer" | "keyboard", entry?: LegendEntry) => void;
  onCentre: () => void;
}) => (
  <Box
    component="button"
    type="button"
    data-testid="structure-legend-entry"
    data-kind={entry.kind}
    data-positions={
      entry.kind === "region"
        ? `${entry.positions[0]}-${entry.positions[entry.positions.length - 1]}`
        : entry.positions.join(",")
    }
    data-marked={marked || undefined}
    aria-pressed={centred}
    title={centred ? "Click to show the whole structure" : "Click to centre the view here"}
    onMouseEnter={() => onEmphasise("pointer", entry)}
    onMouseLeave={() => onEmphasise("pointer")}
    // focus a click leaves behind is not pointing: it would hold the emphasis, and a region's
    // fade, long after the pointer had gone
    onFocus={(e) => e.currentTarget.matches(":focus-visible") && onEmphasise("keyboard", entry)}
    onBlur={() => onEmphasise("keyboard")}
    onClick={onCentre}
    sx={{
      display: "inline-flex",
      alignItems: "center",
      gap: 0.5,
      px: 0.5,
      py: 0,
      font: "inherit",
      color: "inherit",
      cursor: "pointer",
      border: "1px solid",
      borderColor: centred ? "text.secondary" : "transparent",
      borderRadius: 0.5,
      bgcolor: marked ? "action.selected" : "transparent",
      "&:hover, &:focus-visible": { bgcolor: "action.hover", borderColor: "text.primary", outline: "none" },
    }}>
    {entry.kind === "region" ? (
      // a bar for a stretch of the chain, a dot for one residue; hollow when nothing is painted
      <Box
        data-testid="structure-legend-swatch"
        data-painted={entry.colour ? "true" : "false"}
        sx={{
          width: 18,
          height: 8,
          boxSizing: "border-box",
          borderRadius: "2px",
          flex: "none",
          ...(entry.colour ? { bgcolor: entry.colour } : { border: "1.5px solid", borderColor: "text.secondary" }),
        }}
      />
    ) : (
      <Box sx={{ width: 12, height: 12, bgcolor: entry.colour, borderRadius: "50%", flex: "none" }} />
    )}
    <Typography variant="caption">{entry.text}</Typography>
  </Box>
);

const Note = ({ children }: { children: React.ReactNode }) => (
  <Typography variant="caption" color="text.secondary" sx={{ flexBasis: "100%" }}>
    {children}
  </Typography>
);

const Busy = ({ children }: { children: React.ReactNode }) => (
  <Box display="flex" alignItems="center" gap={1} sx={{ p: 1.5 }}>
    <CircularProgress size={18} />
    <Typography variant="body2">{children}</Typography>
  </Box>
);

const overlaySx = {
  position: "absolute",
  left: 8,
  px: 0.75,
  borderRadius: 0.5,
  bgcolor: "rgba(255,255,255,0.8)",
  color: "#333",
  pointerEvents: "none",
} as const;

/** residues a host page selects while the viewer is up; `focus` also moves the camera to them */
export interface LiveSelection {
  /** residue numbers as written in the model file */
  positions: number[];
  focus: boolean;
}
/** the residue under the pointer or clicked, by file position; null when a hover leaves */
export type ResidueHandler = (kind: "hover" | "click", filePosition: number | null) => void;

interface HostLink {
  live?: LiveSelection;
  onResidue?: ResidueHandler;
}

// the held positions for a host to read: listed while they are few, else a count and range
const liveSummary = (positions: number[]): string =>
  positions.length <= LIVE_LIST_MAX
    ? positions.join(",")
    : `${positions.length} residues ${positions[0]}-${positions[positions.length - 1]}`;

const Canvas = ({
  spec,
  pdbText,
  active,
  live,
  onResidue,
}: { spec: ViewSpec; pdbText: string; active: boolean } & HostLink) => {
  const theme = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SceneState>({ status: "parked" });
  const [hover, setHover] = useState<string | null>(null);
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const [emphasis, setEmphasis] = useState<{ scene: Scene; positions: number[]; marker: boolean }>();
  const [centredOn, setCentredOn] = useState<{ scene: Scene; key: string }>();
  const emphasisCall = useRef(0);
  // the entry under the pointer and the one holding keyboard focus are tracked apart: either
  // can go while the other still points
  const pointed = useRef<{ pointer?: LegendEntry; keyboard?: LegendEntry }>({});
  const emphasisedKey = useRef<string | undefined>(undefined);
  const labelList = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [liveHeld, setLiveHeld] = useState<{ scene: Scene; positions: number[]; drawn: LiveDrawn }>();
  // read through a ref so a host re-rendering with a new function does not rebuild the scene
  const residueHandler = useRef(onResidue);
  useEffect(() => {
    residueHandler.current = onResidue;
  }, [onResidue]);
  const linked = onResidue !== undefined;

  useEffect(() => {
    if (!active) {
      setState({ status: "parked" });
      return;
    }
    let disposed = false;
    let scene: Scene | undefined;
    setState({ status: "rendering" });
    setHover(null);
    setHoverAt(null);
    (async () => {
      const { createScene, WebGLUnavailableError } = await import("./molstarScene");
      try {
        if (disposed || !host.current) return;
        scene = await createScene(host.current, pdbText, spec, {
          onHover: (text, filePosition) => {
            if (disposed) return;
            setHover(text);
            setHoverAt(filePosition ?? null);
          },
          onEmphasisEnd: () => {
            if (disposed) return;
            // an answer still on its way is for an emphasis the scene has already ended
            emphasisCall.current++;
            emphasisedKey.current = undefined;
            setEmphasis(undefined);
          },
          onContextLost: () => {
            if (disposed) return;
            scene?.dispose();
            scene = undefined;
            setState({ status: "context-lost" });
          },
          ...(linked
            ? {
                onResidue: (kind: "hover" | "click", filePosition: number | null) => {
                  if (!disposed) residueHandler.current?.(kind, filePosition);
                },
              }
            : {}),
        });
        // the effect was torn down while Mol* was building: nothing owns this scene any more
        if (disposed) scene.dispose();
        else setState({ status: "ready", scene });
      } catch (e) {
        if (disposed) return;
        setState(
          e instanceof WebGLUnavailableError
            ? { status: "no-webgl" }
            : { status: "failed", message: e instanceof Error ? e.message : String(e) },
        );
      }
    })().catch((e) => {
      if (!disposed) setState({ status: "failed", message: `the viewer did not load (${e})` });
    });
    return () => {
      disposed = true;
      scene?.dispose();
      // the legend goes with the scene, and an unmounted entry sends no leave or blur
      pointed.current = {};
      emphasisedKey.current = undefined;
    };
  }, [spec, pdbText, active, attempt, linked]);

  const readyScene = state.status === "ready" ? state.scene : undefined;
  // applied to the running scene, and again to each one built after a scroll away and back
  useEffect(() => {
    if (!readyScene || !live) return;
    let superseded = false;
    readyScene.setLive(live.positions, live.focus).then(
      (held) => {
        if (!superseded) setLiveHeld({ scene: readyScene, ...held });
      },
      () => {},
    );
    return () => {
      superseded = true;
    };
  }, [readyScene, live]);

  // the wheel scrolls the transcript unless Ctrl or ⌘ is held: Mol* listens on its canvas and
  // cancels every wheel event it sees, so the ones meant for the page are stopped on the way
  // down to it
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const gate = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
    };
    el.addEventListener("wheel", gate, { capture: true });
    return () => el.removeEventListener("wheel", gate, { capture: true });
  }, []);

  const scene = readyScene;
  const held = live && scene && liveHeld?.scene === scene ? liveHeld : undefined;
  const missing = scene
    ? spec.residues.filter((r) => !scene.highlighted.includes(r.filePosition)).length
    : 0;
  const roles = VIEW_ROLES.filter((role) => spec.residues.some((r) => r.role === role));
  // only what the model holds: an entry for something it lacks would emphasise nothing
  const { entries, regionsOutside, unlistedLabels } = useMemo(() => {
    const none: LegendEntry[] = [];
    if (!readyScene) return { entries: none, regionsOutside: 0, unlistedLabels: 0 };
    const regions = spec.regions.flatMap((r, i): LegendEntry[] => {
      const positions = readyScene.regions[i] ?? [];
      if (positions.length === 0) return [];
      const first = positions[0];
      const last = positions[positions.length - 1];
      // the part the model has is what gets emphasised, so that is the range the entry names
      const cut = first > r.start || last < r.end ? ` (of ${span(r.start, r.end)})` : "";
      return [{ key: `region-${i}`, kind: "region", text: `${r.name} · ${span(first, last)}${cut}`, colour: r.colour, positions }];
    });
    const inModel = new Set(readyScene.highlighted);
    // capped in spec order before the model is consulted: which labels are listed is then
    // what the spec's author was told, whatever the model turns out to hold
    const labelled = spec.residues.filter((r) => r.label?.trim());
    const held = (r: (typeof labelled)[number]) => inModel.has(r.filePosition);
    const residues = labelled.slice(0, MAX_LABELS).filter(held).map((r): LegendEntry => ({
      key: String(r.filePosition),
      kind: "residue",
      text: entryText(r.label!.trim(), r.filePosition),
      colour: r.colour,
      positions: [r.filePosition],
    }));
    return {
      entries: [...regions, ...residues],
      regionsOutside: spec.regions.length - regions.length,
      unlistedLabels: labelled.slice(MAX_LABELS).filter(held).length,
    };
  }, [spec, readyScene]);
  const markedKeys = useMemo(
    () => new Set(hoverAt === null ? [] : entries.filter((e) => e.positions.includes(hoverAt)).map((e) => e.key)),
    [entries, hoverAt],
  );
  // the entry the pointer's residue belongs to may be scrolled out of the list; its own entry
  // before a region's, which is the wider answer. Moved by hand: scrollIntoView would scroll
  // the page as well
  useEffect(() => {
    const list = labelList.current;
    const el =
      list?.querySelector<HTMLElement>('[data-marked][data-kind="residue"]') ??
      list?.querySelector<HTMLElement>("[data-marked]");
    if (!list || !el) return;
    const top = el.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top;
  }, [markedKeys]);

  const emphasise = (entry: LegendEntry | undefined, marker: boolean) => {
    if (!scene) return;
    const call = ++emphasisCall.current;
    emphasisedKey.current = entry?.key;
    scene.emphasise(entry?.positions ?? [], marker).then(
      (held) => {
        // a marker takes a moment to build, so the answer to a hover can arrive after the leave's
        if (call === emphasisCall.current) setEmphasis({ scene, ...held });
      },
      () => {},
    );
  };
  const shownEmphasis = scene && emphasis?.scene === scene ? emphasis : undefined;
  const centredKey = scene && centredOn?.scene === scene ? centredOn.key : undefined;
  const centre = (entry: LegendEntry) => {
    if (!scene) return;
    const back = centredKey === entry.key;
    scene.focus(back ? [] : entry.positions);
    setCentredOn(back ? undefined : { scene, key: entry.key });
    // the pointer or the focus is still on the entry: at the zoom a centred entry is seen at,
    // the marker would veil the residues it points at
    emphasise(entry, back);
  };
  const point = (by: "pointer" | "keyboard", entry?: LegendEntry) => {
    pointed.current[by] = entry;
    const target = pointed.current.pointer ?? pointed.current.keyboard;
    // the leave or blur of one while the other still points at the same entry changes nothing,
    // and a second call would rebuild the marker
    if (target?.key === emphasisedKey.current) return;
    emphasise(target, !target || target.key !== centredKey);
  };
  const holdsCanvas = ["ready", "rendering", "parked"].includes(state.status);

  return (
    <>
      {state.status === "no-webgl" && (
        <Alert severity="warning" sx={{ m: 1 }}>
          This browser could not start WebGL, which the 3D structure viewer needs. Enabling
          hardware acceleration in the browser settings, or opening the chat in another browser,
          usually fixes it.
        </Alert>
      )}
      {state.status === "context-lost" && (
        <Alert
          severity="info"
          sx={{ m: 1 }}
          action={
            <Button color="inherit" size="small" onClick={() => setAttempt((n) => n + 1)}>
              Show again
            </Button>
          }>
          The browser released this structure&apos;s 3D drawing context, which it does when many
          are open at once.
        </Alert>
      )}
      {state.status === "failed" && (
        <Alert severity="error" sx={{ m: 1 }}>
          The structure could not be drawn: {state.message}
        </Alert>
      )}
      <Box sx={{ position: "relative", height: holdsCanvas ? CANVAS_HEIGHT : 0 }}>
        {state.status === "rendering" && <Busy>drawing the structure…</Busy>}
        <Box
          ref={host}
          data-testid="structure-canvas"
          data-state={state.status}
          data-highlighted={scene?.highlighted.join(",")}
          data-colour-theme={scene?.colourTheme}
          data-sphere={scene ? String(scene.sphereDrawn) : undefined}
          data-emphasised={shownEmphasis?.positions.length ? liveSummary(shownEmphasis.positions) : undefined}
          data-emphasis-marker={shownEmphasis?.positions.length ? String(shownEmphasis.marker) : undefined}
          data-live={held ? liveSummary(held.positions) : undefined}
          data-live-drawn={held?.drawn}
          sx={{
            // Mol* positions its canvas absolutely inside this box
            position: "absolute",
            inset: 0,
            visibility: scene ? "visible" : "hidden",
          }}
        />
        {scene && hover && (
          <Typography variant="caption" data-testid="structure-hover" sx={{ ...overlaySx, top: 8 }}>
            {hover}
          </Typography>
        )}
        {scene && (
          <Typography variant="caption" data-testid="structure-hint" sx={{ ...overlaySx, bottom: 8 }}>
            drag to rotate · Ctrl or ⌘ + scroll to zoom
          </Typography>
        )}
      </Box>
      {scene && (
        <Box
          data-testid="structure-legend"
          sx={{
            display: "flex",
            flexWrap: "wrap",
            columnGap: 1.5,
            rowGap: 0.25,
            px: 1.5,
            py: 0.75,
            borderTop: `1px solid ${theme.palette.divider}`,
          }}>
          {scene.plddtLegend.length > 0 && (
            <>
              <Typography variant="caption" color="text.secondary">
                model confidence (pLDDT)
              </Typography>
              {scene.plddtLegend.map(({ name, colour }) => (
                <Swatch key={name} colour={colour}>
                  {PLDDT_RANGES[name] ? `${name.toLowerCase()} (${PLDDT_RANGES[name]})` : name}
                </Swatch>
              ))}
            </>
          )}
          {roles.map((role) => (
            <Swatch key={role} colour={ROLE_COLOURS[role]} round>
              {ROLE_LABELS[role]}
            </Swatch>
          ))}
          {scene.sphereDrawn && spec.sphere && (
            <Swatch colour={NEIGHBOURHOOD_COLOUR} round>
              within {spec.sphere.radius} Å of residue {spec.sphere.centre} (indicative)
            </Swatch>
          )}
          {entries.length > 0 && (
            <Box
              ref={labelList}
              data-testid="structure-legend-labels"
              sx={{
                flexBasis: "100%",
                display: "flex",
                flexWrap: "wrap",
                columnGap: 0.5,
                rowGap: 0.25,
                maxHeight: LABEL_LIST_MAX_HEIGHT,
                overflowY: "auto",
              }}>
              {entries.map((entry) => (
                <LegendButton
                  key={entry.key}
                  entry={entry}
                  marked={markedKeys.has(entry.key)}
                  centred={entry.key === centredKey}
                  onEmphasise={point}
                  onCentre={() => centre(entry)}
                />
              ))}
            </Box>
          )}
          {held?.drawn === "atoms" && (
            <Swatch colour={SELECTION_COLOUR} round>
              selection
            </Swatch>
          )}
          {held?.drawn === "cartoon" && (
            <>
              <Swatch colour={SELECTION_COLOUR}>selection</Swatch>
              <Note>
                the {held.positions.length.toLocaleString()} selected residues are shown by colouring
                the cartoon; a selection of up to {LIVE_ATOMS_MAX} residues is drawn as atoms
              </Note>
            </>
          )}
          {missing > 0 && (
            <Note>
              {missing} of {spec.residues.length} listed residues are outside this model and not
              drawn
            </Note>
          )}
          {unlistedLabels > 0 && (
            <Note>
              {unlistedLabels.toLocaleString()} more labelled residues are not listed here; a label
              shows when the pointer is over its residue
            </Note>
          )}
          {regionsOutside > 0 && (
            <Note>
              {regionsOutside} of {spec.regions.length} regions are outside this model and not shown
            </Note>
          )}
          {spec.omitted.regions > 0 && (
            <Note>
              only the first {spec.regions.length} of {spec.regions.length + spec.omitted.regions}{" "}
              regions are shown
            </Note>
          )}
          {spec.omitted.residues > 0 && (
            <Note>
              only the first {spec.residues.length.toLocaleString()} of{" "}
              {(spec.residues.length + spec.omitted.residues).toLocaleString()} listed residues
              are drawn
            </Note>
          )}
          {spec.sphere && !scene.sphereDrawn && (
            <Note>the neighbourhood centre (residue {spec.sphere.centre}) is outside this model</Note>
          )}
        </Box>
      )}
    </>
  );
};

const Model = ({
  spec,
  seen,
  near,
  live,
  onResidue,
}: { spec: ViewSpec; seen: boolean; near: boolean } & HostLink) => {
  const model = useStructureModel(spec.modelFileId, seen);

  // not yet scrolled to: hold the space, fetch nothing
  if (!seen) return <Box sx={{ height: CANVAS_HEIGHT }} />;
  if (model.isPending) return <Busy>loading structure {spec.modelFileId}…</Busy>;
  if (model.error instanceof StructureModelNotFound) {
    return (
      <Alert severity="warning" sx={{ m: 1 }}>
        The model {spec.modelFileId} is not in the current protein-structure release, so this
        view cannot be drawn.
      </Alert>
    );
  }
  if (model.error instanceof StructureReleaseUnavailable) {
    return (
      <Alert severity="info" sx={{ m: 1 }}>
        Protein structures are not available on this server right now. Try again in a few
        minutes.
      </Alert>
    );
  }
  if (model.isError) {
    return (
      <Alert severity="error" sx={{ m: 1 }}>
        Failed to load the structure: {model.error.message}
      </Alert>
    );
  }
  return <Canvas spec={spec} pdbText={model.data} active={near} live={live} onResidue={onResidue} />;
};

const Attribution = ({ modelFileId }: { modelFileId: string }) => {
  const source = modelSource(modelFileId);
  if (source === "alphafold-db") {
    return (
      <>
        Predicted structure from the{" "}
        <Link href="https://alphafold.ebi.ac.uk" target="_blank" rel="noopener noreferrer">
          AlphaFold Protein Structure Database
        </Link>
        , © DeepMind Technologies Limited,{" "}
        <Link href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">
          CC-BY 4.0
        </Link>
        .
      </>
    );
  }
  if (source === "alphafold-server") return <>Predicted structure: {AF3_SOURCE_LABEL}.</>;
  return <>Predicted structure; its source is not recorded in the model id.</>;
};

// the model text is the one the scene was drawn from: same query, so no second request
const ModelDownloads = ({ spec, seen }: { spec: ViewSpec; seen: boolean }) => {
  const model = useStructureModel(spec.modelFileId, seen);
  if (model.data === undefined) return null;
  const pdbText = model.data;
  return (
    <>
      {" · "}
      <Link
        component="button"
        type="button"
        variant="caption"
        onClick={() => downloadBlob(pdbText, pdbFileName(spec.modelFileId), "chemical/x-pdb")}>
        Download the model (PDB)
      </Link>
      {" · "}
      <Link
        component="button"
        type="button"
        variant="caption"
        onClick={() => downloadBlob(viewSpecToPml(spec), `${spec.modelFileId}.pml`, "text/plain")}>
        Download the PyMOL script (.pml)
      </Link>
      <Box component="span" sx={{ display: "block", mt: 0.25 }}>
        The PDB file is the model alone; the .pml script, saved beside it and opened in PyMOL,
        adds this view&apos;s colouring, highlighted residues and labels.
      </Box>
    </>
  );
};

/**
 * The 3D structure a `.structure-view.json` chat artifact describes. `data` is the artifact's
 * base64 as the message carries it.
 *
 * Default export because the chat loads it lazily; Mol* is a further dynamic import behind
 * a spec that parsed, a model that arrived and a viewer that is near the viewport.
 */
export default function StructureViewer({ name, data }: { name: string; data: string }) {
  const theme = useTheme();
  const frame = useRef<HTMLDivElement>(null);
  const { near, seen } = useNearViewport(frame);
  const parsed = useMemo<ViewSpecResult>(() => {
    // measured on the base64, before anything is decoded or parsed
    if (base64ByteLength(data) > MAX_SPEC_BYTES) {
      return { ok: false, reason: "invalid", message: "the view is larger than 1 MB" };
    }
    const text = decodeUtf8(data);
    return text === null
      ? { ok: false, reason: "invalid", message: "the view is not readable text" }
      : parseViewSpecText(text);
  }, [data]);

  const spec = parsed.ok ? parsed.spec : undefined;
  const border = `1px solid ${theme.palette.divider}`;
  return (
    <Box
      ref={frame}
      data-testid="structure-viewer"
      sx={{ my: 1.5, border, borderRadius: 1, overflow: "hidden", width: "100%", maxWidth: 760 }}>
      {spec ? (
        <>
          <Typography variant="body2" sx={{ px: 1.5, py: 0.75, fontWeight: 500, borderBottom: border }}>
            {[spec.gene, spec.accession, spec.modelFileId].filter(Boolean).join(" · ")}
          </Typography>
          <Model spec={spec} seen={seen} near={near} />
        </>
      ) : (
        <Alert severity="warning" sx={{ m: 1 }} data-testid="structure-view-invalid">
          {!parsed.ok && parsed.reason === "unsupported-version"
            ? parsed.message
            : `The structure view ${name} cannot be shown: ${!parsed.ok ? parsed.message : ""}.`}
        </Alert>
      )}
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        data-testid="structure-footer"
        sx={{ px: 1.5, py: 0.75, borderTop: border }}>
        {spec && (
          <>
            <Attribution modelFileId={spec.modelFileId} />{" "}
          </>
        )}
        <Link
          component="button"
          type="button"
          variant="caption"
          onClick={() => downloadBlob(base64ToBytes(data), name, "application/json")}>
          Download the view spec
        </Link>
        {spec && <ModelDownloads spec={spec} seen={seen} />}
      </Typography>
    </Box>
  );
}

/**
 * The same viewer for a page that builds the view itself and stays linked to it: `live` is
 * the page's current selection, applied without rebuilding the scene, and `onResidue` hears
 * which residue the pointer is over or clicked. A new `spec` object is a new scene, so the
 * host keeps it stable for as long as the same model is shown.
 */
export function StructureView({ spec, live, onResidue }: { spec: ViewSpec } & HostLink) {
  const theme = useTheme();
  const frame = useRef<HTMLDivElement>(null);
  const { near, seen } = useNearViewport(frame);
  const border = `1px solid ${theme.palette.divider}`;
  return (
    <Box
      ref={frame}
      data-testid="structure-viewer"
      sx={{ my: 1.5, border, borderRadius: 1, overflow: "hidden", width: "100%", maxWidth: 760 }}>
      <Typography variant="body2" sx={{ px: 1.5, py: 0.75, fontWeight: 500, borderBottom: border }}>
        {[spec.gene, spec.accession, spec.modelFileId].filter(Boolean).join(" · ")}
      </Typography>
      <Model spec={spec} seen={seen} near={near} live={live} onResidue={onResidue} />
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        data-testid="structure-footer"
        sx={{ px: 1.5, py: 0.75, borderTop: border }}>
        <Attribution modelFileId={spec.modelFileId} />
      </Typography>
    </Box>
  );
}
