import { Box, Divider, FormControlLabel, FormGroup, FormLabel, Switch } from "@mui/material";
import { useMemo, ReactElement } from "react";
import { useDataStore } from "../../store/store";
import { CredibleSetDataType, NormalizedResponse } from "../../types/types.normalized";

/**
 * Lifted resource filter (refactor.md §4): moved out of the variant expanded table into the main
 * options. Wired to store.resourceFilter/toggleResource so toggling reactively refilters the table
 * client-side (stage 2) WITHOUT a refetch.
 *
 * The available resources are derived DYNAMICALLY from the data, specifically the distinct
 * `resource` values present across every variant's RAW credibleSets. We deliberately use the CS
 * data rather than NormalizedResponse.resources because the filter in munge.normalized matches on
 * CredibleSetMembership.resource — and the two sets diverge: ResourceMeta lists resources with no CS
 * rows (e.g. gtex/gencc/genebass), while the CS data carries resources absent from ResourceMeta
 * (e.g. open_targets, ukbb). Listing only what the filter can actually act on keeps the control
 * honest. ResourceMeta is still consulted for a friendlier label when the id happens to be present.
 */
const ResourceFilter = (props: { isNotReadyYet: boolean }) => {
  const normalizedData: NormalizedResponse | undefined = useDataStore(
    (state) => state.normalizedData
  );
  const resourceFilter = useDataStore((state) => state.resourceFilter);
  const toggleResource = useDataStore((state) => state.toggleResource);
  const toggledCredibleSetDataTypes = useDataStore((state) => state.toggledCredibleSetDataTypes);
  const toggleCredibleSetDataType = useDataStore((state) => state.toggleCredibleSetDataType);
  const includeAllQuantLevels = useDataStore((state) => state.includeAllQuantLevels);
  const setIncludeAllQuantLevels = useDataStore((state) => state.setIncludeAllQuantLevels);

  // distinct CS resources in the raw data, sorted for stable display. derived from the unfiltered
  // variants so toggling a resource OFF doesn't remove it from the list (the user must be able to
  // toggle it back on).
  const availableResources: string[] = useMemo(() => {
    const present = new Set<string>();
    for (const v of normalizedData?.variants ?? []) {
      for (const cs of v.credibleSets) present.add(cs.resource);
    }
    return [...present].sort();
  }, [normalizedData]);

  // resource id -> friendly label, when ResourceMeta carries one. falls back to the id itself.
  const labelFor = useMemo(() => {
    const byId = new Map((normalizedData?.resources ?? []).map((r) => [r.id, r.resource]));
    return (id: string) => byId.get(id) ?? id;
  }, [normalizedData]);

  // distinct CS data types present in the raw data — same dynamic-derive pattern as resources.
  // these toggles drive the NEW credible-set filter path (toggledCredibleSetDataTypes), not the
  // legacy DataType switches in GlobalDataTypeSwitches.tsx, which still feed the legacy clientData.
  const availableDataTypes: CredibleSetDataType[] = useMemo(() => {
    const present = new Set<CredibleSetDataType>();
    for (const v of normalizedData?.variants ?? []) {
      for (const cs of v.credibleSets) present.add(cs.dataType);
    }
    return [...present].sort();
  }, [normalizedData]);

  // only offer the quant-level toggle when the data actually carries eQTL Catalogue rows with a
  // parsed level (quantLevel !== null) — otherwise the option would be a no-op and just clutter.
  const hasLeveledData: boolean = useMemo(() => {
    for (const v of normalizedData?.variants ?? []) {
      for (const cs of v.credibleSets) if (cs.quantLevel !== null) return true;
    }
    return false;
  }, [normalizedData]);

  const switches: ReactElement[] = availableResources.map((resource) => {
    // undefined filter = no filter, everything on. otherwise on iff present in the set.
    const checked = resourceFilter === undefined || resourceFilter.has(resource);
    return (
      <FormControlLabel
        key={resource}
        control={
          <Switch
            checked={checked}
            disabled={props.isNotReadyYet}
            onChange={() => toggleResource(resource)}
          />
        }
        label={labelFor(resource)}
      />
    );
  });

  const dataTypeSwitches: ReactElement[] = availableDataTypes.map((dataType) => {
    // absent key in toggledCredibleSetDataTypes means ENABLED (permissive default in passesFilter),
    // so only an explicit === false renders unchecked.
    const checked = toggledCredibleSetDataTypes[dataType] !== false;
    return (
      <FormControlLabel
        key={dataType}
        control={
          <Switch
            checked={checked}
            disabled={props.isNotReadyYet}
            onChange={() => toggleCredibleSetDataType(dataType)}
          />
        }
        label={dataType}
      />
    );
  });

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "row",
      }}>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          paddingLeft: "20px",
          paddingRight: "20px",
        }}>
        <FormLabel sx={{ fontSize: "0.75rem" }}>Resources</FormLabel>
        <FormGroup>{switches}</FormGroup>
      </Box>
      <Divider sx={{ margin: "auto" }} orientation="vertical" />
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          paddingLeft: "20px",
          paddingRight: "20px",
        }}>
        <FormLabel sx={{ fontSize: "0.75rem" }}>Data types</FormLabel>
        <FormGroup>{dataTypeSwitches}</FormGroup>
      </Box>
      {hasLeveledData && (
        <>
          <Divider sx={{ margin: "auto" }} orientation="vertical" />
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              paddingLeft: "20px",
              paddingRight: "20px",
            }}>
            <FormLabel sx={{ fontSize: "0.75rem" }}>eQTL quantification</FormLabel>
            <FormGroup>
              <FormControlLabel
                control={
                  <Switch
                    checked={includeAllQuantLevels}
                    disabled={props.isNotReadyYet}
                    onChange={() => setIncludeAllQuantLevels(!includeAllQuantLevels)}
                  />
                }
                // default off = gene-level (ge) only; on adds exon/tx/txrev/leafcutter (refactor.md §4)
                label="Show all eQTL Catalogue quantification levels (exon/tx/txrev/leafcutter)"
              />
            </FormGroup>
          </Box>
        </>
      )}
    </Box>
  );
};

export default ResourceFilter;
