import CleanTableCell, { StyledLink } from "@/style";
import { Box, IconButton, Table, TableBody, TableRow, Tooltip, Typography } from "@mui/material";
import { pValRepr, afRepr } from "./table/utils/tableutil";
import { CSDatum } from "@/types/types.gene";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

const QTLGeneListItem = ({
  affectingOrAffected,
  sourceGeneName,
  qtlGeneName,
  credibleSets,
  color,
}: {
  affectingOrAffected: "affecting" | "affected";
  sourceGeneName: string;
  qtlGeneName: string;
  credibleSets: CSDatum[];
  color: string;
}) => {
  return (
    <Tooltip
      placement="top"
      slotProps={{
        popper: {
          sx: {
            "& .MuiTooltip-tooltip": {
              maxWidth: "none",
            },
          },
        },
      }}
      title={
        <Box
          sx={{
            maxWidth: "800px",
          }}>
          <Table
            sx={{
              "& .MuiTableCell-root": {
                whiteSpace: "nowrap",
                width: "min-content",
              },
            }}>
            <TableBody>
              <TableRow>
                <CleanTableCell
                  style={{
                    width: 150,
                    paddingRight: 10,
                    fontWeight: "bold",
                    color: "white",
                  }}>
                  Dataset
                </CleanTableCell>
                <CleanTableCell style={{ fontWeight: "bold", paddingRight: 20, color: "white" }}>
                  CS size
                </CleanTableCell>
                <CleanTableCell style={{ fontWeight: "bold", paddingRight: 20, color: "white" }}>
                  # {affectingOrAffected === "affecting" ? qtlGeneName : sourceGeneName} coding
                </CleanTableCell>
                <CleanTableCell style={{ fontWeight: "bold", paddingRight: 20, color: "white" }}>
                  top PIP variant
                </CleanTableCell>
                <CleanTableCell style={{ fontWeight: "bold", paddingRight: 20, color: "white" }}>
                  p-value
                </CleanTableCell>
                <CleanTableCell style={{ fontWeight: "bold", paddingRight: 20, color: "white" }}>
                  beta
                </CleanTableCell>
                <CleanTableCell style={{ fontWeight: "bold", paddingRight: 20, color: "white" }}>
                  AF
                </CleanTableCell>
              </TableRow>
              {credibleSets
                .sort((a, b) => {
                  if (a.dataset === b.dataset) {
                    return a.csSize - b.csSize; // TODO why are some variants repeated in the same CS?
                  }
                  return a.dataset.localeCompare(b.dataset);
                })
                .map((cs) => {
                  const topPipIndex = cs.pip.indexOf(Math.max(...cs.pip));
                  return (
                    <TableRow key={`${cs.traitCSId}-${cs.variant[topPipIndex]}`}>
                      <CleanTableCell style={{ paddingRight: 20, color: "white" }}>
                        {cs.dataset.split("_").slice(0, 2).join(" ")}
                      </CleanTableCell>
                      <CleanTableCell style={{ paddingRight: 20, color: "white" }}>
                        {cs.csSize}
                      </CleanTableCell>
                      <CleanTableCell style={{ paddingRight: 20, color: "white" }}>
                        {affectingOrAffected === "affecting"
                          ? cs.isCoding.filter((c, i) => c && cs.gene[i] === qtlGeneName).length
                          : cs.isCoding.filter((c, i) => c && cs.gene[i] === sourceGeneName).length}
                      </CleanTableCell>
                      <CleanTableCell style={{ paddingRight: 20, color: "white" }}>
                        <Box display="flex" gap={1}>
                          <Typography style={{ width: 100, overflow: "scroll" }}>
                            {cs.variant[topPipIndex]}
                          </Typography>
                          <IconButton
                            size="small"
                            onClick={() => navigator.clipboard.writeText(cs.variant[topPipIndex])}
                            sx={{
                              transform: "translateY(-3px)",
                              "&:hover": { backgroundColor: "rgba(0, 0, 0, 0.04)" },
                            }}>
                            <ContentCopyIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Box>
                      </CleanTableCell>
                      <CleanTableCell style={{ paddingRight: 20, color: "white" }}>
                        {pValRepr(cs.mlog10p[topPipIndex])}
                      </CleanTableCell>
                      <CleanTableCell style={{ paddingRight: 20, color: "white" }}>
                        {cs.beta[topPipIndex]}
                      </CleanTableCell>
                      <CleanTableCell style={{ paddingRight: 20, color: "white" }}>
                        {afRepr(cs.af[topPipIndex])}
                      </CleanTableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </Box>
      }>
      {qtlGeneName === sourceGeneName ? (
        <Typography
          style={{ color, cursor: "default" }}
          sx={{
            "&:hover": {
              fontWeight: "bold",
            },
          }}>
          {qtlGeneName}
        </Typography>
      ) : (
        <Typography
          key={qtlGeneName}
          style={{ color, cursor: "pointer" }}
          sx={{
            "&:hover": {
              fontWeight: "bold",
            },
          }}>
          <StyledLink to={`/gene/${qtlGeneName}`}>{qtlGeneName}</StyledLink>
        </Typography>
      )}
    </Tooltip>
  );
};

export default QTLGeneListItem;
