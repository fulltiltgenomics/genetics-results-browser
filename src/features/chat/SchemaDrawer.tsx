import { useState } from "react";
import {
  Drawer,
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
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import { useSchema, type TableMeta, type ColumnMeta, type CollectionResourceSummary } from "./schemaApi";

interface SchemaDrawerProps {
  open: boolean;
  onClose: () => void;
  selectedView: string | null;
  onSelectView: (name: string) => void;
}

const DRAWER_WIDTH = 720;
const RAIL_WIDTH = 220;

export const SchemaDrawer = ({ open, onClose, selectedView, onSelectView }: SchemaDrawerProps) => {
  const { data, isPending, isError, error, refetch } = useSchema();

  const selectedTable = data?.tables.find((t) => t.name === selectedView) ?? null;

  return (
    <Drawer
      anchor="right"
      variant="temporary"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: DRAWER_WIDTH }, maxWidth: "100vw" } }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 2, py: 1.5 }}>
        <Typography variant="h6">Tables & columns</Typography>
        <IconButton onClick={onClose} size="small" aria-label="close">
          <CloseIcon />
        </IconButton>
      </Box>
      <Divider />

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

      {!isPending && !isError && data && (
        <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
          <Box
            sx={{
              width: RAIL_WIDTH,
              flexShrink: 0,
              borderRight: 1,
              borderColor: "divider",
              overflowY: "auto",
            }}
          >
            <List dense disablePadding>
              {data.tables.map((table) => (
                <ListItem key={table.name} disablePadding>
                  <ListItemButton
                    selected={selectedView === table.name}
                    onClick={() => onSelectView(table.name)}
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

          <Box sx={{ flex: 1, minWidth: 0, overflowY: "auto", p: 2 }}>
            {selectedTable ? (
              <TableDetail table={selectedTable} />
            ) : (
              <Typography variant="body2" color="text.secondary">
                Select a table from the list to see its columns and example queries.
              </Typography>
            )}
          </Box>
        </Box>
      )}
    </Drawer>
  );
};

const LoadingState = () => (
  <Box sx={{ p: 2 }}>
    <Skeleton variant="text" width="40%" />
    <Skeleton variant="rectangular" height={32} sx={{ my: 1 }} />
    <Skeleton variant="rectangular" height={32} sx={{ my: 1 }} />
    <Skeleton variant="rectangular" height={32} sx={{ my: 1 }} />
    <Skeleton variant="rectangular" height={200} sx={{ mt: 2 }} />
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
