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
import { PLDDTConfidenceColorThemeProvider } from "molstar/lib/extensions/model-archive/quality-assessment/color/plddt";
import {
  Structure,
  StructureElement,
  StructureProperties,
  StructureSelection,
} from "molstar/lib/mol-model/structure";
import { Loci } from "molstar/lib/mol-model/loci";
import { Shape } from "molstar/lib/mol-model/shape";
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import type { Expression } from "molstar/lib/mol-script/language/expression";
import { Script } from "molstar/lib/mol-script/script";
import { ShapeRepresentation } from "molstar/lib/mol-repr/shape/representation";
import { Mesh } from "molstar/lib/mol-geo/geometry/mesh/mesh";
import { Text } from "molstar/lib/mol-geo/geometry/text/text";
import { TextBuilder } from "molstar/lib/mol-geo/geometry/text/text-builder";
import { Binding } from "molstar/lib/mol-util/binding";
import { ButtonsType, ModifiersKeys } from "molstar/lib/mol-util/input/input-observer";
import { MeshBuilder } from "molstar/lib/mol-geo/geometry/mesh/mesh-builder";
import { addSphere } from "molstar/lib/mol-geo/geometry/mesh/builder/sphere";
import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";
import { Color } from "molstar/lib/mol-util/color";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra";
import { NEIGHBOURHOOD_COLOUR, type ViewSpec } from "./viewSpec";

export interface SceneEvents {
  /** what the pointer is over ("LYS 22 · p.K22R"), or null when it is over nothing */
  onHover: (text: string | null) => void;
  /** the browser took the WebGL context away; the canvas is blank from here on */
  onContextLost: () => void;
}

export class WebGLUnavailableError extends Error {}

export interface Scene {
  /** file positions of the spec's residues that Mol* holds a highlight component for */
  highlighted: number[];
  /** the cartoon's colour theme as Mol* resolved it */
  colourTheme: string;
  sphereDrawn: boolean;
  labelsDrawn: number;
  /** the pLDDT theme's own legend rows; empty when the cartoon is not coloured by it */
  plddtLegend: { name: string; colour: string }[];
  dispose: () => void;
}

const HIGHLIGHT_TAG = "view-spec-highlight";
const UNIFORM_CARTOON = Color(0xb0b8c0);
const SPHERE_OPACITY = 0.22;

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

const sphereRepresentation = async (centre: Vec3, radius: number, label: string) => {
  const colour = hex(NEIGHBOURHOOD_COLOUR);
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
  await repr.createOrUpdate({ ...PD.getDefaultValues(Mesh.Params), alpha: SPHERE_OPACITY }, data).run();
  // the sphere surrounds the residues it is about; pickable, it would take their hover
  repr.setState({ pickable: false });
  return repr;
};

interface LabelItem {
  text: string;
  centre: Vec3;
  radius: number;
}

// every label in one text geometry: a state node per label costs a state update each, which
// is seconds for a few dozen
const labelRepresentation = async (items: LabelItem[], size: number) => {
  const colour = Color(0x111111);
  const repr = ShapeRepresentation<LabelItem[], Text, Text.Params>((_ctx, labels, props, shape) => {
    const builder = TextBuilder.create(props, labels.length * 16, labels.length * 8, shape?.geometry);
    labels.forEach((l, i) =>
      // depth lifts the text towards the camera, clear of the residue's own spheres
      builder.add(l.text, l.centre[0], l.centre[1], l.centre[2], l.radius / 0.9, 1, i),
    );
    return Shape.create(
      "labels",
      labels,
      builder.getText(),
      () => colour,
      () => size,
      (group) => labels[group]?.text ?? "",
    );
  }, Text.Utils);
  await repr
    .createOrUpdate(
      {
        ...PD.getDefaultValues(Text.Params),
        borderColor: Color(0xffffff),
        borderWidth: 0.3,
        background: true,
        backgroundColor: Color(0xffffff),
        backgroundOpacity: 0.75,
        // up and to the right of the residue rather than over it
        attachment: "bottom-left",
      },
      items,
    )
    .run();
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

    // text is sized in ångströms, not pixels, so a fixed size is legible only at one zoom.
    // Scaled to the model instead: about a fourteenth of its diameter in the opening
    // whole-protein view
    const labelSize = Math.min(12, Math.max(1.2, (structure.boundary.sphere.radius * 2) / 14));
    const wanted = new Map(
      spec.residues
        .filter((r) => r.drawLabel && r.label && highlighted.has(r.filePosition))
        .map((r) => [r.filePosition, r.label!.trim()]),
    );
    // one query and one pass over its atoms for every label: a query per label is most of a
    // second each on a large model
    const atoms = new Map<number, Vec3[]>();
    if (wanted.size > 0) {
      StructureElement.Loci.forEachLocation(lociOf(structure, residuesAt([...wanted.keys()])), (l) => {
        const at = StructureProperties.residue.auth_seq_id(l);
        const xyz = Vec3.create(StructureProperties.atom.x(l), StructureProperties.atom.y(l), StructureProperties.atom.z(l));
        atoms.set(at, [...(atoms.get(at) ?? []), xyz]);
      });
    }
    const labels: LabelItem[] = [];
    for (const [at, text] of wanted) {
      const points = atoms.get(at);
      if (!points) continue;
      const centre = Vec3.zero();
      points.forEach((p) => Vec3.scaleAndAdd(centre, centre, p, 1 / points.length));
      const radius = Math.max(...points.map((p) => Vec3.distance(centre, p)));
      labels.push({ text, centre, radius });
    }
    if (labels.length > 0 && plugin.canvas3d) {
      plugin.canvas3d.add(await labelRepresentation(labels, labelSize));
    }

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
    const hover = plugin.behaviors.interaction.hover.subscribe(({ current }) => {
      const { loci } = current;
      const location =
        StructureElement.Loci.is(loci) && !StructureElement.Loci.isEmpty(loci)
          ? StructureElement.Loci.getFirstLocation(loci)
          : undefined;
      if (!location) return events.onHover(null);
      const at = StructureProperties.residue.auth_seq_id(location);
      const name = `${StructureProperties.atom.label_comp_id(location)} ${at}`;
      events.onHover(labelAt.get(at) ? `${name} · ${labelAt.get(at)}` : name);
    });
    const canvas = host.querySelector("canvas");
    const lost = () => events.onContextLost();
    canvas?.addEventListener("webglcontextlost", lost);

    // the canvas resets its camera when the first objects are committed, which would undo a
    // focus requested before that
    plugin.canvas3d?.commit(true);
    plugin.managers.camera.focusLoci(Structure.toStructureElementLoci(structure), {
      extraRadius: 0,
      durationMs: 0,
    });
    return {
      highlighted: [...highlighted].sort((a, b) => a - b),
      colourTheme,
      sphereDrawn,
      labelsDrawn: labels.length,
      plddtLegend,
      dispose: () => {
        hover.unsubscribe();
        canvas?.removeEventListener("webglcontextlost", lost);
        plugin.dispose();
      },
    };
  } catch (e) {
    plugin.dispose();
    throw e;
  }
};
