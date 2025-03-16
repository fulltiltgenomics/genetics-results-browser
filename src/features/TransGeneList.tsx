import { Box, Typography } from "@mui/material";

const TransGeneList = ({
  transGenes,
  width,
}: {
  transGenes: string[] | undefined;
  width: number;
}) => {
  return (
    <Box display="flex" flexDirection="column" gap={1}>
      {transGenes === undefined && (
        <Typography style={{ fontWeight: "bold" }}>Trans-pQTLs loading...</Typography>
      )}
      {transGenes !== undefined && transGenes.length === 0 && (
        <Typography style={{ fontWeight: "bold" }}>No trans-pQTL genes found</Typography>
      )}
      {transGenes !== undefined && transGenes.length > 0 && (
        <>
          <Typography style={{ fontWeight: "bold" }}>Trans-pQTL genes WIP</Typography>
          <Box style={{ width }}>
            {transGenes.map((gene) => (
              <div key={gene}>{gene}</div>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
};

export default TransGeneList;
