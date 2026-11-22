/**
 * Everything that touches Mol*. Imported only dynamically (StructureViewer), so this module
 * and Mol* form one chunk that is fetched when a structure is actually drawn.
 *
 * Deep `molstar/lib` imports and no Mol* UI: the plugin is headless and the React side owns
 * every control and message.
 */
import { PluginContext } from "molstar/lib/mol-plugin/context";
import { DefaultPluginSpec } from "molstar/lib/mol-plugin/spec";
import { PluginConfig } from "molstar/lib/mol-plugin/config";
import { PluginBehaviors } from "molstar/lib/mol-plugin/behavior";
import { StateTransforms } from "molstar/lib/mol-plugin-state/transforms";
import { StructureFocusRepresentation } from "molstar/lib/mol-plugin/behavior/dynamic/selection/structure-focus-representation";
import { PLDDTConfidenceColorThemeProvider } from "molstar/lib/extensions/model-archive/quality-assessment/color/plddt";
import {
  Structure,
  StructureElement,
  StructureProperties,
  StructureSelection,
} from "molstar/lib/mol-model/structure";
import { EmptyLoci, Loci } from "molstar/lib/mol-model/loci";
import { Shape } from "molstar/lib/mol-model/shape";
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import type { Expression } from "molstar/lib/mol-script/language/expression";
import { Script } from "molstar/lib/mol-script/script";
import { ShapeRepresentation } from "molstar/lib/mol-repr/shape/representation";
import { Mesh } from "molstar/lib/mol-geo/geometry/mesh/mesh";
import { Binding } from "molstar/lib/mol-util/binding";
import { ButtonsType, ModifiersKeys } from "molstar/lib/mol-util/input/input-observer";
import { MeshBuilder } from "molstar/lib/mol-geo/geometry/mesh/mesh-builder";
import { addSphere } from "molstar/lib/mol-geo/geometry/mesh/builder/sphere";
import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";
import { Color } from "molstar/lib/mol-util/color";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra";
import { LIVE_ATOMS_MAX, NEIGHBOURHOOD_COLOUR, SELECTION_COLOUR, type ViewSpec } from "./viewSpec";

export interface SceneEvents {
  /**
   * what the pointer is over ("LYS 22 · p.K22R") and that residue's file position; both null
   * when it is over nothing
   */
  onHover: (text: string | null, filePosition: number | null) => void;
  /** the browser took the WebGL context away; the canvas is blank from here on */
  onContextLost: () => void;
  /**
   * the residue under the pointer or clicked, by file position; null when a hover leaves the
   * structure. Only a host that wants the residue itself passes it
   */
  onResidue?: (kind: "hover" | "click", filePosition: number | null) => void;
  /** the pointer reached a residue in the canvas and its hover replaced the emphasis */
  onEmphasisEnd?: () => void;
}

export class WebGLUnavailableError extends Error {}

/** how a live selection is on screen: as atoms, as a colour over the cartoon, or not at all */
export type LiveDrawn = "atoms" | "cartoon" | "none";

export interface Scene {
  /** file positions of the spec's residues that Mol* holds a highlight component for */
  highlighted: number[];
  /** the cartoon's colour theme as Mol* resolved it */
  colourTheme: string;
  sphereDrawn: boolean;
  /**
   * per region of the spec, in its order: the file positions the model holds inside it,
   * ascending; empty for a region wholly outside the model
   */
  regions: number[][];
  /** the pLDDT theme's own legend rows; empty when the cartoon is not coloured by it */
  plddtLegend: { name: string; colour: string }[];
  /**
   * Replaces the live selection, which is separate from the spec's highlights, in the running
   * plugin: the model, the cartoon and the camera's owner all stay. `focus` moves the camera
   * to the selection, or back to the whole model when it is empty. Resolves to the file
   * positions the model has among them and to how Mol*'s state tree now shows them.
   */
  setLive: (positions: number[], focus: boolean) => Promise<{ positions: number[]; drawn: LiveDrawn }>;
  /**
   * Makes the residues at these file positions stand out where they are, without moving the
   * camera: Mol*'s highlight over them, with a translucent marker around a set too small to
   * find by its tint unless `marker` is false, and the rest of the scene faded around a set
   * too wide for one. An empty list clears it, and so does the pointer reaching a residue in
   * the canvas, which `onEmphasisEnd` reports. Resolves to the positions the model has among
   * them and to whether the marker is on screen.
   */
  emphasise: (positions: number[], marker?: boolean) => Promise<{ positions: number[]; marker: boolean }>;
  /** moves the camera to these file positions, or back to the whole model when there are none */
  focus: (positions: number[]) => void;
  dispose: () => void;
}

const HIGHLIGHT_TAG = "view-spec-highlight";
const LIVE_TAG = "live-selection";
const REGION_TAG = "view-spec-regions";
const UNIFORM_CARTOON = Color(0xb0b8c0);
const SPHERE_OPACITY = 0.22;
const MARKER_OPACITY = 0.4;
// the emphasis marker's radius as a share of the model's: wide enough to find in the opening
// whole-protein view, where one residue's atoms are a few pixels
const MARKER_MODEL_SHARE = 0.14;
const MARKER_MIN_RADIUS = 6;
// how far everything else fades towards white while a set too wide for the marker is
// emphasised: Mol*'s tint alone is a faint purple on a pLDDT-blue cartoon
const EMPHASIS_DIM = 0.65;

const hex = (colour: string): Color => Color.fromHexStyle(colour);

// a PDB carries one residue number per residue and Mol* keeps it verbatim as auth_seq_id;
// label_seq_id is re-derived on import (linearised when insertion codes or SEQRES are
// present), so it is not the number the file wrote
const residuesAt = (positions: number[], caOnly = false): Expression =>
  MS.struct.generator.atomGroups({
    "residue-test": MS.core.set.has([
      MS.set(...positions),
      MS.struct.atomProperty.macromolecular.auth_seq_id(),
    ]),
    ...(caOnly
      ? { "atom-test": MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_atom_id(), "CA"]) }
      : {}),
  });

const lociOf = (structure: Structure, expression: Expression): StructureElement.Loci =>
  StructureSelection.toLociWithSourceUnits(Script.getStructureSelection(expression, structure));

const positionsIn = (structure: Structure): number[] => {
  const seen = new Set<number>();
  Structure.eachAtomicHierarchyElement(structure, {
    residue: (loc) => seen.add(StructureProperties.residue.auth_seq_id(loc)),
  });
  return [...seen];
};

const sphereRepresentation = async (
  centre: Vec3,
  radius: number,
  label: string,
  colour = hex(NEIGHBOURHOOD_COLOUR),
  alpha = SPHERE_OPACITY,
) => {
  // ShapeRepresentation builds nothing for falsy data, so the sphere travels as the data
  const data = { centre, radius };
  const repr = ShapeRepresentation<typeof data, Mesh, Mesh.Params>((_ctx, sphere, _props, shape) => {
    const state = MeshBuilder.createState(2048, 1024, shape?.geometry);
    state.currentGroup = 0;
    addSphere(state, sphere.centre, sphere.radius, 3);
    return Shape.create(
      label,
      sphere,
      MeshBuilder.getMesh(state),
      () => colour,
      () => 1,
      () => label,
    );
  }, Mesh.Utils);
  await repr.createOrUpdate({ ...PD.getDefaultValues(Mesh.Params), alpha }, data).run();
  // the sphere surrounds the residues it is about; pickable, it would take their hover
  repr.setState({ pickable: false });
  return repr;
};

export const createScene = async (
  host: HTMLElement,
  pdbText: string,
  spec: ViewSpec,
  events: SceneEvents,
): Promise<Scene> => {
  const pluginSpec = DefaultPluginSpec();
  // Mol* asks for failIfMajorPerformanceCaveat by default, which refuses software GL:
  // virtual machines, remote desktops and headless browsers would get no structure at all
  pluginSpec.config = [
    ...(pluginSpec.config ?? []),
    [PluginConfig.General.AllowMajorPerformanceCaveat, true],
  ];
  // a click normally makes Mol* build its own focus representation around the residue, as a
  // state update of its own. A linked host answers the same click with setLive, and two
  // updates built from one tree undo each other's nodes, so there the host's selection is
  // the only thing a click draws. Mol* would also centre the camera on the clicked residue:
  // the reader is already looking at it, and the host moves the camera only for a selection
  // made somewhere the reader was not looking
  if (events.onResidue) {
    pluginSpec.behaviors = pluginSpec.behaviors.filter(
      (b) =>
        b.transformer !== StructureFocusRepresentation &&
        b.transformer !== PluginBehaviors.Camera.FocusLoci,
    );
  }
  const plugin = new PluginContext(pluginSpec);
  try {
    await plugin.init();
    if (!(await plugin.mountAsync(host))) {
      throw new WebGLUnavailableError("could not create a WebGL rendering context");
    }

    // the theme alone, without the model-archive behaviour around it: on a model with no
    // ma_qa_metric table (any PDB) it colours by B-factor, which is where AlphaFold writes
    // pLDDT, using the AlphaFold bands
    const themes = plugin.representation.structure.themes.colorThemeRegistry;
    if (!themes.has(PLDDTConfidenceColorThemeProvider)) themes.add(PLDDTConfidenceColorThemeProvider);

    const builders = plugin.builders;
    const data = await builders.data.rawData({ data: pdbText, label: spec.modelFileId });
    const trajectory = await builders.structure.parseTrajectory(data, "pdb");
    const model = await builders.structure.createModel(trajectory);
    const structureCell = await builders.structure.createStructure(model);
    const structure = structureCell.data;
    if (!structure) throw new Error("the model file holds no structure");

    let cartoonRef: string | undefined;
    let colourTheme = "uniform";
    let plddtLegend: Scene["plddtLegend"] = [];
    const polymer = await builders.structure.tryCreateComponentStatic(structureCell, "polymer");
    if (polymer) {
      const usePlddt =
        spec.colourMode === "plddt" &&
        PLDDTConfidenceColorThemeProvider.isApplicable({ structure });
      const cartoon = await builders.structure.representation.addRepresentation(
        polymer,
        usePlddt
          ? { type: "cartoon", color: PLDDTConfidenceColorThemeProvider.name as "uniform" }
          : { type: "cartoon", color: "uniform", colorParams: { value: UNIFORM_CARTOON } },
      );
      cartoonRef = cartoon.ref;
      colourTheme = cartoon.cell?.transform.params?.colorTheme.name ?? colourTheme;
      const legend = usePlddt
        ? PLDDTConfidenceColorThemeProvider.factory({ structure }, PLDDTConfidenceColorThemeProvider.defaultValues).legend
        : undefined;
      if (legend?.kind === "table-legend") {
        plddtLegend = legend.table
          // the theme's row for a negative score, which an AlphaFold B-factor column never holds
          .filter(([name]) => name !== "No Score")
          .map(([name, colour]) => ({ name, colour: Color.toHexStyle(colour as Color) }));
      }
    }

    // one component per colour rather than per residue: a spec can list a whole
    // neighbourhood, and each component is a state node and a draw call
    const byColour = new Map<string, number[]>();
    for (const r of spec.residues) {
      byColour.set(r.colour, [...(byColour.get(r.colour) ?? []), r.filePosition]);
    }
    const highlighted = new Set<number>();
    for (const [colour, positions] of byColour) {
      const component = await builders.structure.tryCreateComponentFromExpression(
        structureCell,
        residuesAt(positions),
        `${HIGHLIGHT_TAG}-${colour}`,
        { label: `highlight ${colour}`, tags: [HIGHLIGHT_TAG] },
      );
      if (!component) continue;
      await builders.structure.representation.addRepresentation(component, {
        type: "spacefill",
        color: "uniform",
        colorParams: { value: hex(colour) },
      });
    }
    // read back from the state tree, so what is reported is what Mol* holds, not what was asked
    for (const cell of plugin.state.data.selectQ((q) => q.root.subtree().withTag(HIGHLIGHT_TAG))) {
      const held = cell.obj?.data;
      if (held instanceof Structure) positionsIn(held).forEach((p) => highlighted.add(p));
    }

    const inModel = positionsIn(structure).sort((a, b) => a - b);
    const regions = spec.regions.map((r) => inModel.filter((p) => p >= r.start && p <= r.end));
    // in spec order, so where two coloured regions overlap the later one's colour shows
    const regionLayers = spec.regions.flatMap((r, i) =>
      r.colour && regions[i].length > 0
        ? [
            {
              bundle: StructureElement.Bundle.fromLoci(lociOf(structure, residuesAt(regions[i]))),
              color: hex(r.colour),
              clear: false,
            },
          ]
        : [],
    );
    type OverpaintLayer = (typeof regionLayers)[number];
    // a representation shows one overpaint node's layers, not the sum of several, so the
    // regions and a long live selection always travel in the same node
    const overpaint = async (layers: OverpaintLayer[], tag: string) => {
      if (!cartoonRef || layers.length === 0) return;
      await plugin
        .build()
        .to(cartoonRef)
        .apply(StateTransforms.Representation.OverpaintStructureRepresentation3DFromBundle, { layers }, { tags: tag })
        .commit();
    };
    await overpaint(regionLayers, REGION_TAG);

    let sphereDrawn = false;
    if (spec.sphere) {
      const centre = Loci.getBoundingSphere(lociOf(structure, residuesAt([spec.sphere.centre], true)));
      if (centre && plugin.canvas3d) {
        // added to the canvas directly: a translucent mesh needs no state node, and going
        // through MolViewSpec primitives for it would pull that whole extension into the chunk
        plugin.canvas3d.add(
          await sphereRepresentation(
            centre.center,
            spec.sphere.radius,
            `within ${spec.sphere.radius} Å of residue ${spec.sphere.centre}`,
          ),
        );
        sphereDrawn = true;
      }
    }

    const wheelZoom = (modifiers: Partial<ModifiersKeys>) =>
      Binding.Trigger(ButtonsType.Flag.Auxilary, ModifiersKeys.create(modifiers));
    // no axes gizmo: there is no Mol* UI around the canvas to explain it
    plugin.canvas3d?.setProps({ camera: { helper: { axes: { name: "off", params: {} } } } });
    // the wheel belongs to the page: StructureViewer lets it through to Mol* only with Ctrl
    // or ⌘ held, and Mol*'s default zoom binding is the wheel with no modifier
    plugin.canvas3d?.setAttribs({
      trackball: {
        bindings: {
          ...plugin.canvas3d.attribs.trackball.bindings,
          scrollZoom: Binding([wheelZoom({ control: true }), wheelZoom({ meta: true })], "Zoom", "Scroll with Ctrl or ⌘ held"),
          scrollFocus: Binding.Empty,
        },
      },
    });

    const labelAt = new Map(spec.residues.map((r) => [r.filePosition, r.label?.trim()]));
    const locationOf = (loci: Loci) =>
      StructureElement.Loci.is(loci) && !StructureElement.Loci.isEmpty(loci)
        ? StructureElement.Loci.getFirstLocation(loci)
        : undefined;
    const hover = plugin.behaviors.interaction.hover.subscribe(({ current }) => {
      const location = locationOf(current.loci);
      if (!location) {
        events.onResidue?.("hover", null);
        return events.onHover(null, null);
      }
      const at = StructureProperties.residue.auth_seq_id(location);
      const name = `${StructureProperties.atom.label_comp_id(location)} ${at}`;
      events.onResidue?.("hover", at);
      events.onHover(labelAt.get(at) ? `${name} · ${labelAt.get(at)}` : name, at);
    });
    const { onResidue } = events;
    const click = onResidue
      ? plugin.behaviors.interaction.click.subscribe(({ current }) => {
          const location = locationOf(current.loci);
          if (location) onResidue("click", StructureProperties.residue.auth_seq_id(location));
        })
      : undefined;

    const whole = Structure.toStructureElementLoci(structure);
    const tagged = (tag = LIVE_TAG) => plugin.state.data.selectQ((q) => q.root.subtree().withTag(tag));
    const applyLive = async (
      positions: number[],
      focus: boolean,
    ): Promise<{ positions: number[]; drawn: LiveDrawn }> => {
      const stale = [...tagged(), ...tagged(REGION_TAG)];
      if (stale.length > 0) {
        const update = plugin.build();
        stale.forEach((cell) => update.delete(cell.transform.ref));
        await update.commit();
      }
      const loci = positions.length > 0 ? lociOf(structure, residuesAt(positions)) : undefined;
      const held =
        loci && !StructureElement.Loci.isEmpty(loci)
          ? positionsIn(StructureElement.Loci.toStructure(loci)).sort((a, b) => a - b)
          : [];
      const onCartoon = loci && held.length > LIVE_ATOMS_MAX && cartoonRef;
      if (onCartoon) {
        const layer = {
          bundle: StructureElement.Bundle.fromLoci(loci),
          color: hex(SELECTION_COLOUR),
          clear: false,
        };
        await overpaint([...regionLayers, layer], LIVE_TAG);
      } else {
        await overpaint(regionLayers, REGION_TAG);
      }
      if (!onCartoon && held.length > 0) {
        const component = await builders.structure.tryCreateComponentFromExpression(
          structureCell,
          residuesAt(held),
          LIVE_TAG,
          { label: "selection", tags: [LIVE_TAG] },
        );
        if (component?.data) {
          await builders.structure.representation.addRepresentation(component, {
            type: "spacefill",
            color: "uniform",
            colorParams: { value: hex(SELECTION_COLOUR) },
          });
        }
      }
      if (focus) {
        plugin.managers.camera.focusLoci(loci && held.length > 0 ? loci : whole, {
          extraRadius: held.length > 0 ? 8 : 0,
          durationMs: 250,
        });
      }
      // read back from the state tree: a structure cell is the atoms component, anything else
      // under the tag is the cartoon's overpaint
      const cells = tagged();
      const drawn: LiveDrawn =
        cells.length === 0 ? "none" : cells.some((c) => c.obj?.data instanceof Structure) ? "atoms" : "cartoon";
      return { positions: drawn === "none" ? [] : held, drawn };
    };
    const lociAt = (positions: number[]) => {
      const loci = positions.length > 0 ? lociOf(structure, residuesAt(positions)) : undefined;
      return loci && !StructureElement.Loci.isEmpty(loci) ? loci : undefined;
    };
    const markerRadius = Math.max(MARKER_MIN_RADIUS, structure.boundary.sphere.radius * MARKER_MODEL_SHARE);
    let marker: Awaited<ReturnType<typeof sphereRepresentation>> | undefined;
    // building the marker is asynchronous, so a later call can overtake an earlier one
    let emphasisRun = 0;
    const dropMarker = () => {
      if (!marker) return;
      plugin.canvas3d?.remove(marker);
      marker.destroy();
      marker = undefined;
    };
    // a renderer setting that fades whatever is not highlighted, so it has to go off with the
    // emphasis: left on, an ordinary pointer hover over one residue would fade the whole
    // structure. Every path that ends an emphasis goes through endEmphasis
    const dim = (on: boolean) => plugin.canvas3d?.setProps({ renderer: { dimStrength: on ? EMPHASIS_DIM : 0 } });
    const highlights = plugin.managers.interactivity.lociHighlights;
    let emphasised: StructureElement.Loci | undefined;
    const endEmphasis = () => {
      // a marker still being built finds itself overtaken
      emphasisRun++;
      dropMarker();
      dim(false);
      emphasised = undefined;
    };
    const emphasise = async (positions: number[], withMarker = true) => {
      endEmphasis();
      const run = emphasisRun;
      const loci = lociAt(positions);
      if (!loci) {
        highlights.clearHighlights();
        return { positions: [], marker: false };
      }
      // the loci is whole residues already, so the plugin's granularity has nothing to widen
      highlights.highlightOnly({ loci }, false);
      emphasised = loci;
      const held = positionsIn(StructureElement.Loci.toStructure(loci)).sort((a, b) => a - b);
      const bounds = Loci.getBoundingSphere(loci);
      const wide = bounds !== undefined && bounds.radius >= markerRadius;
      dim(wide);
      // a sphere around a set already wider than the marker would only hide the structure
      if (!withMarker || !bounds || wide || !plugin.canvas3d) {
        return { positions: held, marker: false };
      }
      const built = await sphereRepresentation(
        bounds.center,
        markerRadius,
        "emphasis",
        // the tint and the marker are one signal, so they share Mol*'s highlight colour
        plugin.canvas3d.props.renderer.highlightColor,
        MARKER_OPACITY,
      );
      if (run !== emphasisRun) {
        built.destroy();
        return { positions: held, marker: false };
      }
      plugin.canvas3d.add(built);
      marker = built;
      return { positions: held, marker: true };
    };
    // Mol* owns the highlight too and rewrites it on every hover it emits; its own behaviour
    // subscribed first, so by the time this runs the emphasis highlight is already replaced.
    // A hover that moved onto a residue is the pointer taking over. Any other is Mol* repeating
    // itself: a modifier key re-emits the previous loci, empty while the pointer is off the
    // canvas, and that must not cost a legend entry its highlight
    let hovered: Loci = EmptyLoci;
    let restoring = false;
    const takeover = plugin.behaviors.interaction.hover.subscribe(({ current }) => {
      const moved = !Loci.areEqual(current.loci, hovered);
      hovered = current.loci;
      // highlighting emits no hover today; the flag keeps it from looping if it ever does
      if (!emphasised || restoring) return;
      if (moved && locationOf(current.loci)) {
        endEmphasis();
        events.onEmphasisEnd?.();
        return;
      }
      restoring = true;
      try {
        highlights.highlightOnly({ loci: emphasised }, false);
      } finally {
        restoring = false;
      }
    });
    const focus = (positions: number[]) => {
      const loci = lociAt(positions);
      plugin.managers.camera.focusLoci(loci ?? whole, { extraRadius: loci ? 8 : 0, durationMs: 250 });
    };

    // one update at a time: two interleaved would each delete what the other had just built
    let liveQueue: Promise<unknown> = Promise.resolve();
    const canvas = host.querySelector("canvas");
    const lost = () => events.onContextLost();
    canvas?.addEventListener("webglcontextlost", lost);

    // the canvas resets its camera when the first objects are committed, which would undo a
    // focus requested before that
    plugin.canvas3d?.commit(true);
    plugin.managers.camera.focusLoci(whole, { extraRadius: 0, durationMs: 0 });
    return {
      highlighted: [...highlighted].sort((a, b) => a - b),
      colourTheme,
      sphereDrawn,
      regions,
      plddtLegend,
      setLive: (positions, focus) => {
        const run = liveQueue.catch(() => undefined).then(() => applyLive(positions, focus));
        liveQueue = run;
        return run;
      },
      emphasise,
      focus,
      dispose: () => {
        // a marker still being built finds itself overtaken and is not added to a dead canvas
        emphasisRun++;
        hover.unsubscribe();
        takeover.unsubscribe();
        click?.unsubscribe();
        canvas?.removeEventListener("webglcontextlost", lost);
        plugin.dispose();
      },
    };
  } catch (e) {
    plugin.dispose();
    throw e;
  }
};
