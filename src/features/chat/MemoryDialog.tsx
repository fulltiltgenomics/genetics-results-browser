import { useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Switch,
  Typography,
} from "@mui/material";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import { SideSheet } from "../../components/SideSheet";
import type { MemorySession } from "./chat.types";
import { getMemoryEnabled, getProjectMemory, setMemoryEnabled, MemoryUnavailableError } from "./memoryApi";
import { listSessions, pinSession } from "./chatHistoryApi";
import type { MemoryState } from "./memoryApi";

interface MemoryDialogProps {
  open: boolean;
  onClose: () => void;
  /** null renders the global (unfiled) view: the opt-in toggle and a pointer to projects,
   * no digest. A project id renders that project's memory: digest, counter, session list. */
  projectId: string | null;
}

// shown the first time the dialog is opened in the off state, never again — subsequent opens
// go straight to the "Turn on memory" button without re-explaining what memory does
export const MEMORY_NOTICE_SEEN_KEY = "chat_memory_notice_seen";

// below this many unfiled conversations, telling someone to go file them into a project
// the sidebar to "get memory back" is bigger advice than the situation calls for
const UNFILED_POINTER_THRESHOLD = 3;

const hasSeenNotice = (): boolean => {
  try {
    return localStorage.getItem(MEMORY_NOTICE_SEEN_KEY) === "1";
  } catch {
    // private browsing / storage disabled: treat every open as first-open rather than throwing
    return false;
  }
};

const markNoticeSeen = (): void => {
  try {
    localStorage.setItem(MEMORY_NOTICE_SEEN_KEY, "1");
  } catch {
    // nothing to persist to; the notice will just show again next time
  }
};

export const MemoryDialog = ({ open, onClose, projectId }: MemoryDialogProps) => {
  const isGlobal = projectId === null;

  // global (unfiled) view: just the opt-in state and a count of what filing would help
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // project view: the rendered digest, its session list, pins
  const [state, setState] = useState<MemoryState | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  const [showNotice, setShowNotice] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);

  // guards against two in-flight GETs landing out of order (e.g. a fast reopen while the
  // first request is still pending) — a response is applied only if it's from the latest load
  const loadGeneration = useRef(0);

  const loadGlobal = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setEnabled(null);
    setUnfiledCount(null);
    setGlobalLoading(true);
    setGlobalError(null);
    try {
      const on = await getMemoryEnabled();
      if (generation !== loadGeneration.current) return;
      setEnabled(on);
      if (on) {
        try {
          const sessions = await listSessions();
          if (generation !== loadGeneration.current) return;
          setUnfiledCount(sessions.filter((s) => !s.projectId).length);
        } catch {
          // the toggle itself loaded fine; unfiledCount just stays null, so the
          // pointer below falls back to its short form instead of raising an alert
        }
      }
    } catch {
      if (generation !== loadGeneration.current) return;
      setGlobalError("Failed to load memory settings.");
    } finally {
      if (generation === loadGeneration.current) setGlobalLoading(false);
    }
  }, []);

  const loadProject = useCallback(async (id: string) => {
    const generation = ++loadGeneration.current;
    setState(null);
    setLoading(true);
    setUnavailable(false);
    setError(null);
    try {
      const result = await getProjectMemory(id);
      if (generation !== loadGeneration.current) return;
      setState(result);
    } catch (e) {
      if (generation !== loadGeneration.current) return;
      if (e instanceof MemoryUnavailableError) {
        setUnavailable(true);
      } else {
        setError("Failed to load memory.");
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setPinError(null);
    if (isGlobal) {
      setShowNotice(!hasSeenNotice());
      loadGlobal();
    } else {
      loadProject(projectId);
    }
  }, [open, isGlobal, projectId, loadGlobal, loadProject]);

  // marked seen only once the notice has actually been shown to the user — not on open,
  // which would consume it against an already-enabled user who never sees it rendered
  useEffect(() => {
    if (isGlobal && enabled === false && showNotice) markNoticeSeen();
  }, [isGlobal, enabled, showNotice]);

  const handleTurnOn = async () => {
    setTogglingEnabled(true);
    try {
      await setMemoryEnabled(true);
      setEnabled(true);
      // best-effort: the "create one from the sidebar" pointer needs this count right after
      // opting in, but a failure here shouldn't surface as a failed opt-in
      const generation = ++loadGeneration.current;
      try {
        const sessions = await listSessions();
        if (generation !== loadGeneration.current) return;
        setUnfiledCount(sessions.filter((s) => !s.projectId).length);
      } catch {
        // unfiledCount stays null; the pointer just falls back to its short form
      }
    } catch {
      setGlobalError("Failed to turn on memory.");
    } finally {
      setTogglingEnabled(false);
    }
  };

  // memory is a global opt-in (see memoryApi.getMemoryEnabled), so turning it on from the
  // project view still hits the same endpoint — the difference is what needs refreshing
  // afterward: the project's own digest/session state rather than the unfiled count
  const handleTurnOnProject = async () => {
    if (projectId === null) return;
    setTogglingEnabled(true);
    try {
      await setMemoryEnabled(true);
      await loadProject(projectId);
    } catch {
      setError("Failed to turn on memory.");
    } finally {
      setTogglingEnabled(false);
    }
  };

  const handleTurnOff = async () => {
    setTogglingEnabled(true);
    try {
      await setMemoryEnabled(false);
      setEnabled(false);
    } catch {
      setGlobalError("Failed to turn off memory.");
    } finally {
      setTogglingEnabled(false);
    }
  };

  const handleTogglePin = async (session: MemorySession) => {
    const next = !session.pinned;
    setState((prev) =>
      prev
        ? {
            ...prev,
            sessions: prev.sessions.map((s) => (s.id === session.id ? { ...s, pinned: next } : s)),
          }
        : prev,
    );
    try {
      await pinSession(session.id, next);
    } catch {
      setState((prev) =>
        prev
          ? {
              ...prev,
              sessions: prev.sessions.map((s) =>
                s.id === session.id ? { ...s, pinned: session.pinned } : s,
              ),
            }
          : prev,
      );
      setPinError("Failed to update pin.");
    }
  };

  return (
    <SideSheet open={open} onClose={onClose} title="Memory">
      {isGlobal ? (
        <>
          {globalError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setGlobalError(null)}>
              {globalError}
            </Alert>
          )}

          {globalLoading && enabled === null && <CircularProgress size={20} />}

          {enabled === false && showNotice && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Turning memory on lets the assistant see an index of your earlier conversations at
              the start of each new one, built from conversation titles, phenotype codes and the
              tool inputs you ran. It never includes tool results, plots, downloads, or anything
              from a secret chat. Deleting a conversation removes it from every digest built
              afterward, including this preview and any conversation you start later. A
              conversation already in progress keeps the copy of the index it started with until
              it ends, so it won't reflect that deletion.
            </Alert>
          )}

          {enabled === false && (
            <Button
              variant="contained"
              onClick={handleTurnOn}
              disabled={togglingEnabled}
              sx={{ mb: 2 }}
            >
              Turn on memory
            </Button>
          )}

          {enabled === true && (
            <>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <Switch
                  checked
                  disabled={togglingEnabled}
                  onChange={handleTurnOff}
                  inputProps={{ "aria-label": "Memory is on" }}
                />
                <Typography variant="body2">Memory is on</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Turning this off stops the digest from being added to new conversations, but
                leaves the digests already stored on existing conversations untouched.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {unfiledCount !== null && unfiledCount >= UNFILED_POINTER_THRESHOLD
                  ? "Memory works inside projects — create one from the sidebar"
                  : "Memory works inside projects."}
              </Typography>
            </>
          )}
        </>
      ) : (
        <>
          {unavailable && (
            <Typography variant="body2" color="text.secondary">
              Memory is not available on this server yet.
            </Typography>
          )}

          {!unavailable && error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {!unavailable && loading && !state && <CircularProgress size={20} />}

          {!unavailable && state && (
            <>
              {state.enabled === false && (
                <Button
                  variant="contained"
                  onClick={handleTurnOnProject}
                  disabled={togglingEnabled}
                  sx={{ mb: 2 }}
                >
                  Turn on memory
                </Button>
              )}

              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {state.enabled
                  ? "Exactly as the model will see it at your next session start"
                  : "Preview — what turning this on would give the model"}
              </Typography>
              <Box
                component="pre"
                sx={{
                  fontFamily: "monospace",
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  p: 1.5,
                  bgcolor: "action.hover",
                  borderRadius: 1,
                  maxHeight: 240,
                  overflow: "auto",
                  m: 0,
                }}
              >
                {state.digest || "(nothing yet)"}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 3 }}>
                {state.digest.length} / {state.charCap} characters
              </Typography>

              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Clear
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                There is no separate delete for memory — it is derived from your conversations.
                Unfiling or deleting a conversation, unpinning it, or turning memory off all
                remove it from this preview and any conversation started after that; a
                conversation already open keeps its own copy of the index until it ends.
              </Typography>

              {pinError && (
                <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setPinError(null)}>
                  {pinError}
                </Alert>
              )}

              {state.sessions.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No conversations in memory yet.
                </Typography>
              )}

              <List dense disablePadding>
                {state.sessions.map((s) => (
                  <ListItem
                    key={s.id}
                    disablePadding
                    secondaryAction={
                      <IconButton
                        size="small"
                        onClick={() => handleTogglePin(s)}
                        aria-label={s.pinned ? `unpin ${s.title || "New Chat"}` : `pin ${s.title || "New Chat"}`}
                      >
                        {s.pinned ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
                      </IconButton>
                    }
                  >
                    <ListItemButton component={RouterLink} to={`/chat/${s.id}`} onClick={onClose}>
                      <ListItemText primary={s.title || "New Chat"} />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </>
          )}
        </>
      )}
    </SideSheet>
  );
};

export default MemoryDialog;
