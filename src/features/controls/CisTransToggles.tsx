import { Box, FormControlLabel, FormGroup, FormLabel, Switch } from "@mui/material";
import { useDataStore } from "../../store/store";

/**
 * QTL cis/trans display toggles (re-added from the pre-refactor controls). A QTL membership is cis
 * when the variant is within the cis window of its target gene, else trans; GWAS/metaboQTL are never
 * classified and so are unaffected. The window itself lives in GlobalThresholds; these just gate
 * which side(s) to show, reactively refiltering client-side via the store.
 */
const CisTransToggles = (props: { isNotReadyYet: boolean }) => {
  const showCisQtl = useDataStore((state) => state.showCisQtl);
  const showTransQtl = useDataStore((state) => state.showTransQtl);
  const setShowCisQtl = useDataStore((state) => state.setShowCisQtl);
  const setShowTransQtl = useDataStore((state) => state.setShowTransQtl);

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
    </Box>
  );
};

export default CisTransToggles;
