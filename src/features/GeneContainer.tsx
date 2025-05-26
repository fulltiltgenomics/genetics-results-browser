import { Box, Button, TextField, Typography, useTheme } from "@mui/material";
import CisView from "./CisView";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const GeneContainer = () => {
  const params = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const [geneName, setGeneName] = useState("");
  useEffect(() => {
    if (params.geneName) {
      setGeneName(params.geneName);
    }
  }, [params.geneName]);
  const [inputGeneName, setInputGeneName] = useState("");

  const handleInputGeneNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputGeneName(event.target.value);
  };

  const handleSetGeneName = () => {
    navigate(`/gene/${inputGeneName}`);
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      handleSetGeneName();
    }
  };

  const isGenePage = window.location.pathname.startsWith("/gene");

  return (
    <Box display="flex" flexDirection="column">
      <Box display="flex" flexDirection="row" gap={2} style={{ marginBottom: "5px" }}>
        {isGenePage && (
          <>
            <Typography
              variant="h6"
              style={{ cursor: "pointer", color: theme.palette.primary.main }}
              onClick={() => navigate("/")}>
              Variant table
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <Typography variant="h6">Gene view</Typography>
            </Box>
          </>
        )}
      </Box>
      <Box display="flex" flexDirection="column">
        <TextField
          label="Enter a gene name"
          value={inputGeneName}
          onChange={handleInputGeneNameChange}
          onKeyDown={handleKeyPress}
          variant="outlined"
          margin="normal"
          size="small"
          style={{ width: "160px" }}
        />
        <Button
          sx={{ marginBottom: "10px", width: "160px" }}
          size="small"
          color="primary"
          variant="contained"
          onClick={handleSetGeneName}>
          <span>show region</span>
        </Button>
      </Box>
      <CisView geneName={geneName} />
    </Box>
  );
};

export default GeneContainer;
