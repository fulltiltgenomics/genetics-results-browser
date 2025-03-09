import { Box, Button, TextField } from "@mui/material";
import CisView from "./CisView";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const GeneContainer = () => {
  const params = useParams();
  const navigate = useNavigate();
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

  return (
    <Box display="flex" flexDirection="column" alignItems="center">
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
