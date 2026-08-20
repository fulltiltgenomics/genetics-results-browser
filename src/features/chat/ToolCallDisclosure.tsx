import { Box, Chip, Collapse, Typography, useTheme } from "@mui/material";
import {
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
  CheckCircleOutline as OkIcon,
  ErrorOutline as FailIcon,
} from "@mui/icons-material";
import { useState } from "react";
import type { ToolCallRecord } from "./toolCallMarker";

/** the one input worth showing as a code block rather than as a key/value row */
const CODE_FIELDS: Record<string, string> = { run_analysis: "code" };

function summariseValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

function outcomeLabel(record: ToolCallRecord): string | null {
  const outcome = record.outcome;
  if (!outcome) return null;
  const seconds = outcome.durationMs != null ? `${(outcome.durationMs / 1000).toFixed(1)}s` : null;
  if (!outcome.ran) return outcome.status;
  if (outcome.ok) return seconds;
  return [outcome.exception ?? outcome.status, seconds].filter(Boolean).join(" · ");
}

/**
 * One tool call, collapsed to a single line that expands to the whole input.
 *
 * The input is shown in full because the field that matters most — a `run_analysis`
 * script — used to be truncated to 400 characters of run-together italics with no way to
 * see the rest (genetics-results-suite-inp). Collapsed by default because a transcript
 * whose prose is buried under several screens of Python is the failure this replaced.
 */
export const ToolCallDisclosure = ({ record }: { record: ToolCallRecord }) => {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const codeField = CODE_FIELDS[record.name];
  const code = codeField ? record.input[codeField] : undefined;
  const codeText = typeof code === "string" ? code : null;
  const otherParams = Object.entries(record.input).filter(([key]) => key !== codeField);

  const outcome = record.outcome;
  const label = outcomeLabel(record);

  return (
    <Box
      sx={{
        my: 1,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 1,
        overflow: "hidden",
        bgcolor: theme.palette.mode === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
      }}>
      <Box
        onClick={() => setExpanded((prev) => !prev)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          px: 1,
          py: 0.5,
          cursor: "pointer",
          userSelect: "none",
          "&:hover": { bgcolor: theme.palette.action.hover },
        }}>
        {expanded ? (
          <ExpandMoreIcon sx={{ fontSize: 18, color: "text.secondary" }} />
        ) : (
          <ChevronRightIcon sx={{ fontSize: 18, color: "text.secondary" }} />
        )}
        <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: 500 }}>
          {record.name}
        </Typography>
        {codeText && (
          <Typography variant="caption" color="text.secondary">
            {codeText.length.toLocaleString()} chars
          </Typography>
        )}
        {label && (
          <Typography variant="caption" color={outcome?.ok ? "text.secondary" : "error.main"}>
            {label}
          </Typography>
        )}
        {outcome &&
          (outcome.ok ? (
            <OkIcon sx={{ fontSize: 15, color: "success.main" }} />
          ) : (
            <FailIcon sx={{ fontSize: 15, color: "error.main" }} />
          ))}
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="caption" color="text.disabled">
          {expanded ? "hide" : "show"}
        </Typography>
      </Box>

      <Collapse in={expanded} unmountOnExit>
        <Box sx={{ px: 1, pb: 1 }}>
          {otherParams.length > 0 && (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: codeText ? 1 : 0 }}>
              {otherParams.map(([key, value]) => (
                <Chip
                  key={key}
                  size="small"
                  variant="outlined"
                  label={`${key}: ${summariseValue(value)}`}
                  sx={{ maxWidth: "100%", fontFamily: "monospace", fontSize: "0.7rem" }}
                />
              ))}
            </Box>
          )}
          {codeText && (
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1,
                fontSize: "0.75rem",
                lineHeight: 1.5,
                fontFamily: "monospace",
                whiteSpace: "pre",
                overflowX: "auto",
                maxHeight: 480,
                borderRadius: 1,
                bgcolor: theme.palette.mode === "dark" ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.04)",
              }}>
              {codeText}
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
};
