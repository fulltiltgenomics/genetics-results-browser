import { Box, Button, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useGeneInfo } from "@/store/serverQuery";
import { useGeneEvidenceStore } from "@/store/store.geneEvidence";
import GeneEvidenceTab from "./GeneEvidenceTab";
import GeneNotFound from "./GeneNotFound";

const GeneEvidencePage = () => {
  const { geneName } = useParams();
  const navigate = useNavigate();
  const { data: geneInfo, error: geneInfoError } = useGeneInfo(geneName);
  const [inputGeneName, setInputGeneName] = useState("");
  const wanted = inputGeneName.trim();
  // the filters last from gene to gene, and go when the page is left
  useEffect(() => () => useGeneEvidenceStore.getState().resetFilters(), []);

  const search = (
    <Box
      component="form"
      display="flex"
      // with a gene open the search is one row beside its name; before that it is the page
      flexDirection={geneName ? "row" : "column"}
      alignItems={geneName ? "center" : "flex-start"}
      gap={geneName ? 1 : 0}
      onSubmit={(event) => {
        event.preventDefault();
        if (wanted) {
          navigate(`/gene/${encodeURIComponent(wanted)}`);
          setInputGeneName("");
        }
      }}>
      <TextField
        label="Enter a gene name"
        value={inputGeneName}
        onChange={(event) => setInputGeneName(event.target.value)}
        variant="outlined"
        margin={geneName ? "none" : "normal"}
        size="small"
        style={{ width: "160px" }}
      />
      <Button
        type="submit"
        sx={geneName ? undefined : { marginBottom: "10px", width: "160px" }}
        size="small"
        color="primary"
        variant="contained"
        disabled={!wanted}>
        GO
      </Button>
    </Box>
  );

  return (
    <Box display="flex" flexDirection="column">
      {geneName ? (
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 3, mt: 2, px: 2 }}>
          {!geneInfoError && (
            <Typography variant="h5" component="h1">
              {geneInfo?.symbol ?? geneName}
            </Typography>
          )}
          {search}
        </Box>
      ) : (
        <>
          <Typography sx={{ mt: 3, maxWidth: 900 }}>
            Browse and plot all of our results for a gene: GWAS and gene burden results, expression
            data from GTEx and CELLxGENE, and other annotations.
            <br />
            An AI summary based on all these data is provided.
          </Typography>
          {search}
        </>
      )}
      {geneName &&
        (geneInfo ? (
          <GeneEvidenceTab geneName={geneInfo.symbol} />
        ) : geneInfoError ? (
          <Box sx={{ p: 2 }}>
            <GeneNotFound error={geneInfoError} />
          </Box>
        ) : (
          <Typography sx={{ p: 2 }}>Loading...</Typography>
        ))}
    </Box>
  );
};

export default GeneEvidencePage;
