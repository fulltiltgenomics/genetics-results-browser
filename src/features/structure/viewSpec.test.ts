import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AF3_SOURCE_LABEL,
  MAX_LABELS,
  MAX_POSITION,
  MAX_RESIDUES,
  MAX_SPHERE_RADIUS,
  MAX_TEXT_LENGTH,
  MODEL_FILE_ID_RE,
  VIEW_COLOUR_MODES,
  VIEW_DEFAULT_COLOUR_MODE,
  modelSource,
  NEIGHBOURHOOD_COLOUR,
  ROLE_COLOURS,
  VIEW_ROLES,
  VIEW_SPEC_VERSION,
  isStructureViewName,
  parseViewSpec,
  parseViewSpecText,
} from "./viewSpec";

// the example in genetics-results-munge's docs/protein-structure.md, verbatim
const DOC_EXAMPLE = {
  version: 1,
  model_file_id: "AF-Q9HCU4-F2-model_v6",
  accession: "Q9HCU4",
  gene: "CELSR2",
  residues: [
    { file_position: 412, label: "p.R612W", role: "case" },
    { file_position: 415, colour: "#d62728" },
  ],
  sphere: { centre: 412, radius: 15.0 },
  colour_mode: "plddt",
};

const specOf = (raw: unknown) => {
  const result = parseViewSpec(raw);
  if (!result.ok) throw new Error(`expected a valid spec, got: ${result.message}`);
  return result.spec;
};
const failureOf = (raw: unknown) => {
  const result = parseViewSpec(raw);
  if (result.ok) throw new Error("expected the spec to be refused");
  return result;
};

describe("parseViewSpec", () => {
  it("reads the contract's example", () => {
    expect(specOf(DOC_EXAMPLE)).toEqual({
      version: 1,
      modelFileId: "AF-Q9HCU4-F2-model_v6",
      accession: "Q9HCU4",
      gene: "CELSR2",
      residues: [
        { filePosition: 412, label: "p.R612W", role: "case", colour: ROLE_COLOURS.case, drawLabel: true },
        { filePosition: 415, label: undefined, colour: "#d62728", drawLabel: false },
      ],
      omitted: { residues: 0, labels: 0 },
      sphere: { centre: 412, radius: 15 },
      colourMode: "plddt",
    });
  });

  it("needs only version and model_file_id, and defaults to pLDDT colouring", () => {
    expect(specOf({ version: 1, model_file_id: "AF-P42263-F1-model_v6" })).toMatchObject({
      residues: [],
      sphere: undefined,
      colourMode: "plddt",
    });
  });

  it("gives every role its own colour, none of them the neighbourhood's", () => {
    const residues = VIEW_ROLES.map((role, i) => ({ file_position: i + 1, role }));
    const colours = specOf({ ...DOC_EXAMPLE, residues }).residues.map((r) => r.colour);
    expect(new Set([...colours, NEIGHBOURHOOD_COLOUR]).size).toBe(VIEW_ROLES.length + 1);
  });

  it("draws a residue with neither role nor colour as neutral", () => {
    const [residue] = specOf({ ...DOC_EXAMPLE, residues: [{ file_position: 7 }] }).residues;
    expect(residue.role).toBeUndefined();
    expect(residue.colour).toBe(ROLE_COLOURS.neutral);
  });

  it("merges entries at one position: the first colour and the first label stand", () => {
    const residues = [
      { file_position: 7, role: "control" },
      { file_position: 7, role: "case", label: "p.A7V" },
      { file_position: 7, label: "second" },
      { file_position: 8 },
    ];
    expect(specOf({ ...DOC_EXAMPLE, residues }).residues).toEqual([
      { filePosition: 7, label: "p.A7V", role: "control", colour: ROLE_COLOURS.control, drawLabel: true },
      { filePosition: 8, label: undefined, colour: ROLE_COLOURS.neutral, drawLabel: false },
    ]);
  });

  it("merges thousands of entries at one position into one residue", () => {
    const residues = Array.from({ length: 3000 }, () => ({ file_position: 5, label: "x" }));
    const spec = specOf({ ...DOC_EXAMPLE, residues });
    expect(spec.residues).toHaveLength(1);
    expect(spec.omitted).toEqual({ residues: 0, labels: 0 });
  });

  it("keeps the first MAX_RESIDUES distinct residues and counts the rest", () => {
    const residues = Array.from({ length: MAX_RESIDUES + 25 }, (_, i) => ({ file_position: i + 1 }));
    const spec = specOf({ ...DOC_EXAMPLE, residues });
    expect(spec.residues).toHaveLength(MAX_RESIDUES);
    expect(spec.residues.at(-1)?.filePosition).toBe(MAX_RESIDUES);
    expect(spec.omitted.residues).toBe(25);
  });

  it("draws the first MAX_LABELS labels, keeps the rest for hover and counts them", () => {
    const residues = Array.from({ length: MAX_LABELS + 3 }, (_, i) => ({ file_position: i + 1, label: `L${i}` }));
    const spec = specOf({ ...DOC_EXAMPLE, residues });
    expect(spec.residues.filter((r) => r.drawLabel)).toHaveLength(MAX_LABELS);
    expect(spec.residues.at(-1)).toMatchObject({ label: `L${MAX_LABELS + 2}`, drawLabel: false });
    expect(spec.omitted.labels).toBe(3);
  });

  it("cuts gene, accession and label to MAX_TEXT_LENGTH with an ellipsis", () => {
    const long = "x".repeat(500);
    const spec = specOf({ ...DOC_EXAMPLE, gene: long, accession: long, residues: [{ file_position: 1, label: long }] });
    for (const text of [spec.gene, spec.accession, spec.residues[0].label]) {
      expect(text).toHaveLength(MAX_TEXT_LENGTH);
      expect(text?.endsWith("…")).toBe(true);
    }
  });

  it("accepts uniform colouring and ignores fields it does not know", () => {
    expect(specOf({ ...DOC_EXAMPLE, colour_mode: "uniform", note: "x" }).colourMode).toBe("uniform");
  });

  it("refuses a newer version with a message that says so", () => {
    const failure = failureOf({ ...DOC_EXAMPLE, version: VIEW_SPEC_VERSION + 1 });
    expect(failure.reason).toBe("unsupported-version");
    expect(failure.message).toMatch(/newer format/);
  });

  it("still reads every version up to the current one", () => {
    for (let version = 1; version <= VIEW_SPEC_VERSION; version++) {
      expect(parseViewSpec({ ...DOC_EXAMPLE, version }).ok).toBe(true);
    }
  });

  it.each([
    ["not an object", [DOC_EXAMPLE]],
    ["null", null],
    ["no version", { ...DOC_EXAMPLE, version: undefined }],
    ["version as text", { ...DOC_EXAMPLE, version: "1" }],
    ["version zero", { ...DOC_EXAMPLE, version: 0 }],
    ["no model_file_id", { ...DOC_EXAMPLE, model_file_id: undefined }],
    ["a model_file_id that would leave the route", { ...DOC_EXAMPLE, model_file_id: "../models" }],
    ["a model_file_id with a query", { ...DOC_EXAMPLE, model_file_id: "AF-1?x=1" }],
    ["residues not a list", { ...DOC_EXAMPLE, residues: { file_position: 1 } }],
    ["a fractional position", { ...DOC_EXAMPLE, residues: [{ file_position: 1.5 }] }],
    ["position zero", { ...DOC_EXAMPLE, residues: [{ file_position: 0 }] }],
    ["an unknown role", { ...DOC_EXAMPLE, residues: [{ file_position: 1, role: "proband" }] }],
    ["role and colour together", { ...DOC_EXAMPLE, residues: [{ file_position: 1, role: "case", colour: "#000000" }] }],
    ["a colour that is not #rrggbb", { ...DOC_EXAMPLE, residues: [{ file_position: 1, colour: "red" }] }],
    ["a label that is not text", { ...DOC_EXAMPLE, residues: [{ file_position: 1, label: 5 }] }],
    ["a sphere with no radius", { ...DOC_EXAMPLE, sphere: { centre: 412 } }],
    ["a sphere with a negative radius", { ...DOC_EXAMPLE, sphere: { centre: 412, radius: -1 } }],
    ["a sphere with no centre", { ...DOC_EXAMPLE, sphere: { radius: 10 } }],
    ["a position above the cap", { ...DOC_EXAMPLE, residues: [{ file_position: MAX_POSITION + 1 }] }],
    ["a sphere centre above the cap", { ...DOC_EXAMPLE, sphere: { centre: MAX_POSITION + 1, radius: 5 } }],
    ["a sphere radius above the cap", { ...DOC_EXAMPLE, sphere: { centre: 412, radius: MAX_SPHERE_RADIUS + 1 } }],
    ["an unknown colour_mode", { ...DOC_EXAMPLE, colour_mode: "rainbow" }],
  ])("refuses %s without throwing", (_what, raw) => {
    const failure = failureOf(raw);
    expect(failure.reason).toBe("invalid");
    expect(failure.message).not.toBe("");
  });
});

describe("parseViewSpecText", () => {
  it("parses JSON text", () => {
    expect(parseViewSpecText(JSON.stringify(DOC_EXAMPLE)).ok).toBe(true);
  });

  it("refuses text that is not JSON", () => {
    expect(parseViewSpecText("{version: 1")).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("isStructureViewName", () => {
  it("matches on the suffix only", () => {
    expect(isStructureViewName("celsr2.structure-view.json")).toBe(true);
    expect(isStructureViewName("CELSR2.Structure-View.JSON")).toBe(true);
    expect(isStructureViewName("structure-view.json")).toBe(false);
    expect(isStructureViewName("celsr2.structure-view.json.txt")).toBe(false);
    expect(isStructureViewName("results.json")).toBe(false);
  });
});

describe("modelSource", () => {
  it("reads the source off the id prefix", () => {
    expect(modelSource("AF-P23297-F1-model_v6")).toBe("alphafold-db");
    expect(modelSource("AF3-P0DPI4-F1-model_v6")).toBe("alphafold-server");
    expect(modelSource("XY-1")).toBe("unknown");
  });
});

// the constants above are copied by hand from genetics-results-munge; with a checkout to hand
// (PROTEIN_STRUCTURE_MUNGE_CONTRACT=…/scripts/protein_structure_contract.py) they are compared
const CONTRACT = process.env.PROTEIN_STRUCTURE_MUNGE_CONTRACT;

describe.skipIf(!CONTRACT)("the munge contract module", () => {
  const source = CONTRACT ? readFileSync(CONTRACT, "utf8") : "";
  const assigned = (name: string): string => {
    const match = source.match(new RegExp(`^${name} = (.+)$`, "m"));
    if (!match) throw new Error(`${name} is not assigned in ${CONTRACT}`);
    return match[1];
  };
  const strings = (python: string) => [...python.matchAll(/"([^"]*)"/g)].map((m) => m[1]);

  it("has the same view-spec constants", () => {
    expect(Number(assigned("VIEW_SPEC_VERSION"))).toBe(VIEW_SPEC_VERSION);
    expect(strings(assigned("VIEW_ROLES"))).toEqual([...VIEW_ROLES]);
    expect(strings(assigned("VIEW_COLOUR_MODES"))).toEqual([...VIEW_COLOUR_MODES]);
    expect(strings(assigned("VIEW_DEFAULT_COLOUR_MODE"))).toEqual([VIEW_DEFAULT_COLOUR_MODE]);
    expect(strings(assigned("AF3_SOURCE_LABEL"))).toEqual([AF3_SOURCE_LABEL]);
    expect(strings(assigned("MODEL_FILE_ID_RE"))).toEqual([MODEL_FILE_ID_RE.source]);
  });
});
