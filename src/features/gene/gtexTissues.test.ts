import { describe, expect, it } from "vitest";
import { gtexTissueColor, gtexTissueLabel } from "./gtexTissues";

describe("gtexTissues", () => {
  it("returns the portal colour and label for official tissues", () => {
    expect(gtexTissueColor("whole_blood")).toBe("#FF00BB");
    expect(gtexTissueLabel("whole_blood")).toBe("Whole Blood");
    expect(gtexTissueColor("brain_cortex")).toBe("#EEEE00");
    // GTEx's own API misspells this one ("Anterior qcingulate cortex")
    expect(gtexTissueLabel("brain_anterior_cingulate_cortex_ba24")).toBe(
      "Brain - Anterior cingulate cortex (BA24)"
    );
  });

  it("derives v10 sub-tissues from their parent tissue", () => {
    expect(gtexTissueLabel("liver_hepatocyte")).toBe("Liver (hepatocyte)");
    expect(gtexTissueLabel("small_intestine_terminal_ileum_mixed_cell")).toBe(
      "Small Intestine - Terminal Ileum (mixed cell)"
    );
    // sub-regions keep the parent's colour, as the portal palette itself does
    expect(gtexTissueColor("stomach_mucosa")).toBe(gtexTissueColor("stomach"));
  });

  it("falls back to grey and a spaced-out id for unknown tissues", () => {
    expect(gtexTissueColor("not_a_gtex_tissue")).toBe("#AAAAAA");
    expect(gtexTissueLabel("not_a_gtex_tissue")).toBe("not a gtex tissue");
  });
});
