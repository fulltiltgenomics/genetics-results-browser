import { Box, IconButton, TextField } from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import { useState } from "react";
import { useDataStore } from "../../store/store";

// credible-set thresholds (refactor.md §4): PIP (pip >= threshold, 0 keeps everything) and p-value
// (p <= threshold, 1 keeps everything; default 0.05). the eQTL quant-level option
// (includeAllQuantLevels) is intentionally not here: it drives QTL trait display, not a threshold.
const GlobalThresholds = (props: { isNotReadyYet: boolean }) => {
  // keep the threshold strings local so the field can hold transient input (e.g. "0.") and we only
  // push valid numbers to the store.
  const [pipThresholdStr, setPipThresholdStr] = useState(
    useDataStore.getState().pipThreshold.toString()
  );
  const [pValueThresholdStr, setPValueThresholdStr] = useState(
    useDataStore.getState().pValueThreshold.toString()
  );

  const setPipThreshold = useDataStore((state) => state.setPipThreshold);
  const setPValueThreshold = useDataStore((state) => state.setPValueThreshold);

  const updatePipThreshold = (value: string) => {
    setPipThresholdStr(value);
    let pip = Number(value);
    if (pip < 0 || pip > 1 || isNaN(pip)) {
      pip = 0;
    }
    // only update if actual new number in the field
    if (pip != useDataStore.getState().pipThreshold) {
      setPipThreshold(pip);
    }
  };

  const updatePValueThreshold = (value: string) => {
    setPValueThresholdStr(value);
    let p = Number(value);
    // a p-value filter only makes sense in (0, 1]; anything outside (incl. empty/cleared) means "no
    // p-value filtering", which is threshold 1 (every p-value is <= 1).
    if (isNaN(p) || p <= 0 || p > 1) {
      p = 1;
    }
    if (p != useDataStore.getState().pValueThreshold) {
      setPValueThreshold(p);
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        paddingLeft: "20px",
        paddingRight: "20px",
        // keep the two thresholds stacked adjacently at the top, not spread to the column's full
        // (sibling-stretched) height — so p-value sits right below PIP.
        justifyContent: "flex-start",
        gap: "8px",
      }}>
      <TextField
        id="pip_thres"
        label="PIP threshold"
        value={pipThresholdStr}
        variant="standard"
        disabled={props.isNotReadyYet}
        onChange={(event) => {
          updatePipThreshold(event.target.value);
        }}
        InputProps={{
          endAdornment: (
            <IconButton
              sx={{ visibility: pipThresholdStr !== "" ? "visible" : "hidden" }}
              disabled={props.isNotReadyYet}
              onClick={() => {
                updatePipThreshold("");
              }}>
              <ClearIcon />
            </IconButton>
          ),
        }}
      />
      <TextField
        id="p_value_thres"
        label="p-value threshold"
        value={pValueThresholdStr}
        variant="standard"
        disabled={props.isNotReadyYet}
        onChange={(event) => {
          updatePValueThreshold(event.target.value);
        }}
        InputProps={{
          endAdornment: (
            <IconButton
              sx={{ visibility: pValueThresholdStr !== "" ? "visible" : "hidden" }}
              disabled={props.isNotReadyYet}
              onClick={() => {
                updatePValueThreshold("");
              }}>
              <ClearIcon />
            </IconButton>
          ),
        }}
      />
    </Box>
  );
};

export default GlobalThresholds;
