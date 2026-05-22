import { Box, FormControlLabel, Switch, TextField } from "@mui/material";
import { DataType, QTLType } from "../../types/types";
import { useMemo, ReactElement, useState } from "react";
import { useDataStore } from "../../store/store";
import { useHotkeys } from "react-hotkeys-hook";

const GlobalQTLSwitches = (props: { isNotReadyYet: boolean }) => {
  const toggledQTLTypes: Record<QTLType, boolean> = useDataStore((state) => state.toggledQTLTypes);
  const toggleQTLType = useDataStore((state) => state.toggleQTLType);
  const toggledDataTypes: Record<DataType, boolean> = useDataStore(
    (state) => state.toggledDataTypes
  );
  const setCisWindow = useDataStore((state) => state.setCisWindow);

  useHotkeys("c", () => toggleQTLType(QTLType.CIS));
  useHotkeys("t", () => toggleQTLType(QTLType.TRANS));

  // keep track of the window string value in the text fields here
  // only update the store when necessary
  const [cisWindowStr, setCisWindowStr] = useState(useDataStore.getState().cisWindow.toString());

  const updateCisWindow = (value: string) => {
    setCisWindowStr(value);
    let window = Number(value); // e.g. "5e" will become NaN
    // only update if actual new number in the field
    if (window != useDataStore.getState().cisWindow) {
      setCisWindow(window);
    }
  };

  const qtlTypeSwitches: ReactElement<"FormControlLabel">[] = useMemo(
    () =>
      (Object.keys(toggledQTLTypes) as Array<keyof typeof toggledQTLTypes>).map((QTLType) => {
        return (
          <FormControlLabel
            key={QTLType}
            control={
              <Switch
                checked={toggledQTLTypes[QTLType]}
                disabled={
                  props.isNotReadyYet ||
                  (!toggledDataTypes["eQTL"] &&
                    !toggledDataTypes["sQTL"] &&
                    !toggledDataTypes["edQTL"] &&
                    !toggledDataTypes["pQTL"] &&
                    !toggledDataTypes["metaboQTL"] &&
                    !toggledDataTypes["asmQTL"])
                }
                onChange={() => {
                  toggleQTLType(QTLType);
                }}
              />
            }
            label={`[${QTLType.slice(0, 1).toUpperCase()}] Include ${QTLType.toLowerCase()}-QTLs`}
          />
        );
      }),
    [toggledQTLTypes, toggleQTLType, props.isNotReadyYet, toggledDataTypes]
  );

  return (
    <>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          paddingLeft: "20px",
          paddingRight: "20px",
        }}>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
          }}>
          {qtlTypeSwitches}
        </Box>
        <TextField
          id="cis_window"
          label="cis window (Mb) one side"
          value={cisWindowStr}
          variant="standard"
          disabled={props.isNotReadyYet}
          onChange={(event) => {
            updateCisWindow(event.target.value);
          }}
        />
      </Box>
    </>
  );
};

export default GlobalQTLSwitches;
