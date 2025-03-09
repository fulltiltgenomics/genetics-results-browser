import { Box, FormControlLabel, Stack, Switch, Typography } from "@mui/material";
import { useMemo } from "react";
import config from "@/config.json";
import { useGeneViewStore } from "@/store/store.gene";
import { CSDatum } from "@/types/types.gene";

const DatasetOptions = ({ data }: { data: CSDatum[] | undefined }) => {
  const { resourceToggles, toggleResource } = useGeneViewStore();

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
    <Box display="flex" flexDirection="row" gap={4}>
      {Object.entries(datatype2resources).map(([datatype, resources]) => (
        <Box key={datatype}>
          <Typography style={{ marginLeft: 8, fontWeight: "bold", userSelect: "none" }}>
            {datatype}
          </Typography>
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
                            resourceCountsByDataType?.[datatype]?.[resource.dataName] === undefined
                          }
                          size="small"
                          sx={{
                            "& .MuiSwitch-switchBase": {
                              padding: 0.5,
                            },
                          }}
                        />
                      }
                      label={`${resourceCountsByDataType?.[datatype]?.[resource.dataName] || 0} ${
                        resource.label
                      }`}
                      sx={{
                        margin: 0,
                        "& .MuiFormControlLabel-label": {
                          color: resource.color,
                          userSelect: "none",
                          width: 70,
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
