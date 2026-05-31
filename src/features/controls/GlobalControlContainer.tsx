import { Box, Divider } from "@mui/material";
import { useDataStore } from "../../store/store";
import { useNormalizedQuery } from "../../store/serverQuery";
import GlobalThresholds from "./GlobalThresholds";
import GlobalDataTypeSwitches from "./GlobalDataTypeSwitches";
import GnomadPopChoice from "./GnomadPopChoice";
import GlobalQTLSwitches from "./GlobalQTLSwitches";

const GlobalControlContainer = () => {
  const variantInput: string = useDataStore((state) => state.variantInput)!;
  // gate on the normalized BFF query; the legacy useServerQuery now throws on the new
  // NormalizedResponse shape, which would otherwise keep these controls disabled forever
  const { isError, isFetching, isLoading } = useNormalizedQuery(variantInput);
  const isNotReadyYet = isError || isFetching || isLoading;

  return (
    <Box
      sx={{
        display: "flex",
        gap: "1rem",
        p: "0.5rem",
        flexWrap: "wrap",
        flexDirection: "row",
      }}>
      <Box
        sx={{
          display: "flex",
          flexDirection: "row",
        }}>
        {/* TODO - add back in and implement when we have more finemapping data
          <GlobalAssocFinemapSwitches isNotReadyYet={isNotReadyYet} />
          <Divider sx={{ margin: "auto" }} orientation="vertical" /> */}
        <GlobalDataTypeSwitches isNotReadyYet={isNotReadyYet} />
        <Divider sx={{ margin: "auto" }} orientation="vertical" />
        <GlobalQTLSwitches isNotReadyYet={isNotReadyYet} />
        <Divider sx={{ margin: "auto" }} orientation="vertical" />
        <GlobalThresholds isNotReadyYet={isNotReadyYet} />
        <Divider sx={{ margin: "auto" }} orientation="vertical" />
        <GnomadPopChoice isNotReadyYet={isNotReadyYet} />
      </Box>
    </Box>
  );
};

export default GlobalControlContainer;
