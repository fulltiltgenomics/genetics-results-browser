import { Autocomplete, TextField } from "@mui/material";
import { TableData } from "../../types/types";
import { useDataStore } from "../../store/store";

const GnomadPopChoice = (props: { isNotReadyYet: boolean }) => {
  const variantInput: string = useDataStore((state) => state.variantInput)!;
  const clientData: TableData | undefined = useDataStore((state) => state.clientData);
  const setSelectedPopulation = useDataStore((state) => state.setSelectedPopulation);

  return (
    <Autocomplete
      sx={{ width: 175, paddingLeft: "20px" }}
      //disablePortal
      disabled={props.isNotReadyYet}
      id="phenotype-select"
      options={clientData?.meta.gnomad.populations || []}
      getOptionLabel={(option) => option}
      renderOption={(prps, pop) => <span {...prps}>{pop}</span>}
      renderInput={(params) => <TextField {...params} label="AF population" />}
      onChange={(event, newValue: string | null) => {
        setSelectedPopulation(newValue !== null ? newValue : undefined);
      }}
    />
  );
};

export default GnomadPopChoice;
