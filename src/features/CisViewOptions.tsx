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
    <Box display="flex" flexDirection="column" ml={10}>
      <Box display="flex" flexDirection="row" alignItems="center">
        <Typography style={{ width: 200 }}>
          {disabled ? "loading coding variants..." : "show only CSs with coding variants"}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={codingOnly}
              disabled={disabled}
              onChange={(e) => setCodingOnly(e.target.checked)}
              size="small"
            />
          }
          label=""
          sx={{ margin: 0 }}
        />
      </Box>
      <Box display="flex" flexDirection="row" alignItems="center" style={{ height: 30 }}>
        <Typography style={{ width: 200 }}>max CS size</Typography>
        <RadioGroup
          row
          value={maxCsSize}
          onChange={(event) => setMaxCsSize(Number(event.target.value))}
          aria-label="maxCsSize"
          name="maxCsSize">
          <FormControlLabel
            value={1}
            control={<Radio size="small" />}
            label="1"
            sx={{
              margin: 0,
              marginRight: 1,
              "& .MuiTypography-root": { fontSize: "0.875rem" },
            }}
          />
          <FormControlLabel
            value={10}
            control={<Radio size="small" />}
            label="10"
            sx={{
              margin: 0,
              marginRight: 1,
              "& .MuiTypography-root": { fontSize: "0.875rem" },
            }}
          />
          <FormControlLabel
            value={50}
            control={<Radio size="small" />}
            label="50"
            sx={{
              margin: 0,
              marginRight: 1,
              "& .MuiTypography-root": { fontSize: "0.875rem" },
            }}
          />
          <FormControlLabel
            value={1e10}
            control={<Radio size="small" />}
            label="unlimited"
            sx={{
              margin: 0,
              "& .MuiTypography-root": { fontSize: "0.875rem" },
            }}
          />
        </RadioGroup>
      </Box>
      <Box display="flex" flexDirection="row" alignItems="center" style={{ height: 30 }}>
        <Typography style={{ width: 200 }}>min lead p-value</Typography>
        <RadioGroup
          row
          value={minLeadMlog10p}
          onChange={(event) => setMinLeadMlog10p(Number(event.target.value))}
          aria-label="minLeadP"
          name="minLeadP">
          <FormControlLabel
            value={7.30102999566}
            control={<Radio size="small" />}
            label="5e-8"
            sx={{
              margin: 0,
              marginRight: 1,
              "& .MuiTypography-root": { fontSize: "0.875rem" },
            }}
          />
          <FormControlLabel
            value={10}
            control={<Radio size="small" />}
            label="1e-10"
            sx={{
              margin: 0,
              marginRight: 1,
              "& .MuiTypography-root": { fontSize: "0.875rem" },
            }}
          />
          <FormControlLabel
            value={12}
            control={<Radio size="small" />}
            label="1e-12"
            sx={{
              margin: 0,
              "& .MuiTypography-root": { fontSize: "0.875rem" },
            }}
          />
        </RadioGroup>
      </Box>
    </Box>
  );
};

export default CisViewOptions;
