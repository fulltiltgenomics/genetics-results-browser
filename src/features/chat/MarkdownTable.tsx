import { Box, Tooltip, Typography } from "@mui/material";
import { Download as DownloadIcon } from "@mui/icons-material";
import { useRef, type ComponentProps } from "react";
import type { ExtraProps } from "react-markdown";
import { downloadBlob } from "./downloadBlob";
import { tableToCsv } from "./tableCsv";

/**
 * A markdown table, plus a control that saves it as CSV.
 *
 * An answer's evidence often arrives as a table with more rows than anyone will retype, and
 * the transcript was the only place it existed. The table itself is rendered unchanged — the
 * styling that applies to it lives on an ancestor and reaches it through a descendant
 * selector, so the wrapper carries no layout of its own.
 */
export const MarkdownTable = ({
  node: _node,
  children,
  ...props
}: ComponentProps<"table"> & ExtraProps) => {
  const tableRef = useRef<HTMLTableElement>(null);

  const download = () => {
    if (tableRef.current) downloadBlob(tableToCsv(tableRef.current), "table.csv", "text/csv");
  };

  return (
    <Box>
      <table ref={tableRef} {...props}>
        {children}
      </table>
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Tooltip title="Download this table as CSV">
          <Box
            component="button"
            type="button"
            aria-label="Download table as CSV"
            onClick={download}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.25,
              px: 0.5,
              py: 0.25,
              border: "none",
              borderRadius: 0.5,
              bgcolor: "transparent",
              color: "text.disabled",
              cursor: "pointer",
              "&:hover": { color: "text.secondary", bgcolor: "action.hover" },
            }}>
            <DownloadIcon sx={{ fontSize: 14 }} />
            <Typography variant="caption" component="span">
              CSV
            </Typography>
          </Box>
        </Tooltip>
      </Box>
    </Box>
  );
};
