import { CSDatum } from "@/types/types.gene";
import { isCoding, isLoF } from "@/utils/coding";
import { Box, Typography } from "@mui/material";
import QTLGeneListItem from "./QTLGeneListItem";

const AffectingGeneList = ({
  geneName,
  gene2cs,
  width,
  title,
  noDataTitle,
}: {
  geneName: string;
  gene2cs: { [key: string]: CSDatum[] } | undefined;
  width: number;
  title: string;
  noDataTitle: string;
}) => {
  if (gene2cs === undefined) {
    return <Typography style={{ fontWeight: "bold" }}>Loading...</Typography>;
  }
  if (Object.keys(gene2cs).length === 0) {
    return <Typography style={{ fontWeight: "bold" }}>{noDataTitle}</Typography>;
  }
  return (
    <Box display="flex" flexDirection="column" gap={1}>
      <>
        <Typography style={{ fontWeight: "bold" }}>{title}</Typography>
        <Box style={{ width }}>
          {Object.entries(gene2cs)
            .sort(([geneA], [geneB]) => geneA.localeCompare(geneB))
            .map(([qtlGene, credibleSets]) => {
              let coding = false;
              let lof = false;
              credibleSets.forEach((c) => {
                for (let i = 0; i < c.gene.length; i++) {
                  if (c.gene[i] === qtlGene && isCoding(c.consequence[i])) {
                    coding = true;
                  }
                  if (c.gene[i] === qtlGene && isLoF(c.consequence[i])) {
                    lof = true;
                  }
                }
              });
              let color = "inherit";
              if (coding) {
                color = "orange";
              }
              if (lof) {
                color = "red";
              }
              return (
                <QTLGeneListItem
                  key={qtlGene}
                  sourceGeneName={geneName}
                  qtlGeneName={qtlGene}
                  credibleSets={credibleSets}
                  color={color}
                />
              );
            })}
        </Box>
      </>
    </Box>
  );
};

export default AffectingGeneList;
