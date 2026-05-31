import { Box, IconButton, TextField } from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import { useState } from "react";
import { useDataStore } from "../../store/store";

// credible-set-only thresholds (refactor.md §4): the p-value threshold lost meaning, so the real
// filters are PIP (pip >= threshold) and cs_min_r2 (csMinR2 >= threshold, 0 keeps everything).
// the eQTL quant-level option (includeAllQuantLevels) is intentionally not here: it drives QTL
// trait display, not a threshold, and belongs with the QTL display work in .18.
const GlobalThresholds = (props: { isNotReadyYet: boolean }) => {
  // keep the threshold strings local so the field can hold transient input (e.g. "0.") and we only
  // push valid numbers to the store.
  const [pipThresholdStr, setPipThresholdStr] = useState(
    useDataStore.getState().pipThreshold.toString()
  );
  const [csMinR2ThresholdStr, setCsMinR2ThresholdStr] = useState(
    useDataStore.getState().csMinR2Threshold.toString()
  );

  const setPipThreshold = useDataStore((state) => state.setPipThreshold);
  const setCsMinR2Threshold = useDataStore((state) => state.setCsMinR2Threshold);

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

  const updateCsMinR2Threshold = (value: string) => {
    setCsMinR2ThresholdStr(value);
    let r2 = Number(value);
    if (r2 < 0 || r2 > 1 || isNaN(r2)) {
      r2 = 0;
    }
    // only update if actual new number in the field
    if (r2 != useDataStore.getState().csMinR2Threshold) {
      setCsMinR2Threshold(r2);
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        paddingLeft: "20px",
        paddingRight: "20px",
        justifyContent: "space-between",
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
        id="cs_min_r2_thres"
        label="cs_min_r2 threshold"
        value={csMinR2ThresholdStr}
        variant="standard"
        disabled={props.isNotReadyYet}
        onChange={(event) => {
          updateCsMinR2Threshold(event.target.value);
        }}
        InputProps={{
          endAdornment: (
            <IconButton
              sx={{ visibility: csMinR2ThresholdStr !== "" ? "visible" : "hidden" }}
              disabled={props.isNotReadyYet}
              onClick={() => {
                updateCsMinR2Threshold("");
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
