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
  const isVariantPage =
    window.location.pathname == "/" || window.location.pathname.startsWith("/q=");

  return (
    <Box display="flex" flexDirection="column">
      <Box display="flex" flexDirection="row" gap={2} style={{ marginBottom: "20px" }}>
        {isVariantPage && (
          <>
            <Typography variant="h6">Variants</Typography>
            <Box
              sx={{ display: "flex", alignItems: "center", cursor: "pointer" }}
              onClick={() => navigate("/gene")}>
              <Typography variant="h6" style={{ color: theme.palette.primary.main }}>
                Gene
              </Typography>
              <Typography
                component="span"
                sx={{
                  fontSize: "0.7em",
                  backgroundColor: "primary.main",
                  color: "white",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  marginLeft: "4px",
                }}>
                beta
              </Typography>
            </Box>
          </>
        )}
        {isGenePage && (
          <>
            <Typography
              variant="h6"
              style={{ cursor: "pointer", color: theme.palette.primary.main }}
              onClick={() => navigate("/")}>
              Variants
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <Typography variant="h6">Gene</Typography>
              <Typography
                component="span"
                sx={{
                  fontSize: "0.7em",
                  backgroundColor: "primary.main",
                  color: "white",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  marginLeft: "4px",
                }}>
                beta
              </Typography>
            </Box>
          </>
        )}
      </Box>
      <Box display="flex" flexDirection="row" alignItems="baseline">
        <TextField
          label="Enter a gene"
          value={inputGeneName}
          onChange={handleInputGeneNameChange}
          onKeyDown={handleKeyPress}
          variant="outlined"
          margin="normal"
          size="small"
          style={{ paddingRight: "10px" }}
        />
        <Button
          variant="contained"
          color="primary"
          onClick={handleSetGeneName}
          size="large"
          style={{ height: "34px" }}>
          GO
        </Button>
      </Box>
      <CisView geneName={geneName} />
    </Box>
  );
};

export default GeneContainer;
