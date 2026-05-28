import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Chip,
  Box,
  CircularProgress,
  Tooltip,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import axios from "axios";

interface Dataset {
  dataset_id: string;
  resource: string;
  version: string;
  description: string;
  author: string;
  publication_date: string;
  trait_type: string | null;
  data_type: string;
  products: Record<string, unknown>;
  pseudo_credible_sets?: boolean;
  qtl_types?: string[];
  n_samples?: number;
  n_phenotypes?: number;
  stats?: {
    n_phenotypes?: number;
    n_subdatasets?: number;
    n_samples_median?: number;
    n_samples_range?: number[];
    n_cases_range?: number[];
    n_controls_range?: number[];
  };
  collection?: boolean;
}

interface DatasetsDialogProps {
  open: boolean;
  onClose: () => void;
}

type Category = {
  label: string;
  filter: (d: Dataset) => boolean;
};

const categories: Category[] = [
  {
    label: "GWAS credible sets",
    filter: (d) => {
      if (d.data_type !== "gwas") return false;
      const keys = Object.keys(d.products || {});
      return !(keys.length === 1 && keys[0] === "colocalization");
    },
  },
  {
    label: "Exome variant associations",
    filter: (d) => d.data_type === "exome",
  },
  {
    label: "Gene burden results",
    filter: (d) => d.data_type === "gene_based",
  },
  {
    label: "QTL credible sets (eQTL / pQTL / caQTL / sQTL)",
    filter: (d) =>
      ["eqtl", "pqtl", "caqtl", "sqtl", "metaboqtl", "mixed"].includes(d.data_type) &&
      d.products?.credible_sets !== undefined,
  },
  {
    label: "Colocalization-only",
    filter: (d) => {
      const keys = Object.keys(d.products || {});
      return keys.length === 1 && keys[0] === "colocalization";
    },
  },
  {
    label: "Expression",
    filter: (d) => d.data_type === "expression",
  },
  {
    label: "Gene-disease",
    filter: (d) => d.data_type === "gene_disease",
  },
  {
    label: "Chromatin peaks",
    filter: (d) => d.data_type === "chromatin_peaks",
  },
];

const hasSumstats = (d: Dataset) => (d.products as Record<string, unknown>)?.summary_stats === true;
const hasCredibleSets = (d: Dataset) => (d.products as Record<string, unknown>)?.credible_sets === true;
const hasPseudoCredibleSets = (d: Dataset) => d.pseudo_credible_sets === true;

const formatRange = (range?: number[]) => {
  if (!range || range.length < 2) return "—";
  return `${range[0].toLocaleString()}–${range[1].toLocaleString()}`;
};

const CheckMark = () => <CheckCircleIcon sx={{ fontSize: 16, color: "success.main" }} />;

export const DatasetsDialog = ({ open, onClose }: DatasetsDialogProps) => {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down("sm"));
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    axios
      .get("/api/v1/datasets")
      .then((r) => setDatasets(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open]);

  const categorized = categories.map((cat) => ({
    ...cat,
    datasets: datasets.filter(cat.filter),
  }));

  // insert uncategorized datasets (asmQTL sumstats) right after the QTL credible sets table
  const shown = new Set(categorized.flatMap((c) => c.datasets.map((d) => d.dataset_id)));
  const uncategorized = datasets.filter((d) => !shown.has(d.dataset_id));
  if (uncategorized.length > 0) {
    const qtlIdx = categorized.findIndex((c) =>
      c.label.startsWith("QTL credible sets")
    );
    const insertAt = qtlIdx >= 0 ? qtlIdx + 1 : categorized.length;
    categorized.splice(insertAt, 0, {
      label: "asmQTL sumstats",
      datasets: uncategorized,
      filter: () => false,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth fullScreen={isXs}>
      <DialogTitle>Currently available datasets</DialogTitle>
      <DialogContent dividers>
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        )}
        {error && (
          <Typography color="error">Failed to load datasets: {error}</Typography>
        )}
        {!loading && !error && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Hover over dataset names to see more information about each dataset.
          </Typography>
        )}
        {!loading &&
          !error &&
          categorized
            .filter((c) => c.datasets.length > 0)
            .map((cat) => (
              <Box key={cat.label} sx={{ mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  {cat.label}
                </Typography>
                <DatasetTable datasets={cat.datasets} category={cat.label} />
              </Box>
            ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

const DatasetTable = ({ datasets, category }: { datasets: Dataset[]; category: string }) => {
  const showCredibleSets =
    category === "GWAS credible sets" ||
    category === "QTL credible sets (eQTL / pQTL / caQTL / sQTL)";
  const showQtlTypes =
    category !== "Colocalization-only" && datasets.some((d) => d.qtl_types);
  const showSumstats = [
    "GWAS credible sets",
    "QTL credible sets (eQTL / pQTL / caQTL / sQTL)",
    "asmQTL sumstats",
  ].includes(category);
  const showColoc = datasets.some((d) => (d.products as Record<string, unknown>)?.colocalization);
  const showStats =
    category !== "QTL credible sets (eQTL / pQTL / caQTL / sQTL)" &&
    datasets.some(
      (d) => d.stats?.n_phenotypes || d.stats?.n_subdatasets || d.n_phenotypes != null
    );
  const showSampleSize =
    category === "Gene-disease" ||
    datasets.some((d) => d.n_samples != null || d.stats?.n_samples_range != null);
  const showColocType = category === "Colocalization-only";
  const hasPseudo = showCredibleSets && datasets.some(hasPseudoCredibleSets);

  return (
    <>
    {category === "Colocalization-only" && (
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        These datasets appear in colocalization data but their association results themselves are not currently available.
      </Typography>
    )}
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 260 }}>Dataset</TableCell>
            <TableCell sx={{ width: 180 }}>Resource</TableCell>
            <TableCell sx={{ width: 100 }}>Version</TableCell>
            {showColocType && <TableCell>Type</TableCell>}
            {showQtlTypes && <TableCell>QTL types</TableCell>}
            {showStats && <TableCell align="right">Phenotypes</TableCell>}
            {showSampleSize && <TableCell align="right">Sample size</TableCell>}
            {showCredibleSets && <TableCell align="center">Credible sets</TableCell>}
            {showSumstats && <TableCell align="center">Sumstats</TableCell>}
            {showColoc && <TableCell align="center">Coloc</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {datasets.map((d) => (
            <TableRow key={d.dataset_id} hover>
              <TableCell>
                <Tooltip title={d.description} arrow slotProps={{ tooltip: { sx: { fontSize: "0.875rem", maxWidth: 500 } } }}>
                  <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.8rem", cursor: "help" }}>
                    {d.dataset_id}
                  </Typography>
                </Tooltip>
              </TableCell>
              <TableCell>{d.resource}</TableCell>
              <TableCell>{d.version || "—"}</TableCell>
              {showColocType && (
                <TableCell>
                  {d.data_type === "gwas" ? "GWAS" : d.qtl_types?.join(", ") ?? "QTL"}
                </TableCell>
              )}
              {showQtlTypes && (
                <TableCell>{d.qtl_types?.join(", ") ?? "—"}</TableCell>
              )}
              {showStats && (
                <TableCell align="right">
                  {d.stats?.n_phenotypes?.toLocaleString() ??
                    d.stats?.n_subdatasets?.toLocaleString() ??
                    d.n_phenotypes?.toLocaleString() ??
                    "—"}
                </TableCell>
              )}
              {showSampleSize && (
                <TableCell align="right">
                  {(() => {
                    const display =
                      d.n_samples != null
                        ? d.n_samples
                        : d.stats?.n_samples_range?.[1] ?? null;
                    if (display == null) return "—";
                    if (d.stats?.n_samples_range) {
                      return (
                        <Tooltip
                          title={`${d.collection ? "Per-study" : "Per-phenotype"} range: ${formatRange(d.stats.n_samples_range)}`}
                          arrow
                          slotProps={{ tooltip: { sx: { fontSize: "0.875rem" } } }}
                        >
                          <span style={{ cursor: "help" }}>{display.toLocaleString()}</span>
                        </Tooltip>
                      );
                    }
                    return display.toLocaleString();
                  })()}
                </TableCell>
              )}
              {showCredibleSets && (
                <TableCell align="center">
                  {hasCredibleSets(d) ? (
                    <>{<CheckMark />}{hasPseudoCredibleSets(d) && " *"}</>
                  ) : "—"}
                </TableCell>
              )}
              {showSumstats && (
                <TableCell align="center">{hasSumstats(d) ? <CheckMark /> : "—"}</TableCell>
              )}
              {showColoc && (
                <TableCell align="center">
                  {(d.products as Record<string, unknown>)?.colocalization ? (() => {
                    const partners = (d.products as { colocalization?: { partners?: string[] } })
                      ?.colocalization?.partners ?? [];
                    return (
                      <Tooltip
                        title={partners.join("\n")}
                        arrow
                        slotProps={{ tooltip: { sx: { fontSize: "0.875rem", maxWidth: 400, whiteSpace: "pre-line" } } }}
                      >
                        <Chip
                          size="small"
                          label={partners.length + " partners"}
                          variant="outlined"
                          sx={{ cursor: "help" }}
                        />
                      </Tooltip>
                    );
                  })() : (
                    "—"
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
    {hasPseudo && (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        * Pseudo credible sets: no formal fine-mapping, approximate credible sets derived from meta-analysis based on LD.
      </Typography>
    )}
    </>
  );
};
