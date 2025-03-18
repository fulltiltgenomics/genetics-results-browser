import { CSDatum } from "@/types/types.gene";
import { isCoding, isLoF } from "@/utils/coding";
import { Box, Typography, useMediaQuery } from "@mui/material";
import config from "@/config.json";
import { useThemeStore } from "@/store/store.theme";
import QTLGeneListItem from "./QTLGeneListItem";

const AffectedGeneList = ({
  geneName,
  gene2cs,
  width,
  title,
  noDataTitle,
  highlightedVariant,
}: {
  geneName: string;
  gene2cs: { [key: string]: CSDatum[] } | undefined;
  width: number;
  title: string;
  noDataTitle: string;
  highlightedVariant: string | undefined;
}) => {
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
  const { isDarkMode } = useThemeStore();
  const isActualDarkMode = isDarkMode ?? prefersDarkMode;
  return (
    <Box display="flex" flexDirection="column" gap={1}>
      {gene2cs === undefined && <Typography style={{ fontWeight: "bold" }}>Loading...</Typography>}
      {gene2cs !== undefined && Object.keys(gene2cs).length === 0 && (
        <Typography style={{ fontWeight: "bold" }}>{noDataTitle}</Typography>
      )}
      {gene2cs !== undefined && Object.keys(gene2cs).length > 0 && (
        <>
          <Typography style={{ fontWeight: "bold" }}>{title}</Typography>
          <Box style={{ width }}>
            {Object.entries(gene2cs)
              .sort(([geneA], [geneB]) => geneA.localeCompare(geneB))
              .map(([qtlGene, credibleSets]) => {
                let coding = false;
                let lof = false;
                let highlighted = false;
                credibleSets.forEach((cs) => {
                  for (let i = 0; i < cs.gene.length; i++) {
                    if (cs.gene[i] === geneName && isCoding(cs.consequence[i])) {
                      coding = true;
                    }
                    if (cs.gene[i] === geneName && isLoF(cs.consequence[i])) {
                      lof = true;
                    }
                    if (cs.gene[i] === geneName && cs.variant[i] === highlightedVariant) {
                      highlighted = true;
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
                color =
                  highlightedVariant === undefined || highlighted
                    ? color
                    : isActualDarkMode
                    ? config.gene_view.colors.dimDark
                    : config.gene_view.colors.dim;
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
      )}
    </Box>
  );
};

export default AffectedGeneList;
