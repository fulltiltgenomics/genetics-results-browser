import { Box, Tooltip } from "@mui/material";
import { CredibleSetDataType } from "../../types/types.normalized";

/**
 * Small square letter badge for a credible-set data type (e.g. [G] GWAS, [P] pQTL), each in its own
 * colour. Shared by the variant table's "top association" column and the data-type filter toggles so
 * the legend stays consistent. Unknown types fall back to "?".
 */
export const DATA_TYPE_META: Record<CredibleSetDataType, { label: string; color: string }> = {
  GWAS: { label: "G", color: "#1565c0" }, // blue
  eQTL: { label: "E", color: "#2e7d32" }, // green
  pQTL: { label: "P", color: "#6a1b9a" }, // purple
  sQTL: { label: "S", color: "#ef6c00" }, // orange
  caQTL: { label: "C", color: "#c62828" }, // red
  edQTL: { label: "Ed", color: "#5d4037" }, // brown
  metaboQTL: { label: "M", color: "#ad1457" }, // pink
};

const FALLBACK = { label: "?", color: "#757575" };

export const DataTypeIcon = ({
  dataType,
  size = 16,
}: {
  dataType: CredibleSetDataType;
  size?: number;
}) => {
  const meta = DATA_TYPE_META[dataType] ?? FALLBACK;
  return (
    <Tooltip title={dataType}>
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: size,
          height: size,
          px: meta.label.length > 1 ? "3px" : 0,
          borderRadius: "3px",
          backgroundColor: meta.color,
          color: "#fff",
          fontSize: "0.62rem",
          fontWeight: 700,
          lineHeight: 1,
          flexShrink: 0,
        }}>
        {meta.label}
      </Box>
    </Tooltip>
  );
};

export default DataTypeIcon;
