import { Box, Button, Typography } from "@mui/material";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import { handlePhenoSummaryTableExport } from "./utils/export";
import { TableData } from "../../types/types";
import { useDataStore } from "../../store/store";
import { useServerQuery } from "../../store/serverQuery";

const PhenoExportToolbar = () => {
  const variantInput: string = useDataStore((state) => state.variantInput)!;
  const clientData: TableData = useDataStore((state) => state.clientData)!;
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
        disabled={isError || isFetching || isLoading}
        color="primary"
        onClick={() => {
          handlePhenoSummaryTableExport(clientData);
        }}
        startIcon={<FileDownloadIcon />}
        variant="contained"
        style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: "340px",
        }}>
        download variant/phenotype beta grid
      </Button>
      <Typography>
        The downloaded grid will contain beta or NA for each variant and phenotype. Note the grid
        will contain NAs when the p-value is larger than the above chosen threshold.
      </Typography>
    </Box>
  );
};

export default PhenoExportToolbar;
