import { Box, FormControlLabel, Stack, Switch, Tooltip, Typography } from "@mui/material";
import { useMemo } from "react";
import config from "@/config.json";
import { useGeneViewStore } from "@/store/store.gene";
import { CSDatum } from "@/types/types.gene";
import { CredibleSetDataType } from "@/types/types.normalized";
import { DataTypeIcon } from "./table/DataTypeIcon";
import { PSEUDO_CS_TOOLTIP } from "./table/utils/tableutil";
import { pseudoDataNames } from "@/store/geneCS";
import { useDatasets } from "@/store/serverQuery";

const DatasetOptions = ({ data }: { data: CSDatum[] | undefined }) => {
  const { resourceToggles, toggleResource } = useGeneViewStore();
  const { data: datasets } = useDatasets();
  const pseudoResources = useMemo(() => pseudoDataNames(datasets), [datasets]);

  const resourceCountsByDataType = useMemo(() => {
    return data?.reduce((acc, d) => {
      if (!acc[d.dataType]) {
        acc[d.dataType] = {};
      }
      if (!acc[d.dataType][d.resource]) {
        acc[d.dataType][d.resource] = 0;
      }
      acc[d.dataType][d.resource]++;
      return acc;
    }, {} as Record<string, Record<string, number>>);
  }, [data]);

  const datatype2resources = useMemo(() => {
    return config.gene_view.resources.reduce((acc, resource) => {
      acc[resource.dataType] = [...(acc[resource.dataType] || []), resource];
      return acc;
    }, {} as Record<string, Record<string, string>[]>);
  }, [config.gene_view.resources]);

  const getResourceColumns = (resources: Record<string, string>[]) => {
    const numColumns = Math.ceil(resources.length / 3);
    const cols: Record<string, string>[][] = Array.from({ length: numColumns }, () => []);
    resources.forEach((resource, index) => {
      const colIndex = Math.floor(index / 3);
      cols[colIndex].push(resource);
    });
    return cols;
  };

  return (
    <Box display="flex" flexDirection="row" flexWrap="wrap" gap={4}>
      {Object.entries(datatype2resources)
        .sort((a, b) => {
          if (a[0] === "GWAS" && b[0] !== "GWAS") return -1;
          if (a[0] !== "GWAS" && b[0] === "GWAS") return 1;
          if (a[0] === "pQTL" && b[0] !== "pQTL") return -1;
          if (a[0] !== "pQTL" && b[0] === "pQTL") return 1;
          if (a[0] === "eQTL" && b[0] !== "eQTL") return -1;
          if (a[0] !== "eQTL" && b[0] === "eQTL") return 1;
          if (a[0] === "metaboQTL" && b[0] !== "metaboQTL") return -1;
          if (a[0] !== "metaboQTL" && b[0] === "metaboQTL") return 1;
          return 0;
        })
        .map(([datatype, resources]) => (
          <Box key={datatype} sx={{ flexShrink: 0 }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                marginLeft: "8px",
                userSelect: "none",
              }}>
              <DataTypeIcon dataType={datatype as CredibleSetDataType} />
              <Typography style={{ fontWeight: "bold" }}>{datatype}</Typography>
            </Box>
            <Stack direction="row" spacing={2} sx={{ maxWidth: "fit-content" }}>
              {getResourceColumns(resources).map((column, colIndex) => (
                <Stack key={colIndex}>
                  <Box display="flex" flexDirection="column">
                    {column.map((resource) => (
                      <FormControlLabel
                        key={resource.dataName}
                        control={
                          <Switch
                            checked={resourceToggles[resource.dataName] ?? true}
                            onChange={() => toggleResource(resource.dataName)}
                            name={resource.dataName}
                            disabled={
                              resourceCountsByDataType?.[datatype]?.[resource.dataName] ===
                              undefined
                            }
                            size="small"
                            sx={{
                              "& .MuiSwitch-switchBase": {
                                padding: 0.5,
                              },
                            }}
                          />
                        }
                        label={
                          <>
                            {`${resourceCountsByDataType?.[datatype]?.[resource.dataName] || 0} ${
                              resource.label
                            }`}
                            {/* same "*" marker the variant tables' resource filter uses */}
                            {pseudoResources.has(resource.dataName) && (
                              <Tooltip title={PSEUDO_CS_TOOLTIP} arrow>
                                <Box
                                  component="span"
                                  sx={{ color: "text.secondary", cursor: "help", ml: "2px" }}>
                                  *
                                </Box>
                              </Tooltip>
                            )}
                          </>
                        }
                        sx={{
                          margin: 0,
                          "& .MuiFormControlLabel-label": {
                            color: resource.color,
                            userSelect: "none",
                            // a long count + label ("375 FG+MVP+UKB") must not wrap away from its
                            // switch, so the column grows to fit instead of the text breaking
                            minWidth: 70,
                            whiteSpace: "nowrap",
                          },
                        }}
                      />
                    ))}
                  </Box>
                </Stack>
              ))}
            </Stack>
          </Box>
        ))}
    </Box>
  );
};

export default DatasetOptions;
