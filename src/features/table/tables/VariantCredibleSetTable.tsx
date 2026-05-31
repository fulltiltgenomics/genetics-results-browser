import { useMemo } from "react";
import { Box, Chip, Typography } from "@mui/material";
import { MaterialReactTable } from "material-react-table";
import type { MRT_ColumnDef } from "material-react-table";
import { GroupedCredibleSet, VariantResult } from "../../../types/types.normalized";
import { groupCredibleSets } from "../../../store/munge.normalized";
import { pValRepr } from "../utils/tableutil";
import { HtmlTooltip } from "../../tooltips/HtmlTooltip";
import { UpOrDownIcon } from "../UpDownIcons";
import { naInfSort } from "../utils/sorting";

/**
 * The single per-variant detail table for the credible-set-only data model (refactor.md §4).
 * Replaces the old two-table detail (VariantFinemappedTable + VariantAssocTable): "Association
 * results" is dropped — we now only have credible sets across all phenotypes.
 *
 * Renders groupCredibleSets() over the variant's ALREADY-filtered credibleSets (the store filters
 * client-side, this only groups). Shows data_type / dataset / trait / PIP / beta, with cs_size and
 * cs_min_r2 in the PIP tooltip.
 */

// guard: grouped arrays coerce a null mlog10p to NaN, and a missing/grouped value can be undefined.
const num = (v: number | undefined): string =>
  v === undefined || Number.isNaN(v) ? "-" : `${v}`;

const getColumns = (): MRT_ColumnDef<GroupedCredibleSet>[] => [
  {
    accessorKey: "dataType",
    header: "type",
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "type" },
    size: 70,
  },
  {
    accessorFn: (row) =>
      row.count === 1
        ? row.dataset.replace(/_/g, " ")
        : `${row.dataset.replace(/_/g, " ")} (${row.count})`,
    id: "dataset",
    header: "dataset",
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "dataset" },
    size: 160,
  },
  {
    // QTL trait collapses to the gene symbol (refactor.md §4). gene-level (ge) rows show the symbol
    // alone — no redundant "ge" badge. only non-gene eQTL levels carry a level chip to disambiguate
    // an otherwise-identical gene symbol (e.g. CLASRP · exon). pQTL=protein, caQTL=peak id,
    // GWAS=phenotype all have quantLevel === null and so render the bare trait.
    accessorFn: (row) =>
      row.quantLevel && row.quantLevel !== "ge" ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span>{row.trait}</span>
          <Chip
            label={row.quantLevel}
            size="small"
            variant="outlined"
            sx={{ height: "16px", fontSize: "0.65rem", "& .MuiChip-label": { px: "5px" } }}
          />
        </Box>
      ) : (
        row.trait
      ),
    id: "trait",
    header: "trait",
    // sort on the raw gene symbol; the accessorFn returns a ReactElement that MRT can't compare
    sortingFn: (rowA, rowB) => rowA.original.trait.localeCompare(rowB.original.trait),
    // keep filtering on the raw gene symbol; the level is a presentational chip, not part of the text
    filterFn: (row, _id, filterValue) =>
      row.original.trait.toLowerCase().includes(String(filterValue).toLowerCase()),
    muiFilterTextFieldProps: { placeholder: "trait" },
  },
  {
    accessorFn: (row) => {
      // mlog10p arrays carry NaN where the source mlog10p was null (open_targets CS rows): guard it.
      const top = row.mlog10p[0];
      return Number.isNaN(top) || top === undefined ? "-" : pValRepr(top);
    },
    id: "mlog10p",
    header: "p-value",
    sortingFn: naInfSort,
    sortDescFirst: true,
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "filter" },
    size: 70,
  },
  {
    accessorFn: (row) => <UpOrDownIcon value={row.beta[0]} withValue precision={3} />,
    id: "beta",
    header: "beta",
    enableSorting: false,
    size: 70,
  },
  {
    accessorFn: (row) => {
      const ttRows = row.phenocodes.map((phenocode, i) => (
        <tr key={`${phenocode}-${i}`}>
          <td>{phenocode}</td>
          <td style={{ textAlign: "center" }}>{num(row.csSize[i])}</td>
          <td style={{ textAlign: "center" }}>{num(row.csMinR2[i])}</td>
          <td>{Number.isNaN(row.pip[i]) ? "-" : row.pip[i].toPrecision(3)}</td>
        </tr>
      ));
      return (
        <HtmlTooltip
          title={
            <table>
              <thead>
                <tr>
                  <th style={{ fontWeight: "bold", textAlign: "start" }}>trait</th>
                  <th style={{ fontWeight: "bold", textAlign: "start" }}>cs size</th>
                  <th style={{ fontWeight: "bold", textAlign: "start" }}>cs min r2</th>
                  <th style={{ fontWeight: "bold", textAlign: "start" }}>PIP</th>
                </tr>
              </thead>
              <tbody>{ttRows}</tbody>
            </table>
          }>
          <span>{Number.isNaN(row.maxPip) ? "-" : row.maxPip.toPrecision(3)}</span>
        </HtmlTooltip>
      );
    },
    id: "pip",
    header: "PIP",
    enableSorting: false,
    size: 80,
  },
];

const VariantCredibleSetTable = (props: { data: VariantResult }) => {
  const grouped = useMemo(
    () => groupCredibleSets(props.data.credibleSets),
    [props.data.credibleSets]
  );
  const columns = useMemo(getColumns, []);

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Typography sx={{ marginBottom: "10px", fontWeight: "bold" }}>
        Credible sets / fine-mapping results
      </Typography>
      <Typography sx={{ marginBottom: "10px" }}>
        The credible sets across all phenotypes and QTLs that contain this variant, after the current
        PIP / resource / data-type filters.
      </Typography>
      <MaterialReactTable
        columns={columns}
        data={grouped}
        enableTopToolbar={false}
        initialState={{ showColumnFilters: true, density: "compact" }}
        muiTableProps={{ sx: { tableLayout: "fixed" } }}
        muiTableBodyCellProps={{ sx: { fontSize: "0.75rem" } }}
        sortingFns={{ naInfSort }}
      />
    </Box>
  );
};

export default VariantCredibleSetTable;
