import { Box, Button, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useGeneInfo } from "@/store/serverQuery";
import GeneEvidenceTab from "./GeneEvidenceTab";
import GeneNotFound from "./GeneNotFound";

const GeneEvidencePage = () => {
  const { geneName } = useParams();
  const navigate = useNavigate();
  const { data: geneInfo, error: geneInfoError } = useGeneInfo(geneName);
  const [inputGeneName, setInputGeneName] = useState("");
  const wanted = inputGeneName.trim();

  return (
    <Box display="flex" flexDirection="column">
      <Box
        component="form"
        display="flex"
        flexDirection="column"
        onSubmit={(event) => {
          event.preventDefault();
          if (wanted) {
            navigate(`/gene/${encodeURIComponent(wanted)}`);
          }
        }}>
        <TextField
          label="Enter a gene name"
          value={inputGeneName}
          onChange={(event) => setInputGeneName(event.target.value)}
          variant="outlined"
          margin="normal"
          size="small"
          style={{ width: "160px" }}
        />
        <Button
          type="submit"
          sx={{ marginBottom: "10px", width: "160px" }}
          size="small"
          color="primary"
          variant="contained"
          disabled={!wanted}>
          Show evidence
        </Button>
      </Box>
      {geneName &&
        (geneInfo ? (
          <GeneEvidenceTab geneName={geneInfo.symbol} />
        ) : geneInfoError ? (
          <GeneNotFound error={geneInfoError} />
        ) : (
          <Typography>Loading...</Typography>
        ))}
    </Box>
  );
};

export default GeneEvidencePage;
