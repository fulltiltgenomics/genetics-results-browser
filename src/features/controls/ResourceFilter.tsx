import { Box, Divider, FormControlLabel, FormGroup, FormLabel, Switch } from "@mui/material";
import { useEffect, useMemo, ReactElement } from "react";
import { useDataStore } from "../../store/store";
import { CredibleSetDataType, NormalizedResponse } from "../../types/types.normalized";
import { DataTypeIcon } from "../table/DataTypeIcon";

// bare single-letter hotkey per data type. first letters collide (eQTL/edQTL both "e"), so the
// mapping is explicit and unique. shown as a keycap on each toggle for discoverability.
const DATA_TYPE_HOTKEYS: Record<CredibleSetDataType, string> = {
  GWAS: "g",
  eQTL: "e",
  pQTL: "p",
  sQTL: "s",
  caQTL: "c",
  edQTL: "d",
  metaboQTL: "m",
};

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

  // all resources the API serves, sorted for stable display: the union of the dataset-derived
  // ResourceMeta (so resources with no CS for the current variants still appear) and any resource
  // present in the CS data but missing from that metadata (e.g. open_targets). derived from the
  // unfiltered data so toggling a resource OFF doesn't remove it from the list.
  const availableResources: string[] = useMemo(() => {
    const present = new Set<string>();
    // ResourceMeta.id is the resource identifier the filter matches on (cs.resource); .resource is a
    // friendlier display label handled by labelFor below.
    for (const r of normalizedData?.resources ?? []) present.add(r.id);
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

  // bare-letter hotkeys toggle the matching data type (G -> GWAS, E -> eQTL, ...). only bound for the
  // data types actually present, and deliberately ignored while a text box / select / menu is focused
  // so it never fires while the user is typing in the paste box, a column filter, or the phenotype
  // search. no modifier on purpose: Ctrl/Cmd+G is "find next" and Option+G types "©" on macOS.
  useEffect(() => {
    if (props.isNotReadyYet) return;
    const keyToType = new Map<string, CredibleSetDataType>();
    for (const dt of availableDataTypes) keyToType.set(DATA_TYPE_HOTKEYS[dt], dt);
    if (keyToType.size === 0) return;

    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.isContentEditable ||
          target.closest('[role="combobox"], [role="listbox"], [role="option"]'))
      ) {
        return;
      }
      const dataType = keyToType.get(e.key.toLowerCase());
      if (dataType) {
        e.preventDefault();
        toggleCredibleSetDataType(dataType);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [availableDataTypes, toggleCredibleSetDataType, props.isNotReadyYet]);

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
        label={
          <Box sx={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <DataTypeIcon dataType={dataType} />
            <span>{dataType}</span>
            <Box
              component="span"
              title={`Press ${DATA_TYPE_HOTKEYS[dataType].toUpperCase()} to toggle`}
              sx={{
                px: "4px",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: "3px",
                fontSize: "0.6rem",
                lineHeight: 1.5,
                color: "text.secondary",
              }}>
              {DATA_TYPE_HOTKEYS[dataType].toUpperCase()}
            </Box>
          </Box>
        }
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
                // default off = gene-level (ge) only; on adds exon/tx/txrev/leafcutter/majiq (refactor.md §4)
                label="Show all eQTL Catalogue quantification levels (exon/tx/txrev/leafcutter/majiq)"
              />
            </FormGroup>
          </Box>
        </>
      )}
    </Box>
  );
};

export default ResourceFilter;
