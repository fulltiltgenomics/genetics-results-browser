import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListSubheader,
  IconButton,
  Typography,
  Button,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Divider,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  Add as AddIcon,
  ArrowDropDown as ArrowDropDownIcon,
  Delete as DeleteIcon,
  VisibilityOff as VisibilityOffIcon,
  InfoOutlined as InfoOutlinedIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  MoreHoriz as MoreHorizIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  CreateNewFolder as CreateNewFolderIcon,
} from "@mui/icons-material";
import type { ChatSession } from "./chatHistoryApi";
import { listProjectSessions } from "./chatHistoryApi";
import type { Project } from "./chat.types";

interface ChatHistorySidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onNewSecretChat: () => void;
  // may be async: the per-project caches here are re-read once the parent's delete has landed
  onDeleteSession: (sessionId: string) => void | Promise<void>;
  // may be async: a row the sidebar caches on its own needs the failure to undo its star
  onTogglePinSession: (sessionId: string, wasPinned: boolean) => void | Promise<void>;
  loading: boolean;
  // called after a session, new chat, or new secret chat is picked
  // used by the parent to close the mobile drawer
  onAfterSelect?: () => void;
  // filing surface; absent (the pin/delete-only sidebar) when the parent passes no projects
  projects?: Project[];
  currentProjectId?: string | null;
  onSelectCurrentProject?: (projectId: string | null) => void;
  onNewChatInProject?: (projectId: string) => void;
  onCreateProject?: (name: string) => Promise<Project>;
  onRenameProject?: (projectId: string, name: string) => Promise<void>;
  onDeleteProject?: (projectId: string, withSessions: boolean) => Promise<void>;
  // `previousProjectId` is where the row sits now, which only the sidebar knows for a row
  // past the session list's cap; the parent rolls back to it when the move fails
  onMoveSession?: (
    sessionId: string,
    projectId: string | null,
    previousProjectId: string | null,
  ) => Promise<void>;
  onOpenProjectMemory?: (projectId: string) => void;
  // a secret chat is never persisted, so it has nothing to file: hide the filing affordances
  // that would offer to put *this* conversation somewhere
  isSecretChat?: boolean;
}

// group sessions by date
function groupSessionsByDate(sessions: ChatSession[]): Record<string, ChatSession[]> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const groups: Record<string, ChatSession[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 days": [],
    Older: [],
  };

  for (const session of sessions) {
    const sessionDate = new Date(session.updatedAt);
    if (sessionDate >= today) {
      groups["Today"].push(session);
    } else if (sessionDate >= yesterday) {
      groups["Yesterday"].push(session);
    } else if (sessionDate >= lastWeek) {
      groups["Previous 7 days"].push(session);
    } else {
      groups["Older"].push(session);
    }
  }

  return groups;
}

/** dropTarget key for the unfiled section, which has no project id */
const UNFILED_DROP = "__unfiled__";

const sessionLabel = (session: ChatSession): string =>
  session.title || session.preview || "New Chat";

interface SessionRowProps {
  session: ChatSession;
  active: boolean;
  hovered: boolean;
  onHoverChange: (sessionId: string | null) => void;
  onSelect: (sessionId: string) => void;
  onDelete: (e: React.MouseEvent, sessionId: string) => void;
  onTogglePin: (e: React.MouseEvent, sessionId: string, wasPinned: boolean) => void;
  onOpenRowMenu?: (e: React.MouseEvent<HTMLElement>, session: ChatSession) => void;
  // true while this row's own "⋯" menu is open; MUI portals the menu and autofocuses its
  // list, so the row's onBlur sees a relatedTarget outside itself and must not hide the row
  menuOpen?: boolean;
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: (e: React.DragEvent, session: ChatSession) => void;
  onDragEnd?: () => void;
}

/** one conversation. Kept a component of its own so a drop target can wrap it without
 * touching the list rendering around it. */
const SessionRow = ({
  session,
  active,
  hovered,
  onHoverChange,
  onSelect,
  onDelete,
  onTogglePin,
  onOpenRowMenu,
  menuOpen = false,
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
}: SessionRowProps) => {
  // keep the row revealed while it owns the open menu, or closing the menu (which blurs
  // its portaled list back to nothing under the row) would unmount its own anchorEl
  const revealed = hovered || menuOpen;
  const showDelete = revealed;
  // a pin holds a conversation in its project's memory window and does nothing for an
  // unfiled one, so the star is offered only on filed rows. Like delete it is a hover
  // action, but a pinned row keeps its star as a standing indicator
  const showPin = Boolean(session.projectId) && (revealed || session.pinned);
  const showMenu = revealed && Boolean(onOpenRowMenu);
  const actionCount = (showPin ? 1 : 0) + (showDelete ? 1 : 0) + (showMenu ? 1 : 0);

  return (
    <ListItem
      disablePadding
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, session)}
      onDragEnd={onDragEnd}
      sx={{
        opacity: dragging ? 0.4 : 1,
        cursor: draggable ? "grab" : undefined,
        // ListItem gives the button a fixed 48px right padding from this parent selector,
        // which outranks the button's own sx and is only wide enough for one icon: the title
        // then runs under the star and the "⋯". Each small icon button is 30px plus its
        // 4px margin, and the action box sits 16px in from the edge
        "& > .MuiListItemButton-root": { paddingRight: `${24 + actionCount * 34}px` },
      }}
      secondaryAction={
        actionCount > 0 && (
          <Box sx={{ display: "flex", alignItems: "center" }}>
            {showPin && (
              <Tooltip title={session.pinned ? "Kept in project memory" : "Keep in project memory"}>
                <IconButton
                  size="small"
                  onClick={(e) => onTogglePin(e, session.id, session.pinned ?? false)}
                  aria-label={
                    session.pinned
                      ? `unpin conversation: ${session.title || "New Chat"}`
                      : `pin conversation: ${session.title || "New Chat"}`
                  }
                  sx={{ mr: 0.5 }}>
                  {session.pinned ? (
                    <StarIcon fontSize="small" color="warning" />
                  ) : (
                    <StarBorderIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            )}
            {showMenu && (
              <IconButton
                size="small"
                aria-label={`conversation menu: ${sessionLabel(session)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenRowMenu?.(e, session);
                }}
                sx={{ mr: 0.5 }}>
                <MoreHorizIcon fontSize="small" />
              </IconButton>
            )}
            {showDelete && (
              <IconButton
                edge="end"
                size="small"
                aria-label={`delete conversation: ${sessionLabel(session)}`}
                onClick={(e) => onDelete(e, session.id)}
                sx={{ mr: 0.5 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        )
      }
      onMouseEnter={() => onHoverChange(session.id)}
      onMouseLeave={() => onHoverChange(null)}
      // keyboard users never hover: reveal the same row actions on focus-within, so tabbing
      // to a row (or one of its own action buttons) exposes the "⋯" that opens the move menu
      onFocus={() => onHoverChange(session.id)}
      onBlur={(e) => {
        if (menuOpen) return;
        if (!e.currentTarget.contains(e.relatedTarget as Node)) onHoverChange(null);
      }}>
      <ListItemButton selected={active} onClick={() => onSelect(session.id)} sx={{ py: 1 }}>
        <ListItemText
          primary={
            <Typography variant="body2" noWrap sx={{ fontWeight: active ? 600 : 400 }}>
              {sessionLabel(session)}
            </Typography>
          }
        />
      </ListItemButton>
    </ListItem>
  );
};

const SectionHeading = ({ children }: { children: React.ReactNode }) => {
  const theme = useTheme();
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{
        px: 2,
        py: 1,
        display: "block",
        fontWeight: 500,
        bgcolor: theme.palette.mode === "dark" ? "grey.800" : "grey.100",
      }}>
      {children}
    </Typography>
  );
};

export const ChatHistorySidebar = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onNewSecretChat,
  onDeleteSession,
  onTogglePinSession,
  loading,
  onAfterSelect,
  projects = [],
  currentProjectId = null,
  onSelectCurrentProject,
  onNewChatInProject,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onMoveSession,
  onOpenProjectMemory,
  isSecretChat = false,
}: ChatHistorySidebarProps) => {
  const theme = useTheme();
  // on touch/mobile the delete icon is always visible (no hover); desktop keeps hover-reveal
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);

  const filingEnabled = Boolean(onMoveSession && onCreateProject);
  // a project's sessions come from the per-project endpoint, not the 50-capped session list,
  // and are fetched the first time the section is expanded
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [projectSessions, setProjectSessions] = useState<Record<string, ChatSession[]>>({});
  const [projectLoading, setProjectLoading] = useState<Record<string, boolean>>({});
  const [projectMenu, setProjectMenu] = useState<{ anchor: HTMLElement; project: Project } | null>(
    null,
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectError, setProjectError] = useState<string | null>(null);
  // kept apart from projectError: a failed rename belongs at the rename field, and must not
  // reappear under the next "New project" field the user opens
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteProjectError, setDeleteProjectError] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<{ anchor: HTMLElement; session: ChatSession } | null>(null);
  // non-null while the "New project…" field inside the move menu is open
  const [moveNewName, setMoveNewName] = useState<string | null>(null);
  const [newChatProjectAnchor, setNewChatProjectAnchor] = useState<HTMLElement | null>(null);
  // filing by drag uses the native HTML5 drag events rather than a drag library: the
  // "Move to…" menu already carries the keyboard and touch path this gesture is weak at, so
  // the only thing left to cover is the mouse, and that needs no dependency
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // the project id being hovered, or UNFILED_DROP for the unfiled section
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const unfiled = sessions.filter((s) => !s.projectId);
  /** what a project section shows: the parent's session list is authoritative (it carries the
   * optimistic moves and any chat just created here), the lazily fetched per-project list
   * supplies everything past the 50-session cap of that list. */
  const sessionsInProject = (projectId: string): ChatSession[] => {
    const live = sessions.filter((s) => s.projectId === projectId);
    const liveIds = new Set(live.map((s) => s.id));
    const cached = (projectSessions[projectId] ?? []).filter(
      (c) => !liveIds.has(c.id) && !sessions.some((s) => s.id === c.id),
    );
    return [...live, ...cached];
  };
  /** how many chats a project holds, or null while its list has never been fetched */
  const projectChatCount = (projectId: string): number | null =>
    projectId in projectSessions ? sessionsInProject(projectId).length : null;
  /** which project a row belongs to, including one that only the cache knows about */
  const projectOfSession = (sessionId: string): string | null =>
    sessions.find((s) => s.id === sessionId)?.projectId ??
    Object.keys(projectSessions).find((id) =>
      projectSessions[id].some((s) => s.id === sessionId),
    ) ??
    null;
  /** a row by id, wherever the sidebar shows it from */
  const findSession = (sessionId: string): ChatSession | null =>
    sessions.find((s) => s.id === sessionId) ??
    Object.values(projectSessions)
      .flat()
      .find((s) => s.id === sessionId) ??
    null;
  const grouped = groupSessionsByDate(unfiled);
  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;

  const loadProjectSessions = useCallback(async (projectId: string) => {
    setProjectLoading((prev) => ({ ...prev, [projectId]: true }));
    try {
      const loaded = await listProjectSessions(projectId);
      setProjectSessions((prev) => ({ ...prev, [projectId]: loaded }));
    } catch (err) {
      console.error("Failed to load project sessions:", err);
      // record the empty result too: the expand effect retries any project with no entry,
      // and a failing endpoint would otherwise be refetched on every render
      setProjectSessions((prev) => (projectId in prev ? prev : { ...prev, [projectId]: [] }));
    } finally {
      setProjectLoading((prev) => ({ ...prev, [projectId]: false }));
    }
  }, []);

  // a project the parent has just switched to (a section "+" or a move) is worth showing
  // filled in, so pull its sessions even if the user never expanded it by hand
  useEffect(() => {
    if (!currentProjectId) return;
    setExpanded((prev) => (prev.has(currentProjectId) ? prev : new Set(prev).add(currentProjectId)));
  }, [currentProjectId]);

  useEffect(() => {
    for (const projectId of expanded) {
      if (!(projectId in projectSessions) && !projectLoading[projectId]) {
        void loadProjectSessions(projectId);
      }
    }
  }, [expanded, projectSessions, projectLoading, loadProjectSessions]);

  // the parent re-reads the projects after anything that files, creates or deletes a chat,
  // so a project's server count moving is the one signal that its cached list is stale —
  // including deletions the parent makes on its own, which no sidebar action sees
  const countsKey = projects.map((p) => `${p.id}:${p.sessionCount}`).join(",");
  const lastCountsRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const previous = lastCountsRef.current;
    const current: Record<string, number> = {};
    for (const p of projects) current[p.id] = p.sessionCount;
    lastCountsRef.current = current;
    for (const p of projects) {
      if (p.id in previous && previous[p.id] !== p.sessionCount && p.id in projectSessions) {
        resyncProject(p.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countsKey]);

  // a session list update while a row is mid-drag (a move or delete landing elsewhere) can
  // unmount the dragged row without ever firing its dragend; left stray, draggingId would
  // pin the Unfiled heading open and the drop-fallback source open indefinitely
  useEffect(() => {
    if (draggingId && !findSession(draggingId)) {
      setDraggingId(null);
      setDropTarget(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  const toggleExpanded = (projectId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const handleDeleteClick = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setSessionToDelete(sessionId);
    setDeleteDialogOpen(true);
  };

  const handlePinClick = async (e: React.MouseEvent, sessionId: string, wasPinned: boolean) => {
    e.stopPropagation();
    // the parent flips its own list; a row past that list's cap lives only in the cache here,
    // where nothing else would move the star — including back, when the request fails
    const setCachedPin = (pinned: boolean) =>
      setProjectSessions((prev) =>
        Object.fromEntries(
          Object.entries(prev).map(([id, list]) => [
            id,
            list.map((s) => (s.id === sessionId ? { ...s, pinned } : s)),
          ]),
        ),
      );
    setCachedPin(!wasPinned);
    try {
      await onTogglePinSession(sessionId, wasPinned);
    } catch {
      setCachedPin(wasPinned);
    }
  };

  /** the cached per-project lists are only correct until the session list changes under them:
   * re-read an expanded section, and drop a collapsed one so its next expand refetches */
  const resyncProject = (projectId: string) => {
    if (expanded.has(projectId)) void loadProjectSessions(projectId);
    else setProjectSessions((prev) => omit(prev, projectId));
  };

  const handleConfirmDelete = async () => {
    const sessionId = sessionToDelete;
    setDeleteDialogOpen(false);
    setSessionToDelete(null);
    if (!sessionId) return;
    const projectId = projectOfSession(sessionId);
    try {
      await onDeleteSession(sessionId);
    } finally {
      if (projectId) resyncProject(projectId);
    }
  };

  const handleSelect = (sessionId: string) => {
    onSelectSession(sessionId);
    onAfterSelect?.();
  };

  const closeRowMenus = () => {
    setRowMenu(null);
    setMoveNewName(null);
  };

  /** the parent owns the session list and its rollback; the sidebar only has to keep the
   * per-project lists it caches in step, which it does by re-reading the two sides. */
  const applyMove = async (session: ChatSession, projectId: string | null) => {
    const from = session.projectId ?? null;
    closeRowMenus();
    try {
      await onMoveSession?.(session.id, projectId, from);
    } finally {
      for (const affected of [from, projectId]) {
        if (affected) resyncProject(affected);
      }
    }
  };

  /** props for a section that accepts a dragged conversation. `target` is the destination
   * project, or null for unfiled; a drop where the row already sits is not a move. */
  const dropZoneProps = (target: string | null) => {
    if (!filingEnabled) return {};
    const key = target ?? UNFILED_DROP;
    const dragged = draggingId ? findSession(draggingId) : null;
    const accepts = Boolean(dragged) && (dragged!.projectId ?? null) !== target;
    const active = dropTarget === key;
    return {
      "data-drop-active": active ? "true" : undefined,
      sx: {
        outline: active ? "2px solid" : "none",
        outlineColor: "primary.main",
        outlineOffset: "-2px",
        bgcolor: active ? "action.hover" : undefined,
      },
      onDragOver: (e: React.DragEvent) => {
        if (!accepts) return;
        // only a prevented dragover marks the element as a valid drop target
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        if (!active) setDropTarget(key);
      },
      // a child row's dragover/dragleave pair bubbles here too; only clear the target when
      // the pointer actually leaves the section, not when it crosses between its rows
      onDragLeave: (e: React.DragEvent) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDropTarget((prev) => (prev === key ? null : prev));
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setDropTarget(null);
        // draggingId is absent when the drop lands from outside this render (e.g. a reload
        // mid-drag), so the private mime type is the fallback source of the id
        const id = draggingId ?? e.dataTransfer?.getData("application/x-chat-session");
        setDraggingId(null);
        const session = id ? findSession(id) : null;
        if (!session || (session.projectId ?? null) === target) return;
        void applyMove(session, target);
      },
    };
  };

  const deleteCount = projectToDelete ? projectChatCount(projectToDelete.id) : null;
  /** the dialog names the number of chats at risk, so a collapsed project has to be fetched
   * here rather than waiting for an expand that may never happen */
  const openProjectDelete = (project: Project) => {
    setProjectToDelete(project);
    if (!(project.id in projectSessions) && !projectLoading[project.id]) {
      void loadProjectSessions(project.id);
    }
  };

  const closeProjectDelete = () => {
    setProjectToDelete(null);
    setDeleteProjectError(null);
  };

  const runDeleteProject = async (withSessions: boolean) => {
    const project = projectToDelete!;
    setDeleteProjectError(null);
    try {
      await onDeleteProject?.(project.id, withSessions);
      closeProjectDelete();
    } catch (err) {
      setDeleteProjectError(
        err instanceof Error ? err.message : "Could not delete the project",
      );
    }
  };

  const handleCreateProject = async (name: string, then?: (project: Project) => void) => {
    setProjectError(null);
    try {
      const project = await onCreateProject!(name.trim());
      then?.(project);
      return project;
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : "Could not create the project");
      return null;
    }
  };

  const renderSessionRow = (session: ChatSession) => (
    <SessionRow
      key={session.id}
      session={session}
      active={session.id === activeSessionId}
      hovered={isMobile || hoveredId === session.id}
      onHoverChange={setHoveredId}
      onSelect={handleSelect}
      onDelete={handleDeleteClick}
      onTogglePin={handlePinClick}
      onOpenRowMenu={
        filingEnabled ? (e, s) => setRowMenu({ anchor: e.currentTarget, session: s }) : undefined
      }
      menuOpen={rowMenu?.session.id === session.id}
      // with no project to drop into, a drag would have nowhere to land
      draggable={filingEnabled && projects.length > 0}
      dragging={draggingId === session.id}
      onDragStart={(e, s) => {
        // the private type carries the id; text/plain carries a label, so a drop into an
        // ordinary text field (Firefox requires setData to even start the drag) inserts
        // something readable rather than a bare UUID
        e.dataTransfer?.setData("application/x-chat-session", s.id);
        e.dataTransfer?.setData("text/plain", sessionLabel(s));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        setDraggingId(s.id);
      }}
      onDragEnd={() => {
        setDraggingId(null);
        setDropTarget(null);
      }}
    />
  );

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: theme.palette.mode === "dark" ? "grey.900" : "grey.50",
      }}>
      {/* header with new chat buttons */}
      <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", display: "flex", flexDirection: "column", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => {
              onNewChat();
              onAfterSelect?.();
            }}
            fullWidth
            sx={{ justifyContent: "flex-start" }}>
            New Chat
          </Button>
          {/* spacer to match Secret Chat row's info icon width */}
          <InfoOutlinedIcon fontSize="small" sx={{ visibility: "hidden" }} />
        </Box>
        {filingEnabled && !isSecretChat && projects.length > 0 && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, pl: 0.5 }}>
            <Typography variant="caption" color="text.secondary" noWrap>
              {currentProject ? `Project: ${currentProject.name}` : "No project"}
            </Typography>
            <IconButton
              size="small"
              aria-label="Choose project for new chat"
              onClick={(e) => setNewChatProjectAnchor(e.currentTarget)}>
              <ArrowDropDownIcon fontSize="small" />
            </IconButton>
          </Box>
        )}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Button
            variant="outlined"
            startIcon={<VisibilityOffIcon />}
            onClick={() => {
              onNewSecretChat();
              onAfterSelect?.();
            }}
            fullWidth
            sx={{ justifyContent: "flex-start" }}>
            Secret Chat
          </Button>
          <Tooltip
            title={
              <>
                Secret Chat means we do not log the conversation, but prompts are still sent to Anthropic, and we may use Perplexity for literature search. See the privacy policies of{" "}
                <a
                  href="https://privacy.claude.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "inherit", textDecoration: "underline" }}>
                  Anthropic
                </a>{" "}
                and{" "}
                <a
                  href="https://docs.perplexity.ai/docs/resources/privacy-security"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "inherit", textDecoration: "underline" }}>
                  Perplexity
                </a>
                .
              </>
            }
            componentsProps={{ tooltip: { sx: { fontSize: "0.875rem", "& a": { pointerEvents: "auto" } } } }}>
            <InfoOutlinedIcon fontSize="small" sx={{ color: "text.secondary", cursor: "help" }} />
          </Tooltip>
        </Box>
      </Box>

      {/* session list */}
      <Box sx={{ flex: 1, overflow: "auto" }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : sessions.length === 0 && projects.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
            No chat history yet
          </Typography>
        ) : (
          <>
            {/* project sections, in the order the server returns (most recently active first) */}
            {projects.map((project) => {
              const isOpen = expanded.has(project.id);
              const filed = sessionsInProject(project.id);
              return (
                <Box key={project.id} data-project-id={project.id} {...dropZoneProps(project.id)}>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      pr: 1,
                      bgcolor: theme.palette.mode === "dark" ? "grey.800" : "grey.100",
                    }}>
                    {renamingId === project.id ? (
                      <TextField
                        size="small"
                        autoFocus
                        variant="standard"
                        value={renameValue}
                        error={Boolean(renameError)}
                        helperText={renameError ?? "Enter to save, Esc to cancel"}
                        inputProps={{ "aria-label": `Rename project: ${project.name}` }}
                        onChange={(e) => {
                          setRenameValue(e.target.value);
                          setRenameError(null);
                        }}
                        // no cancel-on-blur: the header menu's focus trap blurs the field the
                        // moment it mounts, which would close it before it can be typed in
                        onKeyDown={async (e) => {
                          if (e.key === "Enter") {
                            const name = renameValue.trim();
                            if (!name || name === project.name) {
                              setRenamingId(null);
                              setRenameError(null);
                              return;
                            }
                            try {
                              await onRenameProject?.(project.id, name);
                              setRenamingId(null);
                              setRenameError(null);
                            } catch (err) {
                              // the field stays open: the message has to land somewhere the
                              // user can still act on it
                              setRenameError(
                                err instanceof Error ? err.message : "Could not rename",
                              );
                            }
                          } else if (e.key === "Escape") {
                            setRenamingId(null);
                            setRenameError(null);
                          }
                        }}
                        sx={{ flex: 1, px: 2, py: 0.5 }}
                      />
                    ) : (
                      <>
                        <ListItemButton
                          onClick={() => toggleExpanded(project.id)}
                          aria-expanded={isOpen}
                          aria-label={`Project: ${project.name}`}
                          sx={{ flex: 1, py: 0.5, minWidth: 0 }}>
                          {isOpen ? (
                            <ExpandLessIcon fontSize="small" sx={{ mr: 0.5 }} />
                          ) : (
                            <ExpandMoreIcon fontSize="small" sx={{ mr: 0.5 }} />
                          )}
                          <Typography variant="caption" noWrap sx={{ fontWeight: 600 }}>
                            {project.name} ({project.sessionCount})
                          </Typography>
                        </ListItemButton>
                        <IconButton
                          size="small"
                          aria-label={`New chat in ${project.name}`}
                          onClick={() => {
                            onNewChatInProject?.(project.id);
                            onAfterSelect?.();
                          }}>
                          <AddIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label={`Project menu: ${project.name}`}
                          onClick={(e) => setProjectMenu({ anchor: e.currentTarget, project })}>
                          <MoreHorizIcon fontSize="small" />
                        </IconButton>
                      </>
                    )}
                  </Box>
                  {isOpen && (
                    <List dense disablePadding>
                      {projectLoading[project.id] && filed.length === 0 ? (
                        <Box sx={{ display: "flex", justifyContent: "center", p: 1.5 }}>
                          <CircularProgress size={16} />
                        </Box>
                      ) : filed.length === 0 ? (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ px: 2, py: 1, display: "block" }}>
                          No chats in this project yet
                        </Typography>
                      ) : (
                        filed.map(renderSessionRow)
                      )}
                    </List>
                  )}
                </Box>
              );
            })}

            {/* unfiled conversations keep the date grouping and the 50-session cap. the
                heading also appears while a filed row is being dragged: with everything filed
                there would otherwise be nothing on screen to drop onto */}
            <Box data-unfiled-section="true" {...dropZoneProps(null)}>
              {projects.length > 0 && (unfiled.length > 0 || draggingId !== null) && (
                <SectionHeading>Unfiled</SectionHeading>
              )}
              {projects.length > 0 && unfiled.length === 0 && draggingId !== null && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ px: 2, py: 1, display: "block" }}>
                  Drop here to unfile
                </Typography>
              )}
              {Object.entries(grouped).map(([group, groupSessions]) =>
                groupSessions.length > 0 ? (
                  <Box key={group}>
                    <SectionHeading>{group}</SectionHeading>
                    <List dense disablePadding>
                      {groupSessions.map(renderSessionRow)}
                    </List>
                  </Box>
                ) : null,
              )}
            </Box>
          </>
        )}
      </Box>

      {/* new project, inline: no dialog, Enter creates */}
      {filingEnabled && (
        <Box sx={{ p: 1, borderTop: 1, borderColor: "divider" }}>
          {newProjectOpen ? (
            <TextField
              size="small"
              autoFocus
              fullWidth
              placeholder="Project name"
              value={newProjectName}
              error={Boolean(projectError)}
              helperText={projectError ?? undefined}
              inputProps={{ "aria-label": "New project name" }}
              onChange={(e) => {
                setNewProjectName(e.target.value);
                setProjectError(null);
              }}
              onKeyDown={async (e) => {
                if (e.key === "Enter") {
                  const created = await handleCreateProject(newProjectName);
                  if (created) {
                    setNewProjectName("");
                    setNewProjectOpen(false);
                  }
                } else if (e.key === "Escape") {
                  setNewProjectOpen(false);
                  setProjectError(null);
                }
              }}
            />
          ) : (
            <Button
              size="small"
              startIcon={<CreateNewFolderIcon />}
              onClick={() => {
                setProjectError(null);
                setNewProjectName("");
                setNewProjectOpen(true);
              }}
              fullWidth
              sx={{ justifyContent: "flex-start" }}>
              New project
            </Button>
          )}
        </Box>
      )}

      {/* which project the next new chat lands in */}
      <Menu
        anchorEl={newChatProjectAnchor}
        open={Boolean(newChatProjectAnchor)}
        onClose={() => setNewChatProjectAnchor(null)}>
        <MenuItem
          selected={currentProjectId === null}
          onClick={() => {
            onSelectCurrentProject?.(null);
            setNewChatProjectAnchor(null);
          }}>
          No project
        </MenuItem>
        {projects.map((project) => (
          <MenuItem
            key={project.id}
            selected={project.id === currentProjectId}
            onClick={() => {
              onSelectCurrentProject?.(project.id);
              setNewChatProjectAnchor(null);
            }}>
            {project.name}
          </MenuItem>
        ))}
      </Menu>

      {/* per-project header menu. disableRestoreFocus: closing it would otherwise pull focus
          back to the "⋯" button and blur the inline rename field it just opened */}
      <Menu
        anchorEl={projectMenu?.anchor ?? null}
        open={Boolean(projectMenu)}
        disableRestoreFocus
        onClose={() => setProjectMenu(null)}>
        <MenuItem
          onClick={() => {
            setRenameValue(projectMenu!.project.name);
            setRenameError(null);
            setRenamingId(projectMenu!.project.id);
            setProjectMenu(null);
          }}>
          Rename
        </MenuItem>
        <MenuItem
          onClick={() => {
            onOpenProjectMemory?.(projectMenu!.project.id);
            setProjectMenu(null);
          }}>
          Project memory
        </MenuItem>
        <MenuItem
          onClick={() => {
            openProjectDelete(projectMenu!.project);
            setProjectMenu(null);
          }}>
          Delete project
        </MenuItem>
      </Menu>

      {/* the row's "⋯" opens the project list directly. It opens to the right of the button,
          over the chat pane, so it never covers the titles of the rows beneath it */}
      <Menu
        anchorEl={rowMenu?.anchor ?? null}
        open={Boolean(rowMenu)}
        onClose={closeRowMenus}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}>
        <ListSubheader disableSticky sx={{ lineHeight: "32px" }}>
          Move to
        </ListSubheader>
        {projects
          .filter((p) => p.id !== rowMenu?.session.projectId)
          .map((project) => (
            <MenuItem key={project.id} onClick={() => applyMove(rowMenu!.session, project.id)}>
              {project.name}
            </MenuItem>
          ))}
        {moveNewName === null ? (
          <MenuItem onClick={() => setMoveNewName("")}>New project…</MenuItem>
        ) : (
          <MenuItem disableRipple onKeyDown={(e) => e.stopPropagation()}>
            <TextField
              size="small"
              autoFocus
              variant="standard"
              placeholder="Project name"
              value={moveNewName}
              error={Boolean(projectError)}
              helperText={projectError ?? undefined}
              inputProps={{ "aria-label": "New project name for move" }}
              onChange={(e) => {
                setMoveNewName(e.target.value);
                setProjectError(null);
              }}
              onKeyDown={async (e) => {
                if (e.key !== "Enter") return;
                const session = rowMenu!.session;
                const created = await handleCreateProject(moveNewName);
                if (created) await applyMove(session, created.id);
              }}
            />
          </MenuItem>
        )}
        {rowMenu?.session.projectId && [
          <Divider key="divider" />,
          <MenuItem key="unfile" onClick={() => applyMove(rowMenu.session, null)}>
            Unfile
          </MenuItem>,
        ]}
      </Menu>

      {/* delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete chat?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete this chat and all its messages.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleConfirmDelete} color="error" autoFocus>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* deleting a project is two decisions: the project, and what happens to its chats */}
      <Dialog open={Boolean(projectToDelete)} onClose={closeProjectDelete}>
        <DialogTitle>Delete project?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteCount === 0
              ? `"${projectToDelete?.name ?? ""}" will be deleted. It has no chats.`
              : `"${projectToDelete?.name ?? ""}" will be deleted. ${
                  deleteCount === null
                    ? "Its chats"
                    : `Its ${deleteCount} ${deleteCount === 1 ? "chat" : "chats"}`
                } can be kept as unfiled conversations, or deleted with it. Deleting them is permanent.`}
          </DialogContentText>
          {deleteProjectError && (
            <DialogContentText color="error" sx={{ mt: 1 }}>
              {deleteProjectError}
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeProjectDelete}>Cancel</Button>
          {/* with no chats at stake there is nothing to "keep": offer just Cancel / Delete */}
          {deleteCount !== 0 && (
            <Button onClick={() => runDeleteProject(false)}>Keep chats</Button>
          )}
          <Button color="error" onClick={() => runDeleteProject(true)}>
            {deleteCount === 0
              ? "Delete"
              : deleteCount
                ? `Delete ${deleteCount} ${deleteCount === 1 ? "chat" : "chats"} too`
                : "Delete chats too"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _dropped, ...rest } = record;
  return rest;
}
