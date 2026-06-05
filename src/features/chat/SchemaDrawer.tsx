import React, { useEffect, useState } from "react";
import {
  Box,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Divider,
  Skeleton,
  Alert,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
  Stack,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { SideSheet } from "../../components/SideSheet";
import {
  useSchema,
  type TableMeta,
  type ColumnMeta,
  type CollectionResourceSummary,
  type SchemaWarning,
} from "./schemaApi";

interface SchemaDrawerProps {
  open: boolean;
  onClose: () => void;
  selectedView: string | null;
  onSelectView: (name: string) => void;
  // clear the selection and return to the overview pane (without closing the drawer)
  onShowOverview: () => void;
}

const RAIL_WIDTH = 220;

export const SchemaDrawer = ({
  open,
  onClose,
  selectedView,
  onSelectView,
  onShowOverview,
}: SchemaDrawerProps) => {
  const { data, isPending, isError, error, refetch } = useSchema();
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down("sm"));

  const selectedTable = data?.tables.find((t) => t.name === selectedView) ?? null;

  // xs uses single-pane master/detail; this tracks whether the detail pane is showing.
  // separate from selectedView so "back" can return to the rail without clearing the parent's
  // selection (and without touching the URL hash).
  const [xsShowDetail, setXsShowDetail] = useState(false);

  // sync xs view to external selection changes (deep link, list click, drawer reopen)
  useEffect(() => {
    if (!open) {
      setXsShowDetail(false);
      return;
    }
    if (selectedView) setXsShowDetail(true);
  }, [open, selectedView]);

  // detail pane holds either a table's detail or the overview; on xs it's one pane at a time
  const xsDetailVisible = isXs && xsShowDetail;
  const railVisible = !isXs || !xsDetailVisible;
  const detailVisible = !isXs || xsDetailVisible;

  const handleSelect = (name: string) => {
    onSelectView(name);
    if (isXs) setXsShowDetail(true);
  };

  const handleShowOverview = () => {
    onShowOverview();
    if (isXs) setXsShowDetail(true);
  };

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      disableContentPadding
      title={
        !xsDetailVisible ? "Database tables" : selectedTable ? selectedTable.name : "Schema overview"
      }
      headerLeading={
        xsDetailVisible && (
          <IconButton onClick={() => setXsShowDetail(false)} size="small" aria-label="back to list">
            <ArrowBackIcon />
          </IconButton>
        )
      }
    >
      {isPending && <LoadingState />}

      {isError && (
        <Box sx={{ p: 3 }}>
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => refetch()}>
                Retry
              </Button>
            }
          >
            Failed to load schema: {error?.message ?? "unknown error"}
          </Alert>
        </Box>
      )}

      {!isPending && !isError && data && data.tables.length === 0 && (
        <Box sx={{ p: 3 }}>
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => refetch()}>
                Retry
              </Button>
            }
          >
            No tables could be loaded from the database. The database service is reachable but
            its schema queries are failing — check credentials and PROJECT_ID/DATASET_ID on
            the genetics-results-db service.
          </Alert>
          {data.warnings && data.warnings.length > 0 && (
            <SchemaWarnings warnings={data.warnings} sx={{ mt: 2 }} />
          )}
        </Box>
      )}

      {!isPending && !isError && data && data.tables.length > 0 && (
        <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
          <Box
            sx={{
              width: { xs: "100%", sm: RAIL_WIDTH },
              flexShrink: 0,
              borderRight: { xs: 0, sm: 1 },
              borderColor: "divider",
              overflowY: "auto",
              display: railVisible ? "block" : "none",
            }}
          >
            {data.warnings && data.warnings.length > 0 && (
              <SchemaWarnings warnings={data.warnings} sx={{ m: 1 }} />
            )}
            <List dense disablePadding>
              <ListItem disablePadding>
                <ListItemButton selected={!selectedTable} onClick={handleShowOverview}>
                  <ListItemText
                    primary="Overview"
                    primaryTypographyProps={{ sx: { fontSize: "0.85rem" } }}
                  />
                </ListItemButton>
              </ListItem>
              <Divider component="li" />
              {data.tables.map((table) => (
                <ListItem key={table.name} disablePadding>
                  <ListItemButton
                    selected={selectedView === table.name}
                    onClick={() => handleSelect(table.name)}
                  >
                    <ListItemText
                      primary={table.name}
                      secondary={`${table.row_count.toLocaleString()} rows`}
                      primaryTypographyProps={{
                        sx: { fontFamily: "monospace", fontSize: "0.85rem" },
                      }}
                      secondaryTypographyProps={{ sx: { fontSize: "0.75rem" } }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Box>

          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              overflowY: "auto",
              p: 2,
              display: detailVisible ? "block" : "none",
            }}
          >
            {selectedTable ? (
              <TableDetail table={selectedTable} />
            ) : (
              <SchemaOverview tableCount={data.tables.length} />
            )}
          </Box>
        </Box>
      )}
    </SideSheet>
  );
};

const SchemaWarnings = ({
  warnings,
  sx,
}: {
  warnings: SchemaWarning[];
  sx?: React.ComponentProps<typeof Alert>["sx"];
}) => (
  <Alert severity="warning" sx={sx}>
    <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
      {warnings.length === 1 ? "1 table failed to load:" : `${warnings.length} tables failed to load:`}
    </Typography>
    {warnings.map((w) => (
      <Typography
        key={w.view}
        variant="caption"
        sx={{ display: "block", fontFamily: "monospace", whiteSpace: "pre-wrap" }}
      >
        {w.view}: {w.error}
      </Typography>
    ))}
  </Alert>
);

const LoadingState = () => (
  <Box sx={{ p: 2 }}>
    <Skeleton variant="text" width="40%" />
    <Skeleton variant="rectangular" height={32} sx={{ my: 1 }} />
    <Skeleton variant="rectangular" height={32} sx={{ my: 1 }} />
    <Skeleton variant="rectangular" height={32} sx={{ my: 1 }} />
    <Skeleton variant="rectangular" height={200} sx={{ mt: 2 }} />
  </Box>
);

const SchemaOverview = ({ tableCount }: { tableCount: number }) => (
  <Box sx={{ maxWidth: 560 }}>
    <Typography variant="h6" gutterBottom>
      About these tables
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
      Here you can browse the {tableCount} tables FinnGenie can read from the database.
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
      For questions about a specific gene, variant, or phenotype, FinnGenie usually uses its
      built-in tools. It queries these tables directly when a question needs aggregating or
      comparing data across the whole dataset — for example counts, summaries, or cross-dataset
      comparisons that the other tools can't express.
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
      Either way, browsing here lets you double-check what data FinnGenie has access to and
      understand exactly what each field means.
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
      Select a table on the left to see:
    </Typography>
    <Box component="ul" sx={{ m: 0, mb: 1.5, pl: 3 }}>
      <Typography component="li" variant="body2" color="text.secondary">
        its columns, with types and descriptions
      </Typography>
      <Typography component="li" variant="body2" color="text.secondary">
        the allowed values for categorical fields
      </Typography>
      <Typography component="li" variant="body2" color="text.secondary">
        example SQL queries you can ask FinnGenie to run or adapt
      </Typography>
    </Box>
  </Box>
);

const TableDetail = ({ table }: { table: TableMeta }) => (
  <Box>
    <Typography variant="h6" sx={{ fontFamily: "monospace" }}>
      {table.name}
    </Typography>
    <Typography variant="caption" color="text.secondary">
      {table.row_count.toLocaleString()} rows
    </Typography>
    {table.description && (
      <Typography variant="body2" sx={{ mt: 1, whiteSpace: "pre-line" }}>
        {table.description}
      </Typography>
    )}

    {table.collection_resources && Object.keys(table.collection_resources).length > 0 && (
      <Box sx={{ mt: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Collection resources
        </Typography>
        <Stack spacing={1}>
          {Object.entries(table.collection_resources).map(([label, summary]) => (
            <CollectionResourceCard key={label} label={label} summary={summary} />
          ))}
        </Stack>
      </Box>
    )}

    <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
      Columns ({table.columns.length})
    </Typography>
    <TableContainer sx={{ overflowX: "auto" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 200 }}>Name</TableCell>
            <TableCell sx={{ width: 80 }}>Type</TableCell>
            <TableCell sx={{ width: 90 }}>Mode</TableCell>
            <TableCell>Description</TableCell>
            <TableCell>Allowed values</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {table.columns.map((col) => (
            <ColumnRow key={col.name} column={col} />
          ))}
        </TableBody>
      </Table>
    </TableContainer>

    {table.examples && table.examples.length > 0 && (
      <Box sx={{ mt: 3 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Example queries
        </Typography>
        <Stack spacing={1}>
          {table.examples.map((example, idx) => (
            <ExampleAccordion
              key={`${example.description}-${idx}`}
              description={example.description}
              sql={example.sql}
            />
          ))}
        </Stack>
      </Box>
    )}
  </Box>
);

const ColumnRow = ({ column }: { column: ColumnMeta }) => {
  // surface allowed_values_by_<dep> keys (e.g. allowed_values_by_resource)
  const byKeys = Object.keys(column).filter((k) => k.startsWith("allowed_values_by_")) as Array<
    `allowed_values_by_${string}`
  >;

  return (
    <TableRow sx={{ "& td": { verticalAlign: "top" } }}>
      <TableCell sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{column.name}</TableCell>
      <TableCell>
        <Typography variant="caption">{column.type}</Typography>
      </TableCell>
      <TableCell>
        <Typography variant="caption" color="text.secondary">
          {column.mode}
        </Typography>
      </TableCell>
      <TableCell>
        <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
          {column.description ?? "—"}
        </Typography>
      </TableCell>
      <TableCell>
        {column.allowed_values && column.allowed_values.length > 0 ? (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {column.allowed_values.map((v) => (
              <Chip key={v} label={v} size="small" variant="outlined" />
            ))}
          </Box>
        ) : byKeys.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            —
          </Typography>
        ) : null}

        {byKeys.map((bk) => {
          const groups = column[bk];
          if (!groups) return null;
          const dep = bk.replace(/^allowed_values_by_/, "");
          return (
            <Box key={bk} sx={{ mt: column.allowed_values?.length ? 1 : 0 }}>
              <Typography variant="caption" color="text.secondary">
                Allowed values by <code>{dep}</code>:
              </Typography>
              <DependentAllowedValues groups={groups} />
            </Box>
          );
        })}
      </TableCell>
    </TableRow>
  );
};

const DependentAllowedValues = ({
  groups,
}: {
  groups: Record<string, string[] | string>;
}) => (
  <Box sx={{ mt: 0.5 }}>
    {Object.entries(groups).map(([groupName, values]) => (
      <Box key={groupName} sx={{ mb: 0.75 }}>
        <Typography variant="caption" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
          {groupName}
        </Typography>
        {Array.isArray(values) ? (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.25 }}>
            {values.map((v) => (
              <Chip key={v} label={v} size="small" variant="outlined" />
            ))}
          </Box>
        ) : (
          // api collapses large enums (e.g. eqtl catalogue) to a summary string
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {values}
          </Typography>
        )}
      </Box>
    ))}
  </Box>
);

const CollectionResourceCard = ({
  label,
  summary,
}: {
  label: string;
  summary: CollectionResourceSummary;
}) => (
  <Box
    sx={{
      border: 1,
      borderColor: "divider",
      borderRadius: 1,
      p: 1,
    }}
  >
    <Typography variant="body2" sx={{ fontWeight: 600 }}>
      {label}
    </Typography>
    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
      {summary.description}
    </Typography>
    <Stack direction="row" spacing={2} sx={{ mt: 0.5, flexWrap: "wrap" }}>
      <Typography variant="caption">
        <strong>{summary.count.toLocaleString()}</strong> entries
      </Typography>
      <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
        {summary.pattern}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {summary.data_types}
      </Typography>
    </Stack>
  </Box>
);

const ExampleAccordion = ({ description, sql }: { description: string; sql: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors silently
    }
  };

  return (
    <Accordion disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="body2">{description}</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <Box
          sx={{
            position: "relative",
            backgroundColor: (theme) => (theme.palette.mode === "dark" ? "grey.900" : "grey.100"),
            borderRadius: 1,
            p: 1.5,
            pr: 5,
          }}
        >
          <Tooltip title={copied ? "Copied" : "Copy SQL"}>
            <IconButton
              size="small"
              onClick={handleCopy}
              sx={{ position: "absolute", top: 4, right: 4 }}
              aria-label="copy sql"
            >
              {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Box
            component="pre"
            sx={{
              m: 0,
              fontFamily: "monospace",
              fontSize: "0.8rem",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {sql}
          </Box>
        </Box>
      </AccordionDetails>
    </Accordion>
  );
};
