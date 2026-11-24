import { useMemo, useState } from "react";
import {
  Box,
  Link,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { MaterialReactTable, MRT_ColumnDef } from "material-react-table";
import {
  CellTypeExpressionNotConfigured,
  useCellTypeExpressionSummary,
  useGeneDisease,
  useGeneExpression,
  useGeneInfo,
  useGtexExpression,
} from "@/store/serverQuery";
import {
  EXPRESSION_TABS,
  ExpressionTabName,
  GENE_EVIDENCE_TABS,
  GeneEvidenceTabName,
  useGeneEvidenceStore,
} from "@/store/store.geneEvidence";
import { GeneDiseaseRow, GeneExpressionRow } from "@/types/types.normalized";
import { datasetDisplayName } from "../table/utils/tableutil";
import CellTypeExpressionSection from "./CellTypeExpressionSection";
import GeneAnnotationSection from "./GeneAnnotationSection";
import GeneAssociationSection from "./GeneAssociationSection";
import GeneBurdenSection from "./GeneBurdenSection";
import { COMING_SOON, tabLabel } from "./geneEvidenceTabs";
import GeneSummarySection from "./GeneSummarySection";
import GtexViolinPlot from "./GtexViolinPlot";
import { gtexTissueLabel } from "./gtexTissues";
import { TissueStats, tissueStats } from "./gtexViolin";
import { hpaLevelLabel, hpaLevelRank, hpaTissueLabel } from "./hpa";
import { DownloadButton, toolbarSx } from "../table/ExportToolbar";
import { exportGtexExpression, exportHpaExpression } from "./geneEvidenceExport";
import {
  countCell,
  evidenceTableProps as tableProps,
  numCell,
  Section,
  sortedRows,
} from "./evidenceTable";

/**
 * Gene evidence (refactor.md §6): gene-level evidence, one kind per tab. A tab mounts, and so
 * fetches, only when it is opened, and one failing/empty source never blocks the others.
 */

const EXPRESSION_TAB_LABELS: Record<ExpressionTabName, string> = {
  gtex: "GTEx",
  cellxgene: "CELLxGENE",
  hpa: "Human Protein Atlas",
};

const SourceLink = ({ href, children }: { href: string; children: string }) => (
  <Link
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    variant="body2"
    sx={{ display: "block", width: "fit-content", mb: 1 }}>
    {children}
  </Link>
);

type GtexTissueRow = TissueStats & { label: string };

const gtexColumns: MRT_ColumnDef<GtexTissueRow>[] = [
  { accessorKey: "label", header: "tissue", id: "label", size: 260 },
  { accessorKey: "n", header: "samples", id: "n", size: 100, Cell: countCell },
  {
    accessorKey: "median",
    header: "median TPM",
    id: "median",
    sortDescFirst: true,
    size: 120,
    Cell: numCell(4),
  },
  { accessorKey: "q1", header: "lower quartile", id: "q1", size: 120, Cell: numCell(4) },
  { accessorKey: "q3", header: "upper quartile", id: "q3", size: 120, Cell: numCell(4) },
];

/**
 * GTEx, plot and table both from the samples the GTEx portal serves through the BFF, so the two
 * are of one release: the one the response names.
 */
const GtexEvidence = ({ geneName }: { geneName: string }) => {
  const info = useGeneInfo(geneName);
  const ensemblId = info.data?.ensemblId;
  const samples = useGtexExpression(ensemblId);
  const [view, setView] = useState<"plot" | "table">("plot");

  const rows = useMemo<GtexTissueRow[]>(
    () =>
      (samples.data?.tissues ?? []).flatMap((t) => {
        const stats = tissueStats(t.tissue, t.values);
        return stats ? [{ ...stats, label: gtexTissueLabel(t.tissue.toLowerCase()) }] : [];
      }),
    [samples.data]
  );

  return (
    <Section
      title={`Expression by tissue: GTEx${samples.data ? ` ${samples.data.release}` : ""}`}
      isPending={info.isPending || (!!ensemblId && samples.isPending)}
      isError={info.isError || samples.isError}
      error={info.error ?? samples.error}
      isEmpty={!samples.data}
      emptyText="no GTEx expression data for this gene">
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={view}
          onChange={(_e, value) => {
            // exclusive group emits null when the active button is re-clicked; ignore that.
            if (value) setView(value);
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
          disabled={rows.length === 0}
          onClick={() => samples.data && exportGtexExpression(geneName, samples.data)}
        />
      </Box>
      {ensemblId && (
        <SourceLink href={`https://gtexportal.org/home/gene/${ensemblId}`}>
          {`${geneName} on the GTEx Portal`}
        </SourceLink>
      )}
      {samples.data &&
        (view === "plot" ? (
          <GtexViolinPlot expression={samples.data} />
        ) : (
          <MaterialReactTable
            {...tableProps}
            data={rows}
            columns={gtexColumns}
            enablePagination={rows.length > 20}
            initialState={{ density: "compact", sorting: [{ id: "median", desc: true }] }}
          />
        ))}
    </Section>
  );
};

// immunohistochemistry staining, so the level is a category and is shown as served
const hpaColumns: MRT_ColumnDef<GeneExpressionRow>[] = [
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
  {
    accessorKey: "dataset",
    header: "dataset",
    id: "dataset",
    size: 120,
    Cell: ({ cell }) => datasetDisplayName(cell.getValue<string>()),
  },
];

const ExpressionEvidence = ({ geneName }: { geneName: string }) => {
  const expression = useGeneExpression(geneName);
  const ensemblId = useGeneInfo(geneName).data?.ensemblId;
  // the same query the CELLxGENE section runs: a deployment without that data gets no tab for it
  const cellTypes = useCellTypeExpressionSummary(geneName);
  const offered = EXPRESSION_TABS.filter(
    (tab) => tab !== "cellxgene" || !(cellTypes.error instanceof CellTypeExpressionNotConfigured)
  );
  const hpaRows = useMemo(
    () => (expression.data ?? []).filter((r) => r.resource === "hpa"),
    [expression.data]
  );
  // known to have nothing: the tab stays, and says so, rather than opening on an empty table
  const noHpa = expression.isSuccess && hpaRows.length === 0;
  const storedTab = useGeneEvidenceStore((s) => s.expressionTab);
  const setTab = useGeneEvidenceStore((s) => s.setExpressionTab);
  const tab =
    offered.includes(storedTab) && !(storedTab === "hpa" && noHpa) ? storedTab : offered[0];

  return (
    <>
      <Tabs
        value={tab}
        onChange={(_e, value) => {
          if (!(value === "hpa" && noHpa)) setTab(value);
        }}
        aria-label="expression source"
        sx={{ mb: 2, minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0.5 } }}>
        {offered.map((name) =>
          name === "hpa" && noHpa ? (
            // not the disabled prop: a disabled button takes no pointer, so it could show no tooltip
            <Tab
              key={name}
              value={name}
              aria-disabled
              disableRipple
              sx={{ cursor: "default", color: "text.disabled" }}
              label={
                <Tooltip
                  title={`No Human Protein Atlas protein level data for ${geneName}`}
                  describeChild>
                  <span>{EXPRESSION_TAB_LABELS[name]}</span>
                </Tooltip>
              }
            />
          ) : (
            <Tab key={name} value={name} label={EXPRESSION_TAB_LABELS[name]} />
          )
        )}
      </Tabs>
      {tab === "gtex" && <GtexEvidence geneName={geneName} />}
      {tab === "cellxgene" && <CellTypeExpressionSection geneName={geneName} />}
      {tab === "hpa" && (
        <Section
          title="Protein levels by tissue (IHC staining): Human Protein Atlas"
          isPending={expression.isPending}
          isError={expression.isError}
          error={expression.error}
          isEmpty={hpaRows.length === 0}
          emptyText={`no Human Protein Atlas protein level data for ${geneName}`}>
          {ensemblId && (
            <SourceLink href={`https://www.proteinatlas.org/${ensemblId}/tissue`}>
              {`${geneName} in the Human Protein Atlas`}
            </SourceLink>
          )}
          <MaterialReactTable
            {...tableProps}
            data={hpaRows}
            columns={hpaColumns}
            enablePagination={hpaRows.length > 20}
            initialState={{ density: "compact", sorting: [{ id: "levelRaw", desc: true }] }}
            renderTopToolbarCustomActions={({ table }) => (
              <Box sx={toolbarSx}>
                <DownloadButton
                  label="DOWNLOAD HPA PROTEIN LEVELS"
                  disabled={hpaRows.length === 0}
                  onClick={() => exportHpaExpression(geneName, sortedRows(table))}
                />
              </Box>
            )}
          />
        </Section>
      )}
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
    case "ai summary":
      return <GeneSummarySection geneName={geneName} />;
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
      <Tabs
        value={activeTab}
        onChange={(_e, value) => {
          if (!COMING_SOON.has(value)) setActiveTab(value);
        }}
        variant="scrollable"
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
        {GENE_EVIDENCE_TABS.map((tab) =>
          COMING_SOON.has(tab) ? (
            // not the disabled prop: a disabled button takes no pointer, so it could show no tooltip
            <Tab
              key={tab}
              value={tab}
              aria-disabled
              disableRipple
              sx={{ cursor: "default", color: "text.disabled" }}
              label={
                <Tooltip title="coming soon" describeChild>
                  <span>{tabLabel(tab)}</span>
                </Tooltip>
              }
            />
          ) : (
            <Tab key={tab} value={tab} label={tabLabel(tab)} />
          )
        )}
      </Tabs>
      {tabContent(activeTab, geneName)}
    </Box>
  );
};

export default GeneEvidenceTab;
