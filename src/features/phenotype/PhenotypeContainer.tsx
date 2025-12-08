import { Box, TextField, Typography, Paper, Alert, Button, InputAdornment } from "@mui/material";
import { Search as SearchIcon } from "@mui/icons-material";
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PhenotypeChat } from "./PhenotypeChat";
import api from "../../store/api";
import type { PhenotypeMarkdown } from "./phenotype.types";

/**
 * Container component for phenotype chat view.
 * Handles phenotype code input and displays chat interface.
 */
const PhenotypeContainer = () => {
  const navigate = useNavigate();
  const { phenocode } = useParams<{ phenocode?: string }>();
  const [phenocodeInput, setPhenocodeInput] = useState(phenocode || "");
  const [activePhenocode, setActivePhenocode] = useState<string | null>(null);
  const [markdownContent, setMarkdownContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // load phenotype markdown on initial mount or when URL phenocode changes
  useEffect(() => {
    if (phenocode && phenocode !== activePhenocode) {
      setPhenocodeInput(phenocode);
      loadPhenotype(phenocode);
    }
  }, [phenocode]);

  const loadPhenotype = async (code: string) => {
    if (!code.trim()) {
      setError("Please enter a phenotype code");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await api.get<PhenotypeMarkdown>(`/v1/phenotype/${code}/markdown`);
      setMarkdownContent(response.data.content);
      setActivePhenocode(code);
      navigate(`/phenotype/${code}`, { replace: true });
    } catch (err: any) {
      if (err.response?.status === 404) {
        setError(`No markdown found for phenotype: ${code}`);
      } else {
        setError(err.message || "Failed to load phenotype data");
      }
      setMarkdownContent(null);
      setActivePhenocode(null);
    } finally {
      setLoading(false);
    }
  };

  const handleInputKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      loadPhenotype(phenocodeInput);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1400, margin: "0 auto" }}>
      <Typography variant="h4" gutterBottom>
        Phenotype LLM Thing
      </Typography>

      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Input a phenotype code to chat about association results with FinnGenie.
      </Typography>

      <Paper sx={{ p: 2, mb: 3, display: "flex", gap: 2, alignItems: "flex-start" }}>
        <TextField
          fullWidth
          label="Phenotype Code"
          value={phenocodeInput}
          onChange={(e) => setPhenocodeInput(e.target.value)}
          onKeyUp={handleInputKeyPress}
          placeholder="e.g., I9_CHD, T2D, etc."
          disabled={loading}
        />
        <Button
          variant="contained"
          onClick={() => loadPhenotype(phenocodeInput)}
          disabled={loading || !phenocodeInput.trim()}
          sx={{ minWidth: 100, height: 56 }}
          startIcon={<SearchIcon />}>
          GO
        </Button>
      </Paper>

      {error && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {activePhenocode && (
        <PhenotypeChat phenocode={activePhenocode} markdownContent={markdownContent} />
      )}
    </Box>
  );
};

export default PhenotypeContainer;
