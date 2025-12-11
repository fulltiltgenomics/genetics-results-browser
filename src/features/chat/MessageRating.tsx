import { useState } from "react";
import { Box, IconButton, Tooltip } from "@mui/material";
import {
  ThumbUp as ThumbUpIcon,
  ThumbUpOutlined as ThumbUpOutlinedIcon,
  ThumbDown as ThumbDownIcon,
  ThumbDownOutlined as ThumbDownOutlinedIcon,
} from "@mui/icons-material";

interface MessageRatingProps {
  messageId: string;
  thumbsUp: boolean | null;
  onRate: (messageId: string, thumbsUp: boolean | null) => void;
  visible?: boolean;
}

export const MessageRating = ({
  messageId,
  thumbsUp,
  onRate,
  visible = false,
}: MessageRatingProps) => {
  const [saving, setSaving] = useState(false);

  const handleRate = async (newValue: boolean | null) => {
    // toggle off if clicking same rating
    const valueToSend = thumbsUp === newValue ? null : newValue;
    setSaving(true);
    try {
      await onRate(messageId, valueToSend);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        gap: 0.5,
        opacity: visible || thumbsUp !== null ? 1 : 0,
        transition: "opacity 0.2s",
      }}
    >
      <Tooltip title={thumbsUp === true ? "Remove rating" : "Good response"}>
        <IconButton
          size="small"
          onClick={() => handleRate(true)}
          disabled={saving}
          sx={{ p: 0.5 }}
        >
          {thumbsUp === true ? (
            <ThumbUpIcon fontSize="small" color="primary" />
          ) : (
            <ThumbUpOutlinedIcon fontSize="small" />
          )}
        </IconButton>
      </Tooltip>
      <Tooltip title={thumbsUp === false ? "Remove rating" : "Bad response"}>
        <IconButton
          size="small"
          onClick={() => handleRate(false)}
          disabled={saving}
          sx={{ p: 0.5 }}
        >
          {thumbsUp === false ? (
            <ThumbDownIcon fontSize="small" color="error" />
          ) : (
            <ThumbDownOutlinedIcon fontSize="small" />
          )}
        </IconButton>
      </Tooltip>
    </Box>
  );
};
