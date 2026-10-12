import { Box, Chip } from "@mui/material";
import { CohortN, cohortLabel, formatCohortN } from "../../store/cohorts";

/** "Cohorts: FG, AoU-EUR, …" as small chips, each titled with that cohort's sample size. */
export const CohortChips = ({
  cohorts,
  nByCohort,
}: {
  cohorts: string[];
  nByCohort?: Record<string, CohortN>;
}) => (
  <Box
    data-testid="contributing-cohorts"
    sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5, mt: 0.5 }}>
    <span>Cohorts:</span>
    {cohorts.map((token) => (
      <Chip
        key={token}
        size="small"
        variant="outlined"
        label={cohortLabel(token)}
        title={formatCohortN(nByCohort?.[token])}
        sx={{ height: 20, fontSize: "0.75rem" }}
      />
    ))}
  </Box>
);
