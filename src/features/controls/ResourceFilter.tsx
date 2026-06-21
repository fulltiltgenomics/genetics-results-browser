import { Box, Divider, FormControlLabel, FormGroup, FormLabel, Switch, Tooltip } from "@mui/material";
import { useEffect, useMemo, ReactElement } from "react";
import { useDataStore } from "../../store/store";
import { CredibleSetDataType, NormalizedResponse } from "../../types/types.normalized";
import { DataTypeIcon } from "../table/DataTypeIcon";
import { PSEUDO_CS_TOOLTIP } from "../table/utils/tableutil";

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
 * The available resources are restricted to those that actually HAVE credible sets — toggling a
 * resource only acts on CredibleSetMembership.resource, so listing CS-less resources (gtex/gencc/
 * genebass) would offer no-op switches. The list is the union of ResourceMeta entries flagged
 * hasCredibleSets (so CS-capable resources still appear even when the current variants hit none) and
 * any resource present in the raw CS data (e.g. open_targets/ukbb, which are absent from
 * ResourceMeta). ResourceMeta also supplies a friendlier label and the pseudo-CS flag per resource.
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

  // resources that have credible sets, sorted for stable display: the union of ResourceMeta entries
  // flagged hasCredibleSets (so CS-capable resources with no hit for the current variants still
  // appear) and any resource present in the raw CS data (definitionally has CS; covers open_targets/
  // ukbb, absent from ResourceMeta). derived from the unfiltered data so toggling OFF keeps the entry.
  const availableResources: string[] = useMemo(() => {
    const present = new Set<string>();
    // ResourceMeta.id is the resource identifier the filter matches on (cs.resource); .resource is a
    // friendlier display label handled by labelFor below.
    for (const r of normalizedData?.resources ?? []) if (r.hasCredibleSets) present.add(r.id);
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

  // resources whose credible sets are pseudo (approximate, LD-based) rather than formally fine-mapped.
  // marked with a "*" on the toggle so the user knows the PIPs are heuristic — same flag greys the
  // PIP column in the CS table.
  const pseudoResources = useMemo(
    () => new Set((normalizedData?.resources ?? []).filter((r) => r.hasPseudoCredibleSets).map((r) => r.id)),
    [normalizedData]
  );

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
    const isPseudo = pseudoResources.has(resource);
    const label = isPseudo ? (
      <Box sx={{ display: "flex", alignItems: "center", gap: "2px" }}>
        <span>{labelFor(resource)}</span>
        <Tooltip title={PSEUDO_CS_TOOLTIP} arrow>
          <Box component="span" sx={{ color: "text.secondary", cursor: "help" }}>
            *
          </Box>
        </Tooltip>
      </Box>
    ) : (
      labelFor(resource)
    );
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
        label={label}
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
        {/* grid rather than a single column: the CS resource list can run ~10 entries, so stacking
            them vertically made the controls panel very tall. two columns of max-content stay compact. */}
        <FormGroup
          sx={{ display: "grid", gridTemplateColumns: "repeat(2, max-content)", columnGap: "16px" }}>
          {switches}
        </FormGroup>
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
