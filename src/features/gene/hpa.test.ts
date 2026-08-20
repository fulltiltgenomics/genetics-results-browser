import { describe, expect, it } from "vitest";
import { hpaLevelLabel, hpaLevelRank, hpaTissueLabel } from "./hpa";

describe("hpaTissueLabel", () => {
  it("drops the organ segment the tissue segment repeats", () => {
    expect(hpaTissueLabel("lung|lung|macrophages")).toBe("lung, macrophages");
    expect(hpaTissueLabel("colon|colon|peripheral_nerve/ganglion")).toBe(
      "colon, peripheral nerve/ganglion"
    );
  });

  it("keeps HPA's numbered samples of one organ", () => {
    expect(hpaTissueLabel("endometrium|endometrium_2|glandular_cells")).toBe(
      "endometrium 2, glandular cells"
    );
  });

  it("keeps segments that genuinely differ", () => {
    expect(hpaTissueLabel("brain|cerebellum|purkinje_cells")).toBe("brain, cerebellum, purkinje cells");
  });
});

describe("hpa levels", () => {
  it("spaces out the served level", () => {
    expect(hpaLevelLabel("Not_detected")).toBe("Not detected");
    expect(hpaLevelLabel("High")).toBe("High");
  });

  it("ranks staining intensity high → not detected, unknown last", () => {
    const levels = ["Not_detected", "High", "Low", "Medium", "???"];
    expect(levels.slice().sort((a, b) => hpaLevelRank(b) - hpaLevelRank(a))).toEqual([
      "High",
      "Medium",
      "Low",
      "Not_detected",
      "???",
    ]);
  });
});
