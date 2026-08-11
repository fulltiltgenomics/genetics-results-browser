import { Box, Button, Tab, Tabs, TextField } from "@mui/material";
import CisView from "./CisView";
import GeneEvidenceTab from "./gene/GeneEvidenceTab";
import ViewNav from "./page/ViewNav";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

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
  // 0 = credible sets (CS visualization), 1 = gene evidence (burden/expression/gene-disease)
  const [activeTab, setActiveTab] = useState(0);

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
      {isGenePage && <ViewNav current="gene" />}
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
      {geneName && (
        <Tabs
          value={activeTab}
          onChange={(_e, value) => setActiveTab(value)}
          sx={{ mb: 1, borderBottom: 1, borderColor: "divider" }}>
          <Tab label="Credible sets" />
          <Tab label="Gene evidence" />
        </Tabs>
      )}
      {/* keep CisView mounted across tab switches so its plot/state survive; gene-evidence is only
          mounted once its tab is opened so its three fetches don't fire on initial gene load. */}
      <Box sx={{ display: activeTab === 0 ? "block" : "none" }}>
        <CisView geneName={geneName} />
      </Box>
      {activeTab === 1 && geneName && (
        <Box>
          <GeneEvidenceTab geneName={geneName} />
        </Box>
      )}
    </Box>
  );
};

export default GeneContainer;
