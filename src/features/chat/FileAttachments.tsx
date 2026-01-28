import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import {
  Close as CloseIcon,
  Image as ImageIcon,
  TableChart as TableIcon,
  Description as ExcelIcon,
  Error as ErrorIcon,
} from "@mui/icons-material";
import type { PendingAttachment, FileAttachment } from "./chat.types";

interface PendingAttachmentsProps {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
  disabled?: boolean;
}

export const PendingAttachments = ({
  attachments,
  onRemove,
  disabled,
}: PendingAttachmentsProps) => {
  const theme = useTheme();

  if (attachments.length === 0) return null;

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1 }}>
      {attachments.map((attachment) => (
        <Paper
          key={attachment.id}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            p: 0.5,
            pl: 1,
            bgcolor: theme.palette.mode === "dark" ? "grey.800" : "grey.100",
            border: attachment.status === "error" ? `1px solid ${theme.palette.error.main}` : undefined,
          }}>
          {attachment.status === "uploading" ? (
            <CircularProgress size={16} />
          ) : attachment.status === "error" ? (
            <Tooltip title={attachment.error || "Upload failed"}>
              <ErrorIcon fontSize="small" color="error" />
            </Tooltip>
          ) : (
            <AttachmentIcon type={attachment.type} />
          )}

          {attachment.type === "image" && attachment.previewUrl && (
            <Box
              component="img"
              src={attachment.previewUrl}
              alt={attachment.name}
              sx={{
                width: 32,
                height: 32,
                objectFit: "cover",
                borderRadius: 0.5,
              }}
            />
          )}

          <Tooltip title={attachment.name}>
            <Typography
              variant="body2"
              sx={{
                maxWidth: 120,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
              {attachment.name}
            </Typography>
          </Tooltip>

          <Typography variant="caption" color="text.secondary">
            {formatFileSize(attachment.size)}
          </Typography>

          <IconButton
            size="small"
            onClick={() => onRemove(attachment.id)}
            disabled={disabled || attachment.status === "uploading"}
            sx={{ p: 0.25 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Paper>
      ))}
    </Box>
  );
};

interface MessageAttachmentsProps {
  attachments: FileAttachment[];
  isUserMessage?: boolean;
}

export const MessageAttachments = ({
  attachments,
  isUserMessage,
}: MessageAttachmentsProps) => {
  const theme = useTheme();

  if (!attachments || attachments.length === 0) return null;

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1 }}>
      {attachments.map((attachment) => (
        <Box key={attachment.id}>
          {attachment.type === "image" && attachment.previewUrl ? (
            <Box
              component="img"
              src={attachment.previewUrl}
              alt={attachment.name}
              sx={{
                maxWidth: 200,
                maxHeight: 150,
                borderRadius: 1,
                cursor: "pointer",
              }}
              onClick={() => window.open(attachment.previewUrl, "_blank")}
            />
          ) : (
            <Chip
              icon={<AttachmentIcon type={attachment.type} />}
              label={attachment.name}
              size="small"
              variant="outlined"
              sx={{
                bgcolor: isUserMessage
                  ? "rgba(255,255,255,0.1)"
                  : theme.palette.mode === "dark"
                  ? "grey.800"
                  : "grey.100",
              }}
            />
          )}
        </Box>
      ))}
    </Box>
  );
};

const AttachmentIcon = ({ type }: { type: string }) => {
  switch (type) {
    case "image":
      return <ImageIcon fontSize="small" />;
    case "tsv":
      return <TableIcon fontSize="small" />;
    case "excel":
      return <ExcelIcon fontSize="small" color="success" />;
    default:
      return <TableIcon fontSize="small" />;
  }
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
