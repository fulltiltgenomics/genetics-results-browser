import { Box, Button } from "@mui/material";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import { handleTissueSummaryTableExport, handleTissueTableExport } from "./utils/export";
import { TissueSummaryTableData } from "../../types/types";
import { useDataStore } from "../../store/store";
import { useServerQuery } from "../../store/serverQuery";

const TissueExportToolbar = ({
  summaryData,
  selectedPopulation,
}: {
  summaryData: TissueSummaryTableData;
  selectedPopulation: string | undefined;
}) => {
  const variantInput: string = useDataStore((state) => state.variantInput)!;
  const { isError, isFetching, isLoading } = useServerQuery(variantInput);

  return (
    <Box
      sx={{
        display: "flex",
        gap: "1rem",
        p: "0.5rem",
        flexWrap: "nowrap",
        flexDirection: "row",
      }}>
      <Button
        disabled={isError || isFetching || isLoading || summaryData.length === 0}
        color="primary"
        onClick={() => {
          handleTissueSummaryTableExport(summaryData);
        }}
        startIcon={<FileDownloadIcon />}
        variant="contained"
        style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: "340px",
        }}>
        download tissue summary table
      </Button>
      <Button
        disabled={isError || isFetching || isLoading || summaryData.length === 0}
        color="primary"
        onClick={() => {
          handleTissueTableExport(summaryData, selectedPopulation);
        }}
        startIcon={<FileDownloadIcon />}
        variant="contained"
        style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: "340px",
        }}>
        download tissue table with variants
      </Button>
    </Box>
  );
};

export default TissueExportToolbar;
