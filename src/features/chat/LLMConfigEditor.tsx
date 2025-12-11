import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  Tabs,
  Tab,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  CircularProgress,
  Alert,
  IconButton,
  useTheme,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
} from "@mui/material";
import {
  ExpandMore as ExpandMoreIcon,
  RestartAlt as ResetIcon,
  Undo as UndoIcon,
  Delete as DeleteIcon,
} from "@mui/icons-material";
import {
  getDefaults,
  getUserInstructions,
  updateUserInstructions,
  deleteUserInstructions,
  getUserToolDescriptions,
  updateUserToolDescription,
  deleteUserToolDescription,
  getUserComments,
  addUserComment,
  deleteUserComment,
  type UserInstructions,
  type UserToolDescription,
  type UserComment,
} from "./llmConfigApi";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div hidden={value !== index} style={{ height: "100%", overflow: "auto" }}>
      {value === index && <Box sx={{ p: 2 }}>{children}</Box>}
    </div>
  );
}

export const LLMConfigEditor = () => {
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // user instructions state (replaces system prompt)
  const [userInstructions, setUserInstructions] = useState("");
  const [userInstructionsMeta, setUserInstructionsMeta] = useState<UserInstructions | null>(null);
  const [instructionsComment, setInstructionsComment] = useState("");
  const [undoInstructions, setUndoInstructions] = useState<string | null>(null);

  // tool descriptions state
  const [defaultDescriptions, setDefaultDescriptions] = useState<Record<string, string>>({});
  const [userToolOverrides, setUserToolOverrides] = useState<Record<string, UserToolDescription>>(
    {}
  );
  const [toolEdits, setToolEdits] = useState<Record<string, string>>({});
  const [toolComments, setToolComments] = useState<Record<string, string>>({});
  const [expandedTool, setExpandedTool] = useState<string | false>(false);
  const [undoToolDescription, setUndoToolDescription] = useState<{
    toolName: string;
    description: string;
  } | null>(null);

  // random comments state
  const [comments, setComments] = useState<UserComment[]>([]);
  const [newComment, setNewComment] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [instructionsData, userToolsData, defaults, commentsData] = await Promise.all([
        getUserInstructions(),
        getUserToolDescriptions(),
        getDefaults(),
        getUserComments(),
      ]);

      // load user's additional instructions
      if (instructionsData) {
        setUserInstructions(instructionsData.instructions);
        setUserInstructionsMeta(instructionsData);
      } else {
        setUserInstructions("");
      }

      // build default descriptions map
      const defaultDescs: Record<string, string> = {};
      for (const tool of defaults.toolDescriptions) {
        defaultDescs[tool.toolName] = tool.description;
      }
      setDefaultDescriptions(defaultDescs);

      // store user overrides
      setUserToolOverrides(userToolsData);

      // initialize edit state: use user override or default
      const edits: Record<string, string> = {};
      for (const toolName of Object.keys(defaultDescs)) {
        const userOverride = userToolsData[toolName];
        edits[toolName] = userOverride ? userOverride.description : defaultDescs[toolName];
      }
      setToolEdits(edits);

      // load comments
      setComments(commentsData);
    } catch (err: any) {
      setError(err.message || "Failed to load configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveInstructions = async () => {
    setSaving(true);
    setError(null);
    try {
      if (!userInstructions.trim()) {
        // delete instructions if empty
        await deleteUserInstructions();
        setUserInstructionsMeta(null);
      } else {
        const result = await updateUserInstructions(
          userInstructions,
          instructionsComment || undefined
        );
        setUserInstructionsMeta(result);
      }
      setInstructionsComment("");
    } catch (err: any) {
      setError(err.message || "Failed to save instructions");
    } finally {
      setSaving(false);
    }
  };

  const handleClearInstructions = async () => {
    setSaving(true);
    setError(null);
    const previousValue = userInstructions;
    try {
      await deleteUserInstructions();
      setUndoInstructions(previousValue);
      setUserInstructions("");
      setUserInstructionsMeta(null);
    } catch (err: any) {
      setError(err.message || "Failed to clear instructions");
    } finally {
      setSaving(false);
    }
  };

  const handleUndoClearInstructions = async () => {
    if (!undoInstructions) return;
    setSaving(true);
    setError(null);
    try {
      const result = await updateUserInstructions(undoInstructions, "Restored after clear");
      setUserInstructions(undoInstructions);
      setUserInstructionsMeta(result);
      setUndoInstructions(null);
    } catch (err: any) {
      setError(err.message || "Failed to restore instructions");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTool = async (toolName: string) => {
    const description = toolEdits[toolName];
    if (!description?.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await updateUserToolDescription(
        toolName,
        description,
        toolComments[toolName] || undefined
      );
      setUserToolOverrides((prev) => ({ ...prev, [toolName]: result }));
      setToolComments((prev) => ({ ...prev, [toolName]: "" }));
    } catch (err: any) {
      setError(err.message || "Failed to save tool description");
    } finally {
      setSaving(false);
    }
  };

  const handleResetTool = async (toolName: string) => {
    setSaving(true);
    setError(null);
    const previousValue = toolEdits[toolName];
    try {
      await deleteUserToolDescription(toolName);
      setUndoToolDescription({ toolName, description: previousValue });
      // reset to default
      setToolEdits((prev) => ({ ...prev, [toolName]: defaultDescriptions[toolName] }));
      setUserToolOverrides((prev) => {
        const newOverrides = { ...prev };
        delete newOverrides[toolName];
        return newOverrides;
      });
    } catch (err: any) {
      setError(err.message || "Failed to reset tool description");
    } finally {
      setSaving(false);
    }
  };

  const handleUndoResetTool = async () => {
    if (!undoToolDescription) return;
    const { toolName, description } = undoToolDescription;
    setSaving(true);
    setError(null);
    try {
      const result = await updateUserToolDescription(toolName, description, "Restored after reset");
      setToolEdits((prev) => ({ ...prev, [toolName]: description }));
      setUserToolOverrides((prev) => ({ ...prev, [toolName]: result }));
      setUndoToolDescription(null);
    } catch (err: any) {
      setError(err.message || "Failed to restore tool description");
    } finally {
      setSaving(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await addUserComment(newComment);
      setComments((prev) => [result, ...prev]);
      setNewComment("");
    } catch (err: any) {
      setError(err.message || "Failed to add comment");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    setSaving(true);
    setError(null);
    try {
      await deleteUserComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err: any) {
      setError(err.message || "Failed to delete comment");
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  if (loading) {
    return (
      <Paper
        sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Paper>
    );
  }

  return (
    <Paper
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
      {error && (
        <Alert severity="error" sx={{ m: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* tabs */}
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tab label="Instructions" />
        <Tab label="Tools" />
        <Tab label="Comments" />
      </Tabs>

      {/* additional instructions tab */}
      <TabPanel value={activeTab} index={0}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Add custom instructions or directives to customize FinnGenie's behavior. These are
          appended to the base system prompt (high-level instructions for the AI to follow).
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Your instructions are saved for your subsequent sessions and we can use them to improve
          the chat.
        </Typography>

        {userInstructionsMeta && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Last saved on {formatDate(userInstructionsMeta.changedAt)}
            {userInstructionsMeta.comment && ` - "${userInstructionsMeta.comment}"`}
          </Typography>
        )}

        <TextField
          fullWidth
          multiline
          minRows={10}
          maxRows={20}
          value={userInstructions}
          onChange={(e) => setUserInstructions(e.target.value)}
          placeholder="Enter additional instructions to customize AI behavior

Examples:
- Always cite specific variants when discussing associations
- Always include the resource (e.g. FinnGen) when mentioning a phenotype
- Don't hallucinate"
          sx={{ mb: 2, "& .MuiInputBase-root": { fontFamily: "monospace", fontSize: "0.85rem" } }}
        />

        <TextField
          fullWidth
          size="small"
          value={instructionsComment}
          onChange={(e) => setInstructionsComment(e.target.value)}
          placeholder="Comment (optional) - describe what brought you to change the instructions"
          sx={{ mb: 2 }}
        />

        <Box sx={{ display: "flex", gap: 1 }}>
          <Button variant="contained" onClick={handleSaveInstructions} disabled={saving}>
            {saving ? <CircularProgress size={20} /> : "Save"}
          </Button>
          {userInstructionsMeta && (
            <Button
              variant="outlined"
              color="warning"
              startIcon={<ResetIcon />}
              onClick={handleClearInstructions}
              disabled={saving}>
              Clear
            </Button>
          )}
          {undoInstructions && (
            <Button
              variant="outlined"
              startIcon={<UndoIcon />}
              onClick={handleUndoClearInstructions}
              disabled={saving}>
              Undo
            </Button>
          )}
        </Box>
      </TabPanel>

      {/* tool descriptions tab */}
      <TabPanel value={activeTab} index={1}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          There are a set of "MCP tools" or API endpoints FinnGenie uses to connect to our data
          sources. Here you can customize tool descriptions to change how FinnGenie uses each tool.
          Your changes override the defaults.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Your customizations are saved for your subsequent sessions and we can use them to improve
          the chat.
        </Typography>

        {Object.keys(defaultDescriptions).length === 0 ? (
          <Typography color="text.secondary">No tools available.</Typography>
        ) : (
          Object.keys(defaultDescriptions)
            .sort()
            .map((toolName) => {
              const userOverride = userToolOverrides[toolName];
              const hasCustom = !!userOverride;
              return (
                <Accordion
                  key={toolName}
                  expanded={expandedTool === toolName}
                  onChange={(_, isExpanded) => setExpandedTool(isExpanded ? toolName : false)}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography sx={{ fontFamily: "monospace" }}>{toolName}</Typography>
                      {hasCustom ? (
                        <Typography variant="caption" color="primary">
                          (customized)
                        </Typography>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          (default)
                        </Typography>
                      )}
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    {hasCustom ? (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mb: 1 }}>
                        Customized on {formatDate(userOverride.changedAt)}
                        {userOverride.comment && ` - "${userOverride.comment}"`}
                      </Typography>
                    ) : (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mb: 1 }}>
                        Using default description
                      </Typography>
                    )}

                    <TextField
                      fullWidth
                      multiline
                      minRows={5}
                      maxRows={12}
                      value={toolEdits[toolName] || ""}
                      onChange={(e) =>
                        setToolEdits((prev) => ({ ...prev, [toolName]: e.target.value }))
                      }
                      sx={{
                        mb: 2,
                        "& .MuiInputBase-root": { fontFamily: "monospace", fontSize: "0.85rem" },
                      }}
                    />

                    <TextField
                      fullWidth
                      size="small"
                      value={toolComments[toolName] || ""}
                      onChange={(e) =>
                        setToolComments((prev) => ({ ...prev, [toolName]: e.target.value }))
                      }
                      placeholder="Comment (optional)"
                      sx={{ mb: 2 }}
                    />

                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Button
                        variant="contained"
                        size="small"
                        onClick={() => handleSaveTool(toolName)}
                        disabled={saving}>
                        {saving ? <CircularProgress size={16} /> : "Save"}
                      </Button>
                      {hasCustom && (
                        <Button
                          variant="outlined"
                          size="small"
                          color="warning"
                          startIcon={<ResetIcon />}
                          onClick={() => handleResetTool(toolName)}
                          disabled={saving}>
                          Reset to Default
                        </Button>
                      )}
                      {undoToolDescription?.toolName === toolName && (
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<UndoIcon />}
                          onClick={handleUndoResetTool}
                          disabled={saving}>
                          Undo
                        </Button>
                      )}
                    </Box>
                  </AccordionDetails>
                </Accordion>
              );
            })
        )}
      </TabPanel>

      {/* random comments tab */}
      <TabPanel value={activeTab} index={2}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Leave any comments, feedback, or notes about your experience with FinnGenie. This helps us
          understand how FinnGenie is being used and how we can improve it.
        </Typography>

        <TextField
          fullWidth
          multiline
          minRows={3}
          maxRows={6}
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Enter your comment, feedback, or notes..."
          sx={{ mb: 2 }}
        />

        <Button
          variant="contained"
          onClick={handleAddComment}
          disabled={saving || !newComment.trim()}
          sx={{ mb: 3 }}>
          {saving ? <CircularProgress size={20} /> : "Add Comment"}
        </Button>

        {comments.length > 0 && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Your previous comments
            </Typography>
            <List dense>
              {comments.map((comment) => (
                <ListItem
                  key={comment.id}
                  sx={{
                    bgcolor: theme.palette.mode === "dark" ? "grey.800" : "grey.50",
                    mb: 1,
                    borderRadius: 1,
                  }}>
                  <ListItemText
                    primary={comment.comment}
                    secondary={formatDate(comment.createdAt) + " GMT"}
                    primaryTypographyProps={{ sx: { whiteSpace: "pre-wrap" } }}
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={() => handleDeleteComment(comment.id)}
                      disabled={saving}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          </>
        )}
      </TabPanel>
    </Paper>
  );
};
