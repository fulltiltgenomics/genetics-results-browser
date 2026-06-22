import {
  Box,
  FormControlLabel,
  FormGroup,
  FormLabel,
  IconButton,
  Switch,
  TextField,
} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import { useState } from "react";
import { useDataStore } from "../../store/store";

/**
 * QTL cis/trans display toggles (re-added from the pre-refactor controls). A QTL membership is cis
 * when the variant is within the cis window of its target gene, else trans; GWAS/metaboQTL are never
 * classified and so are unaffected. The cis-window field lives here too since it defines what counts
 * as cis; together they gate which side(s) to show, reactively refiltering client-side via the store.
 */
const CisTransToggles = (props: { isNotReadyYet: boolean }) => {
  const showCisQtl = useDataStore((state) => state.showCisQtl);
  const showTransQtl = useDataStore((state) => state.showTransQtl);
  const setShowCisQtl = useDataStore((state) => state.setShowCisQtl);
  const setShowTransQtl = useDataStore((state) => state.setShowTransQtl);
  const setCisWindow = useDataStore((state) => state.setCisWindow);

  // keep the field string local so it can hold transient input; only push valid numbers to the store.
  const [cisWindowStr, setCisWindowStr] = useState(useDataStore.getState().cisWindow.toString());

  const updateCisWindow = (value: string) => {
    setCisWindowStr(value);
    let mb = Number(value);
    // cis window is a non-negative distance in Mb; invalid/empty falls back to 0 (everything trans).
    if (isNaN(mb) || mb < 0) {
      mb = 0;
    }
    if (mb != useDataStore.getState().cisWindow) {
      setCisWindow(mb);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", paddingLeft: "20px", paddingRight: "20px" }}>
      <FormLabel sx={{ fontSize: "0.75rem" }}>QTL cis / trans</FormLabel>
      <FormGroup>
        <FormControlLabel
          control={
            <Switch
              checked={showCisQtl}
              disabled={props.isNotReadyYet}
              onChange={() => setShowCisQtl(!showCisQtl)}
            />
          }
          label="cis"
        />
        <FormControlLabel
          control={
            <Switch
              checked={showTransQtl}
              disabled={props.isNotReadyYet}
              onChange={() => setShowTransQtl(!showTransQtl)}
            />
          }
          label="trans"
        />
      </FormGroup>
      <TextField
        id="cis_window"
        label="cis window (Mb, one side)"
        value={cisWindowStr}
        variant="standard"
        disabled={props.isNotReadyYet}
        onChange={(event) => {
          updateCisWindow(event.target.value);
        }}
        InputProps={{
          endAdornment: (
            <IconButton
              sx={{ visibility: cisWindowStr !== "" ? "visible" : "hidden" }}
              disabled={props.isNotReadyYet}
              onClick={() => {
                updateCisWindow("");
              }}>
              <ClearIcon />
            </IconButton>
          ),
        }}
      />
    </Box>
  );
};

export default CisTransToggles;
