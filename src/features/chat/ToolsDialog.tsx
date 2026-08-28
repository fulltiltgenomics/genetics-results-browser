import { useMemo, useState } from "react";
import {
  Box,
  Chip,
  CircularProgress,
  InputAdornment,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SideSheet } from "../../components/SideSheet";
import { toolProfileLabel } from "./LLMChat";
import { useChatOptionsStore } from "./useChatOptions";
import { useAvailableTools } from "./toolsApi";
import type { AvailableTool } from "./toolsApi";

interface ToolsDialogProps {
  open: boolean;
  onClose: () => void;
}

/** how each group of tools is introduced. Keyed by `source:category` for local tools — the pair
 * the server groups by — and by source alone for the proxied ones, which have no category. */
const GROUPS: { key: string; label: string; blurb: string }[] = [
  {
    key: "local:general",
    label: "Lookup and search",
    blurb:
      "Finding the right identifier, and the searches that are not about our own results: genes, phenotypes, variants, proteins, literature, the web.",
  },
  {
    key: "local:api",
    label: "Genetics results",
    blurb:
      "The hosted results themselves — credible sets, colocalization, QTLs, exome and burden tests, HLA, chromatin, expression — queried one gene, variant, phenotype or region at a time.",
  },
  {
    key: "local:bigquery",
    label: "Database (SQL)",
    blurb:
      "Direct SQL against the same results, for questions that span many phenotypes or genes at once rather than a single lookup.",
  },
  {
    key: "local:orchestration",
    label: "Analysis and orchestration",
    blurb:
      "Running analysis code in the sandbox, reading back what it produced, and splitting a broad question across parallel subagents.",
  },
  {
    key: "external",
    label: "External MCP servers",
    blurb:
      "Tools proxied live from the public MCP servers this deployment is connected to, such as Open Targets and gnomAD. Their names and descriptions come from those servers, so this section is whatever they currently offer.",
  },
  {
    key: "rag",
    label: "Retrieval (RAG)",
    blurb: "Tools proxied from the retrieval server for searching indexed documents.",
  },
];

const groupKey = (tool: AvailableTool) =>
  tool.source === "local" ? `local:${tool.category ?? "other"}` : tool.source;

export const ToolsDialog = ({ open, onClose }: ToolsDialogProps) => {
  const toolProfile = useChatOptionsStore((s) => s.toolProfile);
  const { data: tools, isLoading, error } = useAvailableTools(toolProfile, open);
  const [filter, setFilter] = useState("");

  const groups = useMemo(() => {
    if (!tools) return [];
    const needle = filter.trim().toLowerCase();
    const matching = needle
      ? tools.filter(
          (t) =>
            t.name.toLowerCase().includes(needle) ||
            t.description.toLowerCase().includes(needle)
        )
      : tools;
    // a group the server sends that GROUPS does not name still gets shown, under its raw key:
    // a new tool category must not silently vanish from a panel whose whole job is completeness
    const known = GROUPS.map((g) => ({ ...g, tools: matching.filter((t) => groupKey(t) === g.key) }));
    const namedKeys = new Set(GROUPS.map((g) => g.key));
    const rest = matching.filter((t) => !namedKeys.has(groupKey(t)));
    const restKeys = [...new Set(rest.map(groupKey))];
    return [
      ...known,
      ...restKeys.map((key) => ({
        key,
        label: key,
        blurb: "",
        tools: rest.filter((t) => groupKey(t) === key),
      })),
    ].filter((g) => g.tools.length > 0);
  }, [tools, filter]);

  return (
    <SideSheet open={open} onClose={onClose} title="Tools available to the assistant">
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
        These are the tools the assistant can call while answering, exactly as this conversation
        is currently configured. The set depends on the Tools option below the message box:{" "}
        <strong>{toolProfile ? toolProfileLabel(toolProfile) : "All"}</strong> is selected, so
        switching it changes this list. The assistant decides on its own which of these to call,
        and you can see the ones it used by expanding the tool calls in its replies.
      </Typography>

      <TextField
        size="small"
        fullWidth
        placeholder="Filter by name or description"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        sx={{ mb: 2 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
      />

      {isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}
      {error && <Typography color="error">Failed to load tools: {error.message}</Typography>}

      {tools && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {groups.reduce((n, g) => n + g.tools.length, 0)} of {tools.length} tools
        </Typography>
      )}

      {groups.map((group) => (
        <Box key={group.key} sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            {group.label}{" "}
            <Chip size="small" label={group.tools.length} sx={{ ml: 0.5, verticalAlign: "middle" }} />
          </Typography>
          {group.blurb && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {group.blurb}
            </Typography>
          )}
          {group.tools.map((tool) => (
            <Box
              key={tool.name}
              sx={{
                mb: 1,
                p: 1.5,
                borderRadius: 1,
                border: 1,
                borderColor: "divider",
              }}>
              <Typography
                variant="body2"
                sx={{ fontFamily: "monospace", fontWeight: 600, mb: 0.5 }}>
                {tool.name}
              </Typography>
              {/* tool descriptions are written for the model and several use markdown
                  emphasis and bullet lists; rendering them raw would show the asterisks */}
              <Box
                sx={{
                  color: "text.secondary",
                  fontSize: "0.875rem",
                  "& p": { m: 0, mb: 0.5 },
                  "& p:last-child": { mb: 0 },
                  "& ul": { m: 0, mb: 0.5, pl: 2.5 },
                  "& code": { fontSize: "0.8rem" },
                }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{tool.description}</ReactMarkdown>
              </Box>
            </Box>
          ))}
        </Box>
      ))}

      {tools && groups.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No tool matches "{filter}".
        </Typography>
      )}
    </SideSheet>
  );
};
