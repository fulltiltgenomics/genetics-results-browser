import { Autocomplete, TextField } from "@mui/material";
import { useDataStore } from "../../store/store";
import { GnomadPop } from "../../types/types.normalized";

// gnomAD populations carried by the new credible-set API (GnomadFreq.byPop). the legacy options came
// from the dead clientData.meta.gnomad.populations, which is undefined on the normalized path — so
// the dropdown was empty. these codes match the AF the variant table reads for the selected pop.
const POPULATIONS: { code: GnomadPop; label: string }[] = [
  { code: "afr", label: "African / African American" },
  { code: "amr", label: "Admixed American" },
  { code: "asj", label: "Ashkenazi Jewish" },
  { code: "eas", label: "East Asian" },
  { code: "fin", label: "Finnish" },
  { code: "mid", label: "Middle Eastern" },
  { code: "nfe", label: "European (non-Finnish)" },
  { code: "remaining", label: "Remaining" },
  { code: "sas", label: "South Asian" },
];

const POP_LABEL = new Map(POPULATIONS.map((p) => [p.code as string, p.label]));

const GnomadPopChoice = (props: { isNotReadyYet: boolean }) => {
  const setSelectedPopulation = useDataStore((state) => state.setSelectedPopulation);
  const selectedPopulation = useDataStore((state) => state.selectedPopulation);

  return (
    <Autocomplete
      sx={{ width: 320, paddingLeft: "20px" }}
      disabled={props.isNotReadyYet}
      id="gnomad-population-select"
      options={POPULATIONS.map((p) => p.code as string)}
      value={selectedPopulation ?? null}
      getOptionLabel={(option) => `${option} (${POP_LABEL.get(option) ?? option})`}
      renderOption={(optionProps, pop) => {
        const { key, ...rest } = optionProps;
        return (
          <span key={key} {...rest}>
            {pop} ({POP_LABEL.get(pop) ?? pop})
          </span>
        );
      }}
      renderInput={(params) => <TextField {...params} label="AF gnomAD population" />}
      onChange={(event, newValue: string | null) => {
        setSelectedPopulation(newValue !== null ? newValue : undefined);
      }}
    />
  );
};

export default GnomadPopChoice;
