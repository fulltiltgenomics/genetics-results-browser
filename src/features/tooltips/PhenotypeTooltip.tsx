import { ReactElement, useState } from "react";
import { Typography } from "@mui/material";
import { HtmlTooltip } from "./HtmlTooltip";
import { useResourceMetadata } from "../../store/serverQuery";
import { formatTraitName } from "../table/utils/tableutil";

/**
 * Hover tooltip for a phenotype / "top association" / trait cell (refactor port of the legacy
 * PhenoTooltip). Shows the resolved name, the raw phenocode, data type, dataset, and — fetched
 * lazily on hover via useResourceMetadata — the case / control / sample counts and trait type.
 *
 * The counts come from /v1/resource_metadata/{resource}, keyed by phenocode; that fetch is gated on
 * hover (per resource, cached forever) so the large open_targets metadata isn't pulled until needed.
 * Resources without harmonized metadata (or phenotypes missing from it) simply show no counts.
 */
export const PhenotypeTooltip = (props: {
  resource: string;
  phenocode: string; // raw phenocode / study id (trait_original) — the resource_metadata join key
  phenostring: string; // already-resolved display name (may equal the raw code when unresolved)
  dataType: string;
  dataset?: string;
  content: ReactElement;
}) => {
  const [hovered, setHovered] = useState(false);
  const { data: meta, isFetching } = useResourceMetadata(props.resource, hovered);
  // counts are keyed by the original phenocode (e.g. "G6_ALZHEIMER", "3001122"), NOT the display
  // name — the credible-set `trait` is sometimes already a name (FinnGen R14), so join on phenocode.
  const info = meta?.[props.phenocode];

  // prefer the already-resolved name; fall back to the metadata name when the trait is still a bare
  // code (e.g. some lab/OMOP ids the trait_name_mapping lacks but resource_metadata may carry).
  const resolvedName =
    props.phenostring && props.phenostring !== props.phenocode
      ? props.phenostring
      : info?.name || props.phenostring;

  const counts = info ? (
    info.traitType === "binary" && info.nCases != null ? (
      <div>
        {info.nCases.toLocaleString()} cases
        {info.nControls != null ? ` / ${info.nControls.toLocaleString()} controls` : ""}
      </div>
    ) : info.nSamples != null ? (
      <div>{info.nSamples.toLocaleString()} samples</div>
    ) : null
  ) : hovered && isFetching ? (
    <div>loading counts…</div>
  ) : null;

  return (
    <span onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <HtmlTooltip
        title={
          <div>
            <Typography sx={{ fontWeight: "bold" }}>{formatTraitName(resolvedName)}</Typography>
            <div>{props.phenocode}</div>
            <div>
              {props.dataType}
              {props.dataset ? ` · ${props.dataset.replace(/_/g, " ")}` : ""}
            </div>
            {info?.traitType ? <div>{info.traitType}</div> : null}
            {counts}
          </div>
        }>
        {props.content}
      </HtmlTooltip>
    </span>
  );
};

export default PhenotypeTooltip;
