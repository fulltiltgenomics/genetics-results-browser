import { useState } from "react";
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  IconButton,
  Typography,
  Button,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Tooltip,
  useTheme,
} from "@mui/material";
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  VisibilityOff as VisibilityOffIcon,
  InfoOutlined as InfoOutlinedIcon,
} from "@mui/icons-material";
import type { ChatSession } from "./chatHistoryApi";

interface ChatHistorySidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onNewSecretChat: () => void;
  onDeleteSession: (sessionId: string) => void;
  loading: boolean;
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

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

export const ChatHistorySidebar = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onNewSecretChat,
  onDeleteSession,
  loading,
}: ChatHistorySidebarProps) => {
  const theme = useTheme();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);

  const grouped = groupSessionsByDate(sessions);

  const handleDeleteClick = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setSessionToDelete(sessionId);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (sessionToDelete) {
      onDeleteSession(sessionToDelete);
    }
    setDeleteDialogOpen(false);
    setSessionToDelete(null);
  };

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
            onClick={onNewChat}
            fullWidth
            sx={{ justifyContent: "flex-start" }}>
            New Chat
          </Button>
          {/* spacer to match Secret Chat row's info icon width */}
          <InfoOutlinedIcon fontSize="small" sx={{ visibility: "hidden" }} />
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Button
            variant="outlined"
            startIcon={<VisibilityOffIcon />}
            onClick={onNewSecretChat}
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
        ) : sessions.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
            No chat history yet
          </Typography>
        ) : (
          Object.entries(grouped).map(([group, groupSessions]) =>
            groupSessions.length > 0 ? (
              <Box key={group}>
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
                  {group}
                </Typography>
                <List dense disablePadding>
                  {groupSessions.map((session) => (
                    <ListItem
                      key={session.id}
                      disablePadding
                      secondaryAction={
                        hoveredId === session.id && (
                          <IconButton
                            edge="end"
                            size="small"
                            onClick={(e) => handleDeleteClick(e, session.id)}
                            sx={{ mr: 0.5 }}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        )
                      }
                      onMouseEnter={() => setHoveredId(session.id)}
                      onMouseLeave={() => setHoveredId(null)}>
                      <ListItemButton
                        selected={session.id === activeSessionId}
                        onClick={() => onSelectSession(session.id)}
                        sx={{
                          py: 1,
                          pr: hoveredId === session.id ? 5 : 2,
                        }}>
                        <ListItemText
                          primary={
                            <Typography
                              variant="body2"
                              noWrap
                              sx={{
                                fontWeight: session.id === activeSessionId ? 600 : 400,
                              }}>
                              {session.title || session.preview || "New Chat"}
                            </Typography>
                          }
                          // secondary={
                          //   <Typography variant="caption" color="text.secondary">
                          //     {formatRelativeTime(session.updatedAt)}
                          //   </Typography>
                          // }
                        />
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              </Box>
            ) : null
          )
        )}
      </Box>

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
    </Box>
  );
};
