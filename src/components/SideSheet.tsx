import { ReactNode } from "react";
import { Drawer, Box, Typography, IconButton, Divider } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

interface SideSheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  // optional leading header content, e.g. a master/detail back button
  headerLeading?: ReactNode;
  // optional right-aligned action row pinned below the scrollable body
  footer?: ReactNode;
  // let the consumer own body padding/layout (e.g. SchemaDrawer's rail + detail panes)
  disableContentPadding?: boolean;
  children: ReactNode;
}

// shared width for every auxiliary panel: full-screen on mobile, capped at 80% of the
// viewport (never wider than 1100px) on desktop so the chat behind stays partly visible.
const SHEET_WIDTH = { xs: "100%", sm: "min(1100px, 80vw)" };

/**
 * Right-anchored side sheet used for all of the chat's auxiliary surfaces (About, Feedback,
 * MCP/API keys, Datasets, Database tables). Standardizes width, header, scroll, and mobile
 * full-screen behavior so the panels feel consistent. The temporary Drawer already closes on
 * Esc and backdrop click via onClose.
 */
export const SideSheet = ({
  open,
  onClose,
  title,
  headerLeading,
  footer,
  disableContentPadding,
  children,
}: SideSheetProps) => (
  <Drawer
    anchor="right"
    variant="temporary"
    open={open}
    onClose={onClose}
    PaperProps={{ sx: { width: SHEET_WIDTH, maxWidth: "100vw" } }}
  >
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        px: 2,
        py: 1.5,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        {headerLeading}
        <Typography variant="h6" noWrap>
          {title}
        </Typography>
      </Box>
      <IconButton onClick={onClose} size="small" aria-label="close">
        <CloseIcon />
      </IconButton>
    </Box>
    <Divider />

    <Box
      sx={
        disableContentPadding
          ? // consumer owns padding and manages its own internal scroll (e.g. rail + detail panes)
            { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }
          : { flex: 1, minHeight: 0, overflowY: "auto", p: 2 }
      }
    >
      {children}
    </Box>

    {footer && (
      <>
        <Divider />
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, px: 2, py: 1.5 }}>
          {footer}
        </Box>
      </>
    )}
  </Drawer>
);
