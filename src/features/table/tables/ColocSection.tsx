import { useState } from "react";
import { Box, Button, CircularProgress, Chip, Typography } from "@mui/material";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import { COLOC_PP_H4_THRESHOLD, useColocByCredibleSet } from "../../../store/serverQuery";
import { GroupedCredibleSet } from "../../../types/types.normalized";

/**
 * Per-credible-set colocalization affordance for the expanded variant detail (refactor.md §4):
 * "this signal colocalizes with…". The fetch is lazy — it only fires after the user clicks open,
 * via useColocByCredibleSet gated on `enabled`. One section per distinct cs_id, since coloc is
 * per-credible-set; a grouped row that collapses several memberships shows one block per CS.
 */
const CredibleSetColoc = (props: { resource: string; trait: string; csId: string }) => {
  const [open, setOpen] = useState(false);
  // the query stays idle until the user opens it; staleTime keeps it cached on reopen.
  const { data, isFetching, isError } = useColocByCredibleSet(
    props.resource,
    props.trait,
    props.csId,
    open
  );

  return (
    <Box sx={{ marginBottom: "8px" }}>
      <Button
        size="small"
        variant="text"
        startIcon={<HubOutlinedIcon sx={{ fontSize: "0.9rem" }} />}
        onClick={() => setOpen((o) => !o)}
        sx={{ textTransform: "none", fontSize: "0.72rem", padding: "2px 6px" }}>
        {open ? "hide" : "show"} colocalizations · {props.csId}
      </Button>

      {open && (
        <Box sx={{ paddingLeft: "12px", marginTop: "4px" }}>
          {isFetching && (
            <Box sx={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <CircularProgress size={12} />
              <Typography sx={{ fontSize: "0.72rem" }}>loading colocalizations…</Typography>
            </Box>
          )}
          {isError && (
            <Typography sx={{ fontSize: "0.72rem", color: "error.main" }}>
              failed to load colocalizations
            </Typography>
          )}
          {!isFetching && !isError && data && data.length === 0 && (
            <Typography sx={{ fontSize: "0.72rem", fontStyle: "italic" }}>
              no colocalizations
            </Typography>
          )}
          {!isFetching && !isError && data && data.length > 0 && (
            <Box sx={{ maxHeight: "260px", overflowY: "auto" }}>
              <Typography sx={{ fontSize: "0.7rem", fontStyle: "italic", marginBottom: "2px" }}>
                {data.length} colocalization{data.length === 1 ? "" : "s"} (PP.H4 ≥{" "}
                {COLOC_PP_H4_THRESHOLD})
              </Typography>
              <table style={{ fontSize: "0.72rem", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "start", fontWeight: "bold", paddingRight: "12px" }}>
                    type
                  </th>
                  <th style={{ textAlign: "start", fontWeight: "bold", paddingRight: "12px" }}>
                    trait
                  </th>
                  <th style={{ textAlign: "start", fontWeight: "bold", paddingRight: "12px" }}>
                    cell/tissue
                  </th>
                  <th style={{ textAlign: "start", fontWeight: "bold", paddingRight: "12px" }}>
                    PP.H4
                  </th>
                  <th style={{ textAlign: "start", fontWeight: "bold" }}>CLPP</th>
                </tr>
              </thead>
              <tbody>
                {data.map((c, i) => (
                  <tr key={`${c.resource2}-${c.trait2}-${c.hit2}-${i}`}>
                    <td style={{ paddingRight: "12px" }}>
                      <Chip
                        label={c.dataType2}
                        size="small"
                        variant="outlined"
                        sx={{ height: "16px", fontSize: "0.62rem", "& .MuiChip-label": { px: "5px" } }}
                      />
                    </td>
                    <td style={{ paddingRight: "12px" }}>
                      {c.trait2Phenostring ?? c.trait2}
                    </td>
                    <td style={{ paddingRight: "12px" }}>{c.cellType2 ?? "-"}</td>
                    <td style={{ paddingRight: "12px" }}>{c.ppH4.toPrecision(3)}</td>
                    <td>{c.clpp == null ? "-" : c.clpp.toPrecision(3)}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

const ColocSection = (props: { row: GroupedCredibleSet }) => {
  // coloc is per credible set; a grouped row can carry several memberships -> one block per cs_id.
  const distinctCsIds = Array.from(new Set(props.row.csIds));

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Typography sx={{ fontSize: "0.72rem", fontWeight: "bold", marginBottom: "4px" }}>
        What this signal colocalizes with
      </Typography>
      {distinctCsIds.map((csId) => (
        <CredibleSetColoc
          key={csId}
          resource={props.row.resource}
          trait={props.row.trait}
          csId={csId}
        />
      ))}
    </Box>
  );
};

export default ColocSection;
