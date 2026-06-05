import { useState, useEffect } from "react";
import {
  Button,
  TextField,
  Typography,
  CircularProgress,
  Alert,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  useTheme,
} from "@mui/material";
import { Delete as DeleteIcon } from "@mui/icons-material";
import { SideSheet } from "../../components/SideSheet";
import { getUserComments, addUserComment, deleteUserComment, type UserComment } from "./llmConfigApi";

interface FeedbackDialogProps {
  open: boolean;
  onClose: () => void;
}

export const FeedbackDialog = ({ open, onClose }: FeedbackDialogProps) => {
  const theme = useTheme();
  const [comments, setComments] = useState<UserComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      loadComments();
    }
  }, [open]);

  const loadComments = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getUserComments();
      setComments(data);
    } catch (err: any) {
      setError(err.message || "Failed to load comments");
    } finally {
      setLoading(false);
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

  return (
    <SideSheet open={open} onClose={onClose} title="Feedback">
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
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

        {loading ? (
          <CircularProgress size={24} />
        ) : (
          comments.length > 0 && (
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
          )
        )}
    </SideSheet>
  );
};
