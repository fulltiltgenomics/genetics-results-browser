import { useState, useEffect, useCallback } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import HistoryIcon from "@mui/icons-material/History";
import { SideSheet } from "../../components/SideSheet";
import type { InstructionSet, InstructionSetVersion } from "./chat.types";
import {
  archiveInstructionSet,
  createInstructionSet,
  getInstructionSetHistory,
  listInstructionSets,
  updateInstructionSet,
  InstructionSetApiError,
  MAX_BODY_CHARS,
  MAX_SETS_PER_USER,
} from "./instructionSetsApi";

interface InstructionsDialogProps {
  open: boolean;
  onClose: () => void;
}

// this user base are geneticists, not prompt engineers: a blank textarea is a worse first run
// than a starter to edit, so every one of these is meant to be cloned and rewritten
const EXAMPLE_SETS: { name: string; body: string }[] = [
  {
    name: "Statistician",
    body: [
      "I am a statistical geneticist. Assume I am fluent in GWAS methodology and fine-mapping,",
      "and do not explain standard concepts back to me.",
      "",
      "Always report effect sizes with their standard errors and the allele they are relative to,",
      "and give exact p-values rather than significance labels. State the sample size and the",
      "case/control split behind any estimate you quote. Say explicitly when a result is from a",
      "single cohort rather than a meta-analysis, and flag when variants I am comparing are in LD.",
      "If a number is not in the data you retrieved, say so explicitly.",
    ].join("\n"),
  },
  {
    name: "Bench biologist",
    body: [
      "I work at the bench on gene function and have limited statistical genetics background.",
      "Center answers on genes, transcripts and proteins rather than on variants and loci.",
      "",
      "When a locus comes up, tell me which gene the evidence actually implicates and how strong",
      "that link is, rather than only naming the nearest gene. Always mention the affected tissue",
      "or cell type when eQTL evidence exists. Define statistical terms briefly the first time you",
      "use them, and finish with what could be tested experimentally.",
    ].join("\n"),
  },
  {
    name: "Terse answers",
    body: [
      "Answer in as few words as the question allows. Lead with the answer, then at most three",
      "supporting bullets. No preamble, no restating my question, no summary of what you are about",
      "to do. Use tables for anything with more than three rows of numbers. If you are uncertain,",
      "say so in one clause rather than a paragraph of caveats.",
    ].join("\n"),
  },
];

type View =
  | { mode: "list" }
  | { mode: "edit"; set: InstructionSet | null }
  | { mode: "history"; set: InstructionSet };

const describeError = (e: unknown, fallback: string): string => {
  if (e instanceof InstructionSetApiError) {
    switch (e.status) {
      case 400:
        return "A name and some instruction text are both required.";
      case 404:
        return "These instructions no longer exist — they may have been deleted in another tab.";
      // the server's detail carries the true limit; the mirrored constants are only a fallback,
      // so a cap that later moves server-side doesn't leave the user reading a stale number
      case 409:
        return (
          e.message ||
          `You already have the maximum of ${MAX_SETS_PER_USER} instruction sets. Delete one before creating another.`
        );
      case 413:
        return e.message || `The instructions are too long — the limit is ${MAX_BODY_CHARS} characters.`;
      default:
        return `${fallback} (${e.message})`;
    }
  }
  return fallback;
};

const formatDate = (iso: string) => new Date(iso).toLocaleString();

export const InstructionsDialog = ({ open, onClose }: InstructionsDialogProps) => {
  const [sets, setSets] = useState<InstructionSet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ mode: "list" });
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [history, setHistory] = useState<InstructionSetVersion[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSets(await listInstructionSets());
      setError(null);
    } catch (e) {
      setError(describeError(e, "Failed to load instructions."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setView({ mode: "list" });
      setConfirmingDeleteId(null);
      setFormError(null);
      load();
    }
  }, [open, load]);

  const openEditor = (set: InstructionSet | null, seed?: { name: string; body: string }) => {
    setName(seed?.name ?? set?.name ?? "");
    setBody(seed?.body ?? set?.body ?? "");
    setFormError(null);
    setView({ mode: "edit", set });
  };

  const openHistory = async (set: InstructionSet) => {
    setView({ mode: "history", set });
    setHistory(null);
    setError(null);
    try {
      setHistory(await getInstructionSetHistory(set.id));
    } catch (e) {
      setError(describeError(e, "Failed to load the version history."));
      setHistory([]);
    }
  };

  const handleSave = async () => {
    if (view.mode !== "edit") return;
    const trimmedName = name.trim();
    if (!trimmedName || !body.trim()) {
      setFormError("A name and some instruction text are both required.");
      return;
    }
    setSaving(true);
    try {
      if (view.set) {
        // send only what changed: omitting an unchanged body lets a legacy over-cap set still be
        // renamed, since the server only checks the cap when a body is present
        await updateInstructionSet(view.set.id, {
          name: trimmedName,
          ...(body !== view.set.body && { body }),
        });
      } else {
        await createInstructionSet(trimmedName, body);
      }
      setFormError(null);
      setView({ mode: "list" });
      await load();
    } catch (e) {
      // a set deleted in another tab can never be saved again, so drop back to a refreshed list
      // rather than stranding the user in an editor over a list that still shows it
      if (e instanceof InstructionSetApiError && e.status === 404) {
        setFormError(null);
        setError(describeError(e, "Failed to save the instructions."));
        setView({ mode: "list" });
        await load();
      } else {
        setFormError(describeError(e, "Failed to save the instructions."));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (setId: string) => {
    setConfirmingDeleteId(null);
    try {
      await archiveInstructionSet(setId);
      await load();
    } catch (e) {
      setError(describeError(e, "Failed to delete the instructions."));
    }
  };

  // String.length counts UTF-16 code units while the server's Python len() counts code points, so
  // an astral-plane character (emoji, rare CJK) counts 2 here and 1 there. The skew is always in
  // the safe direction — the client can only be stricter, never permit a body the server rejects —
  // but the "shorten by N characters" figure below can overstate by the number of such characters
  const overCap = body.length > MAX_BODY_CHARS;
  // a set stored before the cap existed reads back in full but cannot be written back, so the
  // editor has to say why rather than letting the save 413 with no explanation
  const legacyOverCap = view.mode === "edit" && Boolean(view.set?.bodyOverCap) && overCap;

  const title =
    view.mode === "edit"
      ? view.set
        ? "Edit instructions"
        : "New instructions"
      : view.mode === "history"
        ? `History — ${view.set.name}`
        : "Instructions";

  const headerLeading =
    view.mode === "list" ? undefined : (
      <IconButton size="small" aria-label="back" onClick={() => setView({ mode: "list" })}>
        <ArrowBackIcon />
      </IconButton>
    );

  const footer =
    view.mode === "edit" ? (
      <>
        <Button onClick={() => setView({ mode: "list" })}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || (overCap && body !== view.set?.body)}
        >
          {view.set ? "Save" : "Create"}
        </Button>
      </>
    ) : undefined;

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title={title}
      headerLeading={headerLeading}
      footer={footer}
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {view.mode === "list" && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Instructions are added to the assistant's system prompt, so they apply to every answer
            in a chat where they are selected. Use them to say who you are and how you want results
            reported, not to ask a question.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Instructions you save here are stored in the database against your account and stay
            there until you delete them. That includes secret chat: secret chat keeps your messages
            out of the conversation log, but the instruction text itself is still stored.
          </Typography>

          <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => openEditor(null)}
              disabled={sets.length >= MAX_SETS_PER_USER}
            >
              New instructions
            </Button>
          </Box>

          {loading && <CircularProgress size={20} />}

          {!loading && sets.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
              You have no saved instructions. Start from one of the examples below, or write your
              own.
            </Typography>
          )}

          {sets.map((s) => (
            <Box
              key={s.id}
              sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, mb: 1.5 }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="subtitle2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
                  {s.name}
                </Typography>
                {s.bodyOverCap && (
                  // the full explanation otherwise appears only once the editor is open, so the
                  // list view showed a warning with no way to find out what it meant
                  <Tooltip
                    title={`These instructions were saved before the ${MAX_BODY_CHARS}-character limit. They still apply to your chats, but they cannot be saved again until you shorten them.`}>
                    <Chip
                      label="Too long to save"
                      size="small"
                      color="warning"
                      variant="outlined"
                    />
                  </Tooltip>
                )}
                <Tooltip title="Edit">
                  <IconButton size="small" onClick={() => openEditor(s)} aria-label="edit">
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Version history">
                  <IconButton size="small" onClick={() => openHistory(s)} aria-label="history">
                    <HistoryIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete">
                  <IconButton
                    size="small"
                    onClick={() => setConfirmingDeleteId(s.id)}
                    aria-label="delete"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>

              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  mt: 0.5,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  whiteSpace: "pre-wrap",
                }}
              >
                {s.body}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Updated {formatDate(s.updatedAt)}
              </Typography>

              {confirmingDeleteId === s.id && (
                <Alert
                  severity="warning"
                  sx={{ mt: 1 }}
                  action={
                    <>
                      <Button size="small" onClick={() => setConfirmingDeleteId(null)}>
                        Cancel
                      </Button>
                      <Button size="small" color="error" onClick={() => handleDelete(s.id)}>
                        Delete
                      </Button>
                    </>
                  }
                >
                  Delete “{s.name}”? Past answers keep their record of it, but it stops being
                  available for new chats.
                </Alert>
              )}
            </Box>
          ))}

          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
            Start from an example
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            These are starting points, not presets. Copy one and edit it to describe your own work.
          </Typography>
          {EXAMPLE_SETS.map((example) => (
            <Box
              key={example.name}
              sx={{ p: 1.5, mb: 1.5, bgcolor: "action.hover", borderRadius: 1 }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                  {example.name}
                </Typography>
                <Button
                  size="small"
                  startIcon={<ContentCopyIcon fontSize="small" />}
                  onClick={() => openEditor(null, example)}
                  disabled={sets.length >= MAX_SETS_PER_USER}
                >
                  Copy and edit
                </Button>
              </Box>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}
              >
                {example.body}
              </Typography>
            </Box>
          ))}
        </>
      )}

      {view.mode === "edit" && (
        <>
          {formError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {formError}
            </Alert>
          )}

          {legacyOverCap && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              These instructions were saved before the {MAX_BODY_CHARS}-character limit and are{" "}
              {body.length} characters long. They still apply to your chats, but they cannot be
              saved again until you shorten them by {body.length - MAX_BODY_CHARS} characters.
            </Alert>
          )}

          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="small"
            fullWidth
            sx={{ mb: 2 }}
          />
          <TextField
            label="Instructions"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            multiline
            minRows={12}
            fullWidth
            placeholder="e.g. I am a statistical geneticist — report effect sizes with standard errors and skip the background explanations."
            error={overCap}
            helperText={`${body.length} / ${MAX_BODY_CHARS} characters`}
          />
        </>
      )}

      {view.mode === "history" && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Every edit is kept, newest first. History is a record only — editing goes through the
            current version.
          </Typography>

          {history === null && <CircularProgress size={20} />}

          {history !== null && history.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No earlier versions recorded.
            </Typography>
          )}

          {history?.map((version) => (
            <Box
              key={version.id}
              sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, mb: 1.5 }}
            >
              <Typography variant="subtitle2">{version.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {formatDate(version.changedAt)}
                {version.comment && ` · ${version.comment}`}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}
              >
                {version.body}
              </Typography>
            </Box>
          ))}
        </>
      )}
    </SideSheet>
  );
};

export default InstructionsDialog;
