import { Box, useTheme } from "@mui/material";
import { Download as DownloadIcon } from "@mui/icons-material";
import { base64ToBytes } from "./fileMarker";
import { downloadBlob } from "./downloadBlob";

/**
 * A file name written in the narration, as a control that saves the bytes the same message
 * carries. The full control with its size is FileDownload, rendered where the marker sits;
 * this is the inline form, so a sentence keeps reading as a sentence.
 *
 * Decoded on click, for the reason FileDownload decodes on click: an artifact is routinely
 * megabytes and a name can be repeated several times in one message.
 */
export const ArtifactLink = ({
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
        display: "inline",
        p: 0,
        border: 0,
        bgcolor: "transparent",
        font: "inherit",
        color: theme.palette.primary.main,
        cursor: "pointer",
        textDecoration: "underline",
        textUnderlineOffset: "2px",
        "&:hover": { textDecoration: "underline", filter: "brightness(1.2)" },
      }}>
      {name}
      <DownloadIcon sx={{ fontSize: "0.9em", verticalAlign: "-0.1em", ml: 0.25 }} />
    </Box>
  );
};
