import { Box, Typography, useTheme } from "@mui/material";
import { Download as DownloadIcon } from "@mui/icons-material";
import { formatFileSize } from "./FileAttachments";
import { base64ByteLength, base64ToBytes } from "./fileMarker";
import { downloadBlob } from "./downloadBlob";

/**
 * One non-image artifact a turn produced, as a control that saves it.
 *
 * The bytes are decoded on click rather than on render: a transcript can hold several
 * artifacts of several megabytes each, and they would otherwise be decoded again on every
 * frame of the stream that follows them.
 */
export const FileDownload = ({
  mime,
  name,
  data,
}: {
  mime: string;
  name: string;
  data: string;
}) => {
  const theme = useTheme();

  return (
    <Box
      component="button"
      type="button"
      onClick={() => downloadBlob(base64ToBytes(data), name, mime)}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        my: 1,
        px: 1,
        py: 0.5,
        maxWidth: "100%",
        font: "inherit",
        textAlign: "left",
        cursor: "pointer",
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 1,
        bgcolor: theme.palette.mode === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
        color: "text.primary",
        "&:hover": { bgcolor: theme.palette.action.hover },
      }}>
      <DownloadIcon sx={{ fontSize: 18, color: "text.secondary" }} />
      <Typography
        variant="body2"
        sx={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {formatFileSize(base64ByteLength(data))}
      </Typography>
    </Box>
  );
};
