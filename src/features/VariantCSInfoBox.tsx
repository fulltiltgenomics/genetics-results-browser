import { Box, Typography } from "@mui/material";
import { pValRepr } from "./table/utils/tableutil";
import { CSStatus, SelectedVariantStats, TraitStatus } from "@/types/types.gene";

const VariantCSInfoBox = ({
  traitStatus,
  csStatus,
  selectedVariantStats,
}: {
  traitStatus: TraitStatus | undefined;
  csStatus: CSStatus | undefined;
  selectedVariantStats: SelectedVariantStats | undefined;
}) => {
  return (
    <Box
      display="flex"
      flexDirection="row"
      justifyContent="center"
      gap={4}
      position="fixed"
      bottom={0}
      p={1}
      bgcolor={traitStatus ? "rgba(0, 0, 0, 0.3)" : "transparent"}
      margin="auto"
      left={0}
      right={0}
      style={{ zIndex: -1000 }}>
      <Box display="flex" flexDirection="column">
        {traitStatus ? (
          <Box
            display="grid"
            gridTemplateColumns="auto auto"
            gridTemplateRows="auto auto"
            gap="0 8px">
            <Typography>traits with an overlapping CS</Typography>
            <Typography>{traitStatus.csOverlappingTraits}</Typography>
            <Typography>traits with a CS with this variant</Typography>
            <Typography>{traitStatus.variantOverlappingTraits}</Typography>
          </Box>
        ) : (
          [0, 1].map((i) => (
            <Typography key={i} visibility="hidden">
              secret text
            </Typography>
          ))
        )}
      </Box>
      <Box display="flex" flexDirection="column">
        {csStatus ? (
          <Box
            display="grid"
            gridTemplateColumns="auto auto"
            gridTemplateRows="auto auto"
            gap="0 8px">
            <Typography>CS size</Typography>
            <Typography>{csStatus.csSize}</Typography>
            <Typography>CS min r2</Typography>
            <Typography>{csStatus.csMinR2.toPrecision(3)}</Typography>
          </Box>
        ) : (
          [0, 1].map((i) => (
            <Typography key={i} visibility="hidden">
              secret text
            </Typography>
          ))
        )}
      </Box>
      <Box display="flex" flexDirection="column">
        <Box display="grid" gridTemplateRows="repeat(2, auto)" gridAutoFlow="column">
          {selectedVariantStats ? (
            <Box display="flex" flexDirection="row">
              <Box display="grid" gridTemplateRows="2" style={{ paddingRight: "16px" }}>
                <Typography key="variant">{selectedVariantStats.variant}</Typography>
                <Typography key="consequence">{selectedVariantStats.consequence}</Typography>
              </Box>
              <Box display="grid" gridTemplateColumns="auto auto auto auto" gap="0 8px">
                <Typography>p-value</Typography>
                <Typography>{pValRepr(selectedVariantStats.mlog10p)}</Typography>
                <Typography>beta</Typography>
                <Typography>{selectedVariantStats.beta.toPrecision(3)}</Typography>
                <Typography>pip</Typography>
                <Typography>{selectedVariantStats.pip.toPrecision(3)}</Typography>
                <Typography>af</Typography>
                <Typography>{selectedVariantStats.af}</Typography>
              </Box>
            </Box>
          ) : (
            [0, 1].map((i) => (
              <Typography key={i} visibility="hidden">
                secret text
              </Typography>
            ))
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default VariantCSInfoBox;
