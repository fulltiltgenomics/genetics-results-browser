import { useMemo, useRef, useState } from "react";
import { Box, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { MaterialReactTable, MRT_ColumnDef } from "material-react-table";
import { useGeneBurden, useGeneBurdenDatasetSizes } from "@/store/serverQuery";
import { BurdenMaskMode, useGeneEvidenceStore } from "@/store/store.geneEvidence";
import { GeneBurdenRow } from "@/types/types.normalized";
import { LetterBadge } from "../table/DataTypeIcon";
import { UpOrDownIcon } from "../table/UpDownIcons";
import { naInfSort } from "../table/utils/sorting";
import { datasetDisplayName, formatTraitName, pValRepr } from "../table/utils/tableutil";
import { DownloadButton } from "../table/ExportToolbar";
import {
  absBetaSort,
  filterBurdenRows,
  isQuantitativeTrait,
  mostCommonTraitWord,
  orderBurdenDatasets,
} from "./geneBurden";
import GeneBurdenPlot, { GeneBurdenPlotHandle } from "./GeneBurdenPlot";
import { exportGeneBurden } from "./geneEvidenceExport";
import {
  countCell,
  evidenceTableProps,
  Section,
  sortedRows,
  truncatedCell,
} from "./evidenceTable";
import {
  RadioOption,
  RadioOptions,
  TRAIT_TYPE_BADGE,
  TRAIT_TYPE_OPTIONS,
} from "./traitTypeFilter";

const MASK_MODE_OPTIONS: RadioOption<BurdenMaskMode>[] = [
  { value: "top", label: "only the top burden mask for each trait" },
  { value: "all", label: "all burden masks for each trait" },
];

const burdenColumns: MRT_ColumnDef<GeneBurdenRow>[] = [
  {
    accessorFn: (row) => (isQuantitativeTrait(row) ? "quantitative" : "binary"),
    header: "type",
    id: "type",
    size: 70,
    Cell: ({ cell }) => {
      const type = cell.getValue<"binary" | "quantitative">();
      return <LetterBadge {...TRAIT_TYPE_BADGE[type]} title={type} />;
    },
  },
  {
    accessorKey: "dataset",
    header: "dataset",
    id: "dataset",
    size: 110,
    Cell: ({ cell }) => datasetDisplayName(cell.getValue<string>() ?? ""),
  },
  {
    accessorKey: "trait",
    header: "trait",
    id: "trait",
    size: 300,
    Cell: ({ cell }) => truncatedCell(formatTraitName(cell.getValue<string>() ?? "")),
  },
  {
    accessorKey: "annotation",
    header: "burden mask",
    id: "annotation",
    size: 220,
    Cell: ({ cell }) => truncatedCell(cell.getValue<string>() ?? ""),
  },
  {
    // sorted on mlog10p, not the rendered p-value: p underflows to 0 below ~1e-308 and every
    // such row would compare equal
    accessorKey: "mlog10pBurden",
    header: "p-value",
    id: "mlog10pBurden",
    sortingFn: naInfSort,
    sortDescFirst: true,
    size: 100,
    Cell: ({ cell }) => {
      const v = cell.getValue<number | null>();
      return v == null || Number.isNaN(v) ? "" : pValRepr(v);
    },
  },
  {
    accessorKey: "beta",
    header: "beta",
    id: "beta",
    // by magnitude, so strong effects of either sign come first
    sortingFn: absBetaSort,
    sortDescFirst: true,
    size: 90,
    Cell: ({ cell }) => {
      const v = cell.getValue<number | null>();
      return v == null || Number.isNaN(v) ? (
        ""
      ) : (
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <UpOrDownIcon value={v} />
          <span>{v.toPrecision(3)}</span>
        </Box>
      );
    },
  },
  {
    accessorKey: "nCases",
    header: "n cases",
    id: "nCases",
    sortingFn: naInfSort,
    size: 100,
    Cell: countCell,
  },
  {
    accessorKey: "nControls",
    header: "n controls",
    id: "nControls",
    sortingFn: naInfSort,
    size: 110,
    Cell: (props) => (isQuantitativeTrait(props.row.original) ? "NA" : countCell(props)),
  },
];

const GeneBurdenSection = ({ geneName }: { geneName: string }) => {
  const burden = useGeneBurden(geneName);
  const traitType = useGeneEvidenceStore((s) => s.burdenTraitType);
  const maskMode = useGeneEvidenceStore((s) => s.burdenMaskMode);
  const view = useGeneEvidenceStore((s) => s.burdenView);
  const setTraitType = useGeneEvidenceStore((s) => s.setBurdenTraitType);
  const setMaskMode = useGeneEvidenceStore((s) => s.setBurdenMaskMode);
  const setView = useGeneEvidenceStore((s) => s.setBurdenView);
  const datasetSizes = useGeneBurdenDatasetSizes();
  const [search, setSearch] = useState("");

  // genebass reaches the API already cut at mlog10p > 4 — its unfiltered export is 343M rows, so no
  // gene-indexed copy of it exists — while SCHEMA, BipEx and IBD arrive complete. Applying the same
  // cut to all of them makes one row mean the same thing whichever dataset it came from.
  const significantRows = useMemo(
    () => filterBurdenRows(burden.data ?? [], { traitType: "all", maskMode: "all", search: "" }),
    [burden.data]
  );
  const rows = useMemo(
    () => filterBurdenRows(significantRows, { traitType, maskMode, search }),
    [significantRows, traitType, maskMode, search]
  );
  const datasets = useMemo(
    () => orderBurdenDatasets(significantRows, datasetSizes.data),
    [significantRows, datasetSizes.data]
  );
  const exampleWord = useMemo(
    () => mostCommonTraitWord(significantRows) ?? "cholesterol",
    [significantRows]
  );

  const plot = useRef<GeneBurdenPlotHandle>(null);

  return (
    <Section
      isPending={burden.isPending}
      isError={burden.isError}
      error={burden.error}
      isEmpty={significantRows.length === 0}
      emptyText="no burden results with p < 1e-4 for this gene">
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        associations with p &lt; 1e-4 are shown
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 3, mb: 1 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={view}
          onChange={(_e, value) => {
            // exclusive group emits null when the active button is re-clicked; ignore that.
            if (value) setView(value);
          }}
          aria-label="gene burden view">
          <ToggleButton value="table" aria-label="table">
            table
          </ToggleButton>
          <ToggleButton value="plot" aria-label="plot">
            plot
          </ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, max-content)", columnGap: 2 }}>
          <RadioOptions
            label="trait type"
            value={traitType}
            options={TRAIT_TYPE_OPTIONS}
            onChange={setTraitType}
          />
          <RadioOptions
            label="burden masks shown"
            value={maskMode}
            options={MASK_MODE_OPTIONS}
            onChange={setMaskMode}
          />
        </Box>
        <TextField
          size="small"
          label="search"
          placeholder={`e.g. ${exampleWord}, plof, genebass`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ width: 280 }}
        />
      </Box>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          no burden results match these filters
        </Typography>
      ) : view === "plot" ? (
        <>
          <GeneBurdenPlot ref={plot} rows={rows} datasets={datasets} />
          <Box sx={{ mt: 1 }}>
            <DownloadButton
              variant="outlined"
              label="DOWNLOAD PLOT"
              disabled={false}
              onClick={() => plot.current?.downloadPng(`gene_burden_${geneName}`)}
            />
          </Box>
        </>
      ) : (
        <MaterialReactTable
          {...evidenceTableProps}
          // column widths come from the column sizes alone, never from the rows on the page
          layoutMode="grid"
          data={rows}
          columns={burdenColumns}
          enablePagination={rows.length > 20}
          initialState={{ density: "compact", sorting: [{ id: "mlog10pBurden", desc: true }] }}
          // the rows as filtered and sorted on screen
          renderBottomToolbarCustomActions={({ table }) => (
            <Box sx={{ p: "0.5rem" }}>
              <DownloadButton
                variant="outlined"
                label="DOWNLOAD TABLE"
                disabled={false}
                onClick={() => exportGeneBurden(geneName, sortedRows(table))}
              />
            </Box>
          )}
        />
      )}
    </Section>
  );
};

export default GeneBurdenSection;
