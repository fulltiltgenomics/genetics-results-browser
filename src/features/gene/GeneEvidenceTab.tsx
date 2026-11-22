import { useMemo, useState } from "react";
import { Box, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { MaterialReactTable, MRT_ColumnDef } from "material-react-table";
import { useGeneDisease, useGeneExpression } from "@/store/serverQuery";
import {
  GENE_EVIDENCE_TABS,
  GeneEvidenceTabName,
  useGeneEvidenceStore,
} from "@/store/store.geneEvidence";
import { GeneDiseaseRow, GeneExpressionRow } from "@/types/types.normalized";
import { naInfSort } from "../table/utils/sorting";
import { datasetDisplayName } from "../table/utils/tableutil";
import CellTypeExpressionSection from "./CellTypeExpressionSection";
import GeneAnnotationSection from "./GeneAnnotationSection";
import GeneAssociationSection from "./GeneAssociationSection";
import GeneBurdenSection from "./GeneBurdenSection";
import GeneExpressionPlot from "./GeneExpressionPlot";
import { gtexTissueLabel } from "./gtexTissues";
import { hpaLevelLabel, hpaLevelRank, hpaTissueLabel } from "./hpa";
import { DownloadButton, toolbarSx } from "../table/ExportToolbar";
import { exportGtexExpression, exportHpaExpression } from "./geneEvidenceExport";
import { evidenceTableProps as tableProps, numCell, Section, sortedRows } from "./evidenceTable";

/**
 * Gene evidence (refactor.md §6): gene-level evidence, one kind per tab. A tab mounts, and so
 * fetches, only when it is opened, and one failing/empty source never blocks the others.
 */

// shared by both expression tables, which carry the same dataset ids
const datasetColumn: MRT_ColumnDef<GeneExpressionRow> = {
  accessorKey: "dataset",
  header: "dataset",
  id: "dataset",
  size: 120,
  Cell: ({ cell }) => datasetDisplayName(cell.getValue<string>()),
};

const ExpressionEvidence = ({ geneName }: { geneName: string }) => {
  const expression = useGeneExpression(geneName);
  const [gtexView, setGtexView] = useState<"plot" | "table">("plot");

  // the endpoint returns every expression resource in one response; they are split here because GTEx
  // (numeric median TPM) and HPA (immunohistochemistry) are not comparable in one table or plot
  const gtexRows = useMemo(
    () => (expression.data ?? []).filter((r) => r.resource === "gtex"),
    [expression.data]
  );
  const hpaRows = useMemo(
    () => (expression.data ?? []).filter((r) => r.resource === "hpa"),
    [expression.data]
  );
  const gtexVersion = gtexRows[0]?.version ?? "";

  // GTEx rows are numeric median TPM; HPA rows are categorical immunohistochemistry staining levels,
  // so that table shows the level as served rather than the parsed number
  const gtexColumns = useMemo<MRT_ColumnDef<GeneExpressionRow>[]>(
    () => [
      {
        accessorKey: "tissueCell",
        header: "tissue / cell",
        id: "tissueCell",
        size: 260,
        Cell: ({ cell }) => gtexTissueLabel(cell.getValue<string>()),
      },
      {
        accessorKey: "level",
        header: "median TPM",
        id: "level",
        sortingFn: naInfSort,
        sortDescFirst: true,
        size: 120,
        Cell: numCell(4),
      },
      datasetColumn,
    ],
    []
  );

  const hpaColumns = useMemo<MRT_ColumnDef<GeneExpressionRow>[]>(
    () => [
      {
        accessorKey: "tissueCell",
        header: "tissue / cell",
        id: "tissueCell",
        size: 260,
        Cell: ({ cell }) => hpaTissueLabel(cell.getValue<string>()),
      },
      {
        accessorKey: "levelRaw",
        header: "level",
        id: "levelRaw",
        // staining categories, so ordered by intensity rather than alphabetically
        sortingFn: (a, b) => hpaLevelRank(a.original.levelRaw) - hpaLevelRank(b.original.levelRaw),
        sortDescFirst: true,
        size: 120,
        Cell: ({ cell }) => hpaLevelLabel(cell.getValue<string>()),
      },
      datasetColumn,
    ],
    []
  );

  return (
    <>
      <Section
        title={`Expression (GTEx${gtexVersion ? ` ${gtexVersion}` : ""})`}
        isPending={expression.isPending}
        isError={expression.isError}
        error={expression.error}
        isEmpty={gtexRows.length === 0}
        emptyText="no GTEx expression data for this gene">
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={gtexView}
            onChange={(_e, value) => {
              // exclusive group emits null when the active button is re-clicked; ignore that.
              if (value) setGtexView(value);
            }}
            aria-label="GTEx expression view">
            <ToggleButton value="plot" aria-label="plot">
              plot
            </ToggleButton>
            <ToggleButton value="table" aria-label="table">
              table
            </ToggleButton>
          </ToggleButtonGroup>
          {/* beside the view toggle rather than in the table toolbar, so the download is there in
              plot view too */}
          <DownloadButton
            label="DOWNLOAD GTEX EXPRESSION"
            disabled={gtexRows.length === 0}
            onClick={() => exportGtexExpression(geneName, gtexRows)}
          />
        </Box>
        {gtexView === "plot" ? (
          <GeneExpressionPlot rows={gtexRows} />
        ) : (
          <MaterialReactTable
            {...tableProps}
            data={gtexRows}
            columns={gtexColumns}
            enablePagination={gtexRows.length > 20}
            initialState={{ density: "compact", sorting: [{ id: "level", desc: true }] }}
          />
        )}
      </Section>

      <Section
        title="Expression (Human Protein Atlas)"
        isPending={expression.isPending}
        isError={expression.isError}
        error={expression.error}
        isEmpty={hpaRows.length === 0}
        emptyText="no HPA expression data for this gene">
        <MaterialReactTable
          {...tableProps}
          data={hpaRows}
          columns={hpaColumns}
          enablePagination={hpaRows.length > 20}
          initialState={{ density: "compact", sorting: [{ id: "levelRaw", desc: true }] }}
          renderTopToolbarCustomActions={({ table }) => (
            <Box sx={toolbarSx}>
              <DownloadButton
                label="DOWNLOAD HPA EXPRESSION"
                disabled={hpaRows.length === 0}
                onClick={() => exportHpaExpression(geneName, sortedRows(table))}
              />
            </Box>
          )}
        />
      </Section>

      <CellTypeExpressionSection geneName={geneName} />
    </>
  );
};

const MendelianEvidence = ({ geneName }: { geneName: string }) => {
  const disease = useGeneDisease(geneName);

  const diseaseColumns = useMemo<MRT_ColumnDef<GeneDiseaseRow>[]>(
    () => [
      { accessorKey: "diseaseTitle", header: "disease", id: "diseaseTitle", size: 240 },
      { accessorKey: "classification", header: "classification", id: "classification", size: 120 },
      {
        accessorKey: "modeOfInheritance",
        header: "mode of inheritance",
        id: "modeOfInheritance",
        size: 160,
      },
      { accessorKey: "submitter", header: "submitter", id: "submitter", size: 200 },
      { accessorKey: "resource", header: "source", id: "resource", size: 90 },
    ],
    []
  );

  return (
    <Section
      isPending={disease.isPending}
      isError={disease.isError}
      error={disease.error}
      isEmpty={(disease.data?.length ?? 0) === 0}
      emptyText="no gene-disease associations for this gene">
      <MaterialReactTable
        {...tableProps}
        data={disease.data ?? []}
        columns={diseaseColumns}
        enablePagination={(disease.data?.length ?? 0) > 20}
        initialState={{ density: "compact" }}
      />
    </Section>
  );
};

const tabContent = (tab: GeneEvidenceTabName, geneName: string) => {
  switch (tab) {
    case "annotation":
      return <GeneAnnotationSection geneName={geneName} />;
    case "gene burden":
      return <GeneBurdenSection geneName={geneName} />;
    case "variant association":
      return <GeneAssociationSection geneName={geneName} />;
    case "expression":
      return <ExpressionEvidence geneName={geneName} />;
    case "mendelian":
      return <MendelianEvidence geneName={geneName} />;
    default:
      return (
        <Typography variant="body2" color="text.secondary">
          not available yet
        </Typography>
      );
  }
};

const GeneEvidenceTab = ({ geneName }: { geneName: string }) => {
  const activeTab = useGeneEvidenceStore((s) => s.activeTab);
  const setActiveTab = useGeneEvidenceStore((s) => s.setActiveTab);

  return (
    <Box sx={{ p: 2 }}>
      <Typography sx={{ mb: 1 }} variant="body2" color="text.secondary">
        Gene-level evidence for <b>{geneName}</b>.
      </Typography>
      <Tabs
        value={activeTab}
        onChange={(_e, value) => setActiveTab(value)}
        variant="scrollable"
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
        {GENE_EVIDENCE_TABS.map((tab) => (
          <Tab key={tab} value={tab} label={tab} />
        ))}
      </Tabs>
      {tabContent(activeTab, geneName)}
    </Box>
  );
};

export default GeneEvidenceTab;
