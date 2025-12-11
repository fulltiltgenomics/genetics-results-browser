import { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Rating,
  TextField,
  Button,
  Collapse,
  Paper,
  useTheme,
} from "@mui/material";
import { Star as StarIcon } from "@mui/icons-material";

interface SessionRatingProps {
  sessionId: string;
  rating: number | null;
  comment: string | null;
  onSave: (rating: number, comment?: string) => Promise<void>;
}

export const SessionRating = ({
  sessionId,
  rating,
  comment,
  onSave,
}: SessionRatingProps) => {
  const theme = useTheme();
  const [currentRating, setCurrentRating] = useState<number | null>(rating);
  const [currentComment, setCurrentComment] = useState(comment || "");
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // reset state when session changes
  useEffect(() => {
    setCurrentRating(rating);
    setCurrentComment(comment || "");
    setExpanded(false);
    setSaved(false);
  }, [sessionId, rating, comment]);

  const handleRatingChange = (_: unknown, value: number | null) => {
    setCurrentRating(value);
    if (value && !expanded) {
      setExpanded(true);
    }
  };

  const handleSave = async () => {
    if (!currentRating) return;
    setSaving(true);
    try {
      await onSave(currentRating, currentComment || undefined);
      setSaved(true);
      setExpanded(false);
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
    currentRating !== rating || currentComment !== (comment || "");

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        borderTop: 1,
        borderColor: "divider",
        bgcolor: theme.palette.mode === "dark" ? "grey.900" : "grey.50",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Rate this chat:
        </Typography>
        <Rating
          value={currentRating}
          onChange={handleRatingChange}
          icon={<StarIcon fontSize="inherit" />}
          emptyIcon={<StarIcon fontSize="inherit" />}
          size="medium"
        />
        {saved && !hasChanges && (
          <Typography variant="caption" color="success.main">
            Saved
          </Typography>
        )}
      </Box>

      <Collapse in={expanded || (currentRating !== null && hasChanges)}>
        <Box sx={{ mt: 2 }}>
          <TextField
            fullWidth
            size="small"
            multiline
            minRows={2}
            maxRows={4}
            placeholder="Add a comment about this chat (optional)"
            value={currentComment}
            onChange={(e) => setCurrentComment(e.target.value)}
            sx={{ mb: 1 }}
          />
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              variant="contained"
              size="small"
              onClick={handleSave}
              disabled={saving || !currentRating}
            >
              {saving ? "Saving..." : "Save Rating"}
            </Button>
            <Button
              variant="text"
              size="small"
              onClick={() => setExpanded(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
};
