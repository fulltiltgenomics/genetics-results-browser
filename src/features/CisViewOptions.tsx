import { Box, Typography, RadioGroup, FormControlLabel, Radio, Switch } from "@mui/material";

const CisViewOptions = ({
  maxCsSize,
  setMaxCsSize,
  minLeadMlog10p,
  setMinLeadMlog10p,
  codingOnly,
  setCodingOnly,
  disabled,
}: {
  maxCsSize: number;
  setMaxCsSize: (maxCsSize: number) => void;
  minLeadMlog10p: number;
  setMinLeadMlog10p: (minLeadMlog10p: number) => void;
  codingOnly: boolean;
  setCodingOnly: (codingOnly: boolean) => void;
  disabled: boolean;
}) => {
  return (
    <Box display="flex" flexDirection="row">
      <Box display="flex" flexDirection="column" pr={10}>
        <Typography>max CS size</Typography>
        <RadioGroup
          row
          value={maxCsSize}
          onChange={(event) => setMaxCsSize(Number(event.target.value))}
          aria-label="maxCsSize"
          name="maxCsSize">
          <FormControlLabel value={1} control={<Radio />} label="1" />
          <FormControlLabel value={10} control={<Radio />} label="10" />
          <FormControlLabel value={50} control={<Radio />} label="50" />
          <FormControlLabel value={1e10} control={<Radio />} label="unlimited" />
        </RadioGroup>
      </Box>
      <Box display="flex" flexDirection="column" pr={10}>
        <Typography>min lead p-value</Typography>
        <RadioGroup
          row
          value={minLeadMlog10p}
          onChange={(event) => setMinLeadMlog10p(Number(event.target.value))}
          aria-label="minLeadP"
          name="minLeadP">
          <FormControlLabel value={7.30102999566} control={<Radio />} label="5e-8" />
          <FormControlLabel value={10} control={<Radio />} label="1e-10" />
          <FormControlLabel value={12} control={<Radio />} label="1e-12" />
        </RadioGroup>
      </Box>
      <Box display="flex" flexDirection="column">
        <Typography>
          {disabled ? "loading coding variants..." : "show only cs with coding variants"}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={codingOnly}
              disabled={disabled}
              onChange={(e) => setCodingOnly(e.target.checked)}
            />
          }
          label=""
        />
      </Box>
    </Box>
  );
};

export default CisViewOptions;
