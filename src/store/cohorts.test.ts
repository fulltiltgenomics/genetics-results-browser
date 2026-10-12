import { describe, expect, it } from "vitest";
import { cohortLabel, cohortLines, pickCohortColumns } from "./cohorts";

describe("cohort column discovery", () => {
  it("picks only per-cohort and leave-one-out columns, coercing non-numbers to null", () => {
    const cols = pickCohortColumns({
      beta: 0.1,
      meta_n: 10,
      het_p: 0.3,
      rsid: "rs1",
      fg_beta: 0.2,
      mvp_eur_r2: 0.9,
      aou_mid_af: "NA",
      leave_ukbb_het_p: 0.5,
      leave_fg_n: 1000,
    });
    expect(cols).toEqual({
      fg_beta: 0.2,
      mvp_eur_r2: 0.9,
      aou_mid_af: null,
      leave_ukbb_het_p: 0.5,
      leave_fg_n: 1000,
    });
  });

  it("reads leave-one-out columns of the four known families only", () => {
    expect(
      Object.keys(
        pickCohortColumns({ leave_fg_beta: 1, leave_ukbb_ppp_beta: 2, leave_fg2_3k_se: 3, leave_mvp_eur_n: 4 })
      )
    ).toEqual(["leave_fg_beta"]);
  });

  it("orders lines by cohort and drops all-null blocks", () => {
    const { cohorts, leaveOneOut } = cohortLines({
      mvp_eur_beta: 0.3,
      mvp_eur_r2: 0.8,
      fg_beta: 0.1,
      aou_afr_beta: null,
      aou_afr_af: null,
      ukbb_eur_pval: 0.01,
      leave_mvp_beta: 0.2,
      leave_fg_beta: 0.4,
    });
    expect(cohorts.map((c) => c.label)).toEqual(["FG", "UKBB-EUR", "MVP-EUR"]);
    expect(cohorts[2]).toMatchObject({ beta: 0.3, r2: 0.8, se: null });
    expect(leaveOneOut.map((l) => l.label)).toEqual(["FG", "MVP"]);
  });

  it("labels an unknown ancestry token by the fallback", () => {
    expect(cohortLabel("aou_oth")).toBe("AOU-OTH");
  });
});
