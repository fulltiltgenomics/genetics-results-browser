import { useState } from "react";
import { Box, Button, CircularProgress, Chip, Typography } from "@mui/material";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import { useColocByVariant, useTraitNameMapping } from "../../../store/serverQuery";
import { ColocPair, GroupedCredibleSet } from "../../../types/types.normalized";

/**
 * partner trait cell: QTL partners show gene symbol/protein/peak + a quant-level chip (bare for
 * ge/null, "[exon]"-style chip for non-ge eQTL levels — mirrors VariantCredibleSetTable's trait
 * column); GWAS partners show the resolved phenostring when the trait_name_mapping has it, else the
 * bare phenocode. cellType2 (tissue/cell) is rendered in its own column by the caller.
 */
const PartnerTrait = (props: { coloc: ColocPair; phenostrings?: Record<string, string> }) => {
  const { coloc, phenostrings } = props;
  // GWAS partner: prefer a human phenostring; fall back to the phenocode if the map lacks it.
  if (coloc.dataType2 === "GWAS") {
    return <span>{phenostrings?.[coloc.trait2] ?? coloc.trait2}</span>;
  }
  // QTL partner: bare gene symbol unless a non-gene eQTL quant level needs disambiguating.
  if (coloc.quantLevel2 && coloc.quantLevel2 !== "ge") {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <span>{coloc.trait2}</span>
        <Chip
          label={coloc.quantLevel2}
          size="small"
          variant="outlined"
          sx={{ height: "16px", fontSize: "0.62rem", "& .MuiChip-label": { px: "5px" } }}
        />
      </Box>
    );
  }
  return <span>{coloc.trait2}</span>;
};

/**
 * Per-signal colocalization affordance for the expanded variant detail (refactor.md §4): "this
 * signal colocalizes with…". The fetch is lazy — it only fires after the user clicks open, via
 * useColocByVariant gated on `enabled`. Anchored on the variant + the credible set's resource/trait
 * (not the cs id), so it works regardless of cs-id format (region / variant / molecular-QTL).
 */
const CredibleSetColoc = (props: { variant: string; resource: string; trait: string }) => {
  const [open, setOpen] = useState(false);
  // the query stays idle until the user opens it; staleTime keeps it cached on reopen.
  const { data, isFetching, isError } = useColocByVariant(
    props.variant,
    props.resource,
    props.trait,
    open
  );
  // resolve GWAS partner phenocodes to phenostrings; one cached fetch shared across open sections.
  const { data: phenostrings } = useTraitNameMapping(open);

  return (
    <Box sx={{ marginBottom: "8px" }}>
      <Button
        size="small"
        variant="text"
        startIcon={<HubOutlinedIcon sx={{ fontSize: "0.9rem" }} />}
        onClick={() => setOpen((o) => !o)}
        sx={{ textTransform: "none", fontSize: "0.72rem", padding: "2px 6px" }}>
        {open ? "hide" : "show"} colocalization data
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
                {data.length} colocalization{data.length === 1 ? "" : "s"}
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
                      <PartnerTrait coloc={c} phenostrings={phenostrings} />
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

const ColocSection = (props: { row: GroupedCredibleSet; variant: string }) => {
  // the coloc endpoint filters on the credible-set file's NATIVE trait id, which the credible_sets
  // API harmonizes inconsistently: a GWAS `trait` is a display name and the phenocode the coloc file
  // keys on lives in `traitOriginal` (e.g. "Atrial_fibrillation_and_flutter" vs "I9_AF"), whereas a
  // QTL `trait` is already the gene/protein symbol the coloc file uses (traitOriginal adds molecular
  // detail). pass the phenocode for GWAS, the symbol for QTLs — otherwise GWAS rows wrongly show none.
  const phenotypeKey =
    props.row.dataType === "GWAS" ? props.row.traitOriginal : props.row.trait;
  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Typography sx={{ fontSize: "0.72rem", fontWeight: "bold", marginBottom: "4px" }}>
        What this signal colocalizes with
      </Typography>
      <CredibleSetColoc
        variant={props.variant}
        resource={props.row.resource}
        trait={phenotypeKey}
      />
    </Box>
  );
};

export default ColocSection;
