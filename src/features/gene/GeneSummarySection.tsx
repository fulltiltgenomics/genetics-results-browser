import { useState } from "react";
import { Box, Link, Typography } from "@mui/material";
import { useGeneSummary } from "@/store/serverQuery";
import { useGeneEvidenceStore } from "@/store/store.geneEvidence";
import type { GeneSummary } from "../../../bff/geneSummaryTypes";
import { Section } from "./evidenceTable";
import { COMING_SOON, tabLabel } from "./geneEvidenceTabs";

// prose is read in lines, not across the width the tables use
const PROSE_WIDTH = 860;

const Finding = ({ finding }: { finding: GeneSummary["findings"][number] }) => {
  const setActiveTab = useGeneEvidenceStore((s) => s.setActiveTab);
  const [open, setOpen] = useState(false);
  const { statement, tab, evidence } = finding;

  return (
    <Box component="li" sx={{ mb: 1.5 }}>
      <Typography variant="body2">{statement}</Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
        {COMING_SOON.has(tab) ? (
          `${tabLabel(tab)} tab, coming soon`
        ) : (
          <Link
            component="button"
            type="button"
            variant="caption"
            onClick={() => setActiveTab(tab)}>
            {`open the ${tabLabel(tab)} tab`}
          </Link>
        )}
        {" · "}
        <Link
          component="button"
          type="button"
          variant="caption"
          aria-expanded={open}
          onClick={() => setOpen(!open)}>
          {`${open ? "hide" : "show"} the ${evidence.length} ${evidence.length === 1 ? "result" : "results"} behind this`}
        </Link>
      </Typography>
      {open && (
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
          {evidence.map((e) => (
            <Typography key={e.id} variant="caption" color="text.secondary" component="li">
              {e.label}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
};

/**
 * The precomputed AI summary of the browser's own evidence for the gene. Each finding names the
 * tab that shows its rows and lists them, so a statement can be checked rather than trusted.
 */
const GeneSummarySection = ({ geneName }: { geneName: string }) => {
  const summary = useGeneSummary(geneName);
  const data = summary.data;

  return (
    <Section
      isPending={summary.isPending}
      isError={summary.isError}
      error={summary.error}
      isEmpty={!data}
      emptyText={`no AI summary for ${geneName} yet`}>
      {data && (
        <Box sx={{ maxWidth: PROSE_WIDTH }}>
          <Typography variant="h6" component="h2" sx={{ mb: 1.5, lineHeight: 1.35 }}>
            {data.headline}
          </Typography>
          <Typography variant="body1" sx={{ mb: 3 }}>
            {data.overview}
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Key findings
          </Typography>
          <Box component="ol" sx={{ mt: 1, pl: 2.5 }}>
            {data.findings.map((finding, i) => (
              <Finding key={i} finding={finding} />
            ))}
          </Box>
          {data.gaps.length > 0 && (
            <>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 2 }}>
                What is missing
              </Typography>
              <Box component="ul" sx={{ mt: 1, pl: 2.5 }}>
                {data.gaps.map((gap, i) => (
                  <Typography key={i} variant="body2" component="li" sx={{ mb: 0.5 }}>
                    {gap}
                  </Typography>
                ))}
              </Box>
            </>
          )}
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 3 }}>
            {`Written by an AI model (${data.model}) on ${data.generated} from the results in this browser only, without the literature. It can be wrong: check a statement against the tab it points to.`}
          </Typography>
        </Box>
      )}
    </Section>
  );
};

export default GeneSummarySection;
