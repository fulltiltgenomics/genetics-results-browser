import { describe, expect, it } from "vitest";
import { pyLiteral, viewSpecToPml } from "./pml";
import { parseViewSpec, type ViewSpec } from "./viewSpec";

const spec = (extra: Record<string, unknown> = {}): ViewSpec => {
  const parsed = parseViewSpec({ version: 1, model_file_id: "AF-TEST-F1-model_v6", ...extra });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.spec;
};

describe("pyLiteral", () => {
  it("leaves nothing that can end the literal or the line", () => {
    expect(pyLiteral("a'b\\c")).toBe("'a\\'b\\\\c'");
    expect(pyLiteral("x\nyé \u{1f600}")).toBe("'x\\x0ay\\xe9\\u2028\\U0001f600'");
    expect(pyLiteral(pyLiteral("it's"))).toBe("'\\'it\\\\\\'s\\''");
  });
});

describe("viewSpecToPml", () => {
  it("loads the model under the name the viewer saves it as and colours by pLDDT", () => {
    const pml = viewSpecToPml(spec());
    expect(pml).toContain("load AF-TEST-F1-model_v6.pdb, structure\n");
    expect(pml).toContain("set_color plddt_very_high, [0.0000, 0.3255, 0.8392]\ncolor plddt_very_high, structure and b > 90\n");
    expect(pml).toContain("color plddt_very_low, structure\n");
    expect(pml.endsWith("orient structure\n")).toBe(true);
    expect(pml).not.toContain("python");
  });

  it("colours a uniform view grey", () => {
    const pml = viewSpecToPml(spec({ colour_mode: "uniform" }));
    expect(pml).toContain("color grey80, structure\n");
    expect(pml).not.toContain("plddt");
  });

  it("groups marked residues by colour, in lines of fifty", () => {
    const residues = [
      ...Array.from({ length: 51 }, (_, i) => ({ file_position: i + 1, role: "case" })),
      { file_position: 100, colour: "#00FF00" },
    ];
    const lines = viewSpecToPml(spec({ residues })).split("\n");
    const shown = lines.filter((l) => l.startsWith("show spheres"));
    expect(shown).toHaveLength(3);
    expect(shown[0].split("+")).toHaveLength(50);
    expect(shown[1]).toBe("show spheres, structure and name CA and resi 51");
    expect(lines).toContain("set_color highlight_d62728, [0.8392, 0.1529, 0.1569]");
    expect(lines).toContain("color highlight_00ff00, structure and name CA and resi 100");
  });

  it("selects the neighbourhood of a sphere", () => {
    expect(viewSpecToPml(spec({ sphere: { centre: 12, radius: 8 } }))).toContain(
      "select neighbourhood, byres ((structure and name CA) within 8.000 of (structure and name CA and resi 12))\ndeselect\n",
    );
  });

  it("writes labels as literals inside a python block and skips blank ones", () => {
    const pml = viewSpecToPml(
      spec({
        residues: [
          { file_position: 5, label: "p.R5W')\nquit" },
          { file_position: 6, label: "  " },
        ],
      }),
    );
    const block = pml.slice(pml.indexOf("python\n"), pml.indexOf("python end"));
    expect(block.split("\n").filter(Boolean)).toEqual([
      "python",
      "from pymol import cmd",
      "cmd.label('structure and name CA and resi 5', '\\'p.R5W\\\\\\')\\\\x0aquit\\'')",
    ]);
    // every line of the script is printable ASCII
    expect(pml).toMatch(/^[\x20-\x7e\n]*$/);
  });
});
