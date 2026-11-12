import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, CircularProgress, Link, Typography, useTheme } from "@mui/material";
import { downloadBlob } from "../chat/downloadBlob";
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
    (async () => {
      const { createScene, WebGLUnavailableError } = await import("./molstarScene");
      try {
        if (disposed || !host.current) return;
        scene = await createScene(host.current, pdbText, spec, {
          onHover: (text) => {
            if (!disposed) setHover(text);
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
  const labelled = spec.residues.filter((r) => r.drawLabel).length;
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
          data-labels={scene?.labelsDrawn}
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
          {spec.omitted.residues > 0 && (
            <Note>
              only the first {spec.residues.length.toLocaleString()} of{" "}
              {(spec.residues.length + spec.omitted.residues).toLocaleString()} listed residues
              are drawn
            </Note>
          )}
          {spec.omitted.labels > 0 && (
            <Note>
              only the first {labelled} of {labelled + spec.omitted.labels} labels are drawn;
              hover a residue for its label
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
        . Jumper et al.,{" "}
        <Link href="https://doi.org/10.1038/s41586-021-03819-2" target="_blank" rel="noopener noreferrer">
          Nature 596, 583–589 (2021)
        </Link>
        .
      </>
    );
  }
  if (source === "alphafold-server") return <>Predicted structure: {AF3_SOURCE_LABEL}.</>;
  return <>Predicted structure; its source is not recorded in the model id.</>;
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
