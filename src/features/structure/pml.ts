import type { ViewSpec } from "./viewSpec";

// the AlphaFold pLDDT bands, lowest first: each later one recolours what scores above it
const PLDDT_BANDS: [above: number | null, name: string, colour: string][] = [
  [null, "plddt_very_low", "#ff7d45"],
  [50, "plddt_low", "#ffdb13"],
  [70, "plddt_confident", "#65cbf3"],
  [90, "plddt_very_high", "#0053d6"],
];
const OBJECT = "structure";
const RESIDUES_PER_LINE = 50;

// as 0-1 fractions: PyMOL reads a triple with no channel above 1 as fractions whatever was
// meant, so 0-255 integers would turn #010101 white
const rgb = (colour: string): string =>
  `[${[1, 3, 5].map((i) => (parseInt(colour.slice(i, i + 2), 16) / 255).toFixed(4)).join(", ")}]`;

/** `text` as a single-quoted Python string literal of printable ASCII only. */
export const pyLiteral = (text: string): string => {
  let out = "'";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\\" || ch === "'") out += `\\${ch}`;
    else if (cp >= 0x20 && cp <= 0x7e) out += ch;
    else if (cp < 0x100) out += `\\x${cp.toString(16).padStart(2, "0")}`;
    else if (cp < 0x10000) out += `\\u${cp.toString(16).padStart(4, "0")}`;
    else out += `\\U${cp.toString(16).padStart(8, "0")}`;
  }
  return `${out}'`;
};

/** The file name the script loads, which is the name the viewer saves the model under. */
export const pdbFileName = (modelFileId: string): string => `${modelFileId}.pdb`;

/**
 * The spec's marking as a PyMOL script: the cartoon by pLDDT band or plain grey, a sphere on
 * the Cα of each marked residue in its colour, the labels, and a selection named
 * `neighbourhood` for the sphere. Regions are not written. The script loads the model from
 * `pdbFileName(spec.modelFileId)` in the directory PyMOL is run in.
 */
export const viewSpecToPml = (spec: ViewSpec): string => {
  const modelFile = pdbFileName(spec.modelFileId);
  const lines = [
    `# PyMOL script for model file ${spec.modelFileId}.`,
    `# It loads ${modelFile} from the directory PyMOL is run in.`,
    "# Residue numbers are those of that file.",
    `load ${modelFile}, ${OBJECT}`,
    `hide everything, ${OBJECT}`,
    `show cartoon, ${OBJECT}`,
  ];
  if (spec.colourMode === "plddt") {
    for (const [above, name, colour] of PLDDT_BANDS) {
      lines.push(`set_color ${name}, ${rgb(colour)}`);
      lines.push(`color ${name}, ${OBJECT}${above === null ? "" : ` and b > ${above}`}`);
    }
  } else {
    lines.push(`color grey80, ${OBJECT}`);
  }

  const byColour = new Map<string, number[]>();
  for (const r of spec.residues) {
    byColour.set(r.colour, [...(byColour.get(r.colour) ?? []), r.filePosition]);
  }
  for (const [colour, positions] of byColour) {
    const name = `highlight_${colour.slice(1)}`;
    lines.push(`set_color ${name}, ${rgb(colour)}`);
    for (let i = 0; i < positions.length; i += RESIDUES_PER_LINE) {
      const resi = positions.slice(i, i + RESIDUES_PER_LINE).join("+");
      lines.push(`show spheres, ${OBJECT} and name CA and resi ${resi}`);
      lines.push(`color ${name}, ${OBJECT} and name CA and resi ${resi}`);
    }
  }
  if (spec.sphere) {
    lines.push(
      `select neighbourhood, byres ((${OBJECT} and name CA) within ${spec.sphere.radius.toFixed(3)} ` +
        `of (${OBJECT} and name CA and resi ${spec.sphere.centre}))`,
    );
    lines.push("deselect");
  }
  const labelled = spec.residues.filter((r) => r.label?.trim());
  if (labelled.length) {
    // a label is text a model wrote. PyMOL evaluates a label as a Python expression and its
    // command parser splits on characters a label may hold, so each goes in as a Python
    // string literal inside a python block, itself holding the literal PyMOL evaluates:
    // nothing in it can end the literal, the statement or the line
    lines.push("python", "from pymol import cmd");
    for (const r of labelled) {
      const selection = `${OBJECT} and name CA and resi ${r.filePosition}`;
      lines.push(`cmd.label('${selection}', ${pyLiteral(pyLiteral(r.label!))})`);
    }
    lines.push("python end");
  }
  lines.push(`orient ${OBJECT}`);
  return `${lines.join("\n")}\n`;
};
