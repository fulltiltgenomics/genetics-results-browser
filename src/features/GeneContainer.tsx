import { useGeneViewStore } from "./../store/store";
import { Box, Button, Tab, Tabs, TextField, Typography } from "@mui/material";
import TabPanel from "@mui/lab/TabPanel";
import { TabContext } from "@mui/lab";
import CisView from "./CisView";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const GeneContainer = () => {
  const params = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useGeneViewStore((state) => [
    state.activeTab,
    state.setActiveTab,
  ]);
  const [geneName, setGeneName] = useState("");
  useEffect(() => {
    if (params.geneName) {
      setGeneName(params.geneName);
    }
  }, [params.geneName]);
  const [inputGeneName, setInputGeneName] = useState("");

  const handleTabChange = (event: React.SyntheticEvent, newValue: string) => {
    setActiveTab(newValue);
  };

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
    <TabContext value={activeTab}>
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
      </Box>
      <Tabs value={activeTab} onChange={handleTabChange} aria-label="table_selection_tabs">
        <Tab value="cis" label="GWAS and cis-QTLs" disabled={false} />
        <Tab value="trans" label="trans-QTLs" disabled={false} />
      </Tabs>
      <TabPanel value="cis">
        <Box display="flex" flexDirection="column">
          <CisView geneName={geneName} />
        </Box>
      </TabPanel>
      <TabPanel value="trans">
        <Box display="flex" flexDirection="row">
          <Typography>
            Nothing here yet. Trans-QTLs of the input gene should be listed here, but it's not been
            done yet
          </Typography>
        </Box>
      </TabPanel>
    </TabContext>
  );
};

export default GeneContainer;
