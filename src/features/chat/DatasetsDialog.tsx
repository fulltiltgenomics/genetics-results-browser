import { useEffect, useState } from "react";
import {
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
  Link,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import axios from "axios";
import { SideSheet } from "../../components/SideSheet";

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
    label: "QTL datasets (eQTL / pQTL / caQTL / sQTL)",
    filter: (d) =>
      ["eqtl", "pqtl", "caqtl", "sqtl", "metaboqtl", "mixed"].includes(d.data_type) &&
      (d.products?.credible_sets !== undefined || d.products?.summary_stats !== undefined),
  },
  {
    label: "asmQTL sumstats",
    filter: (d) => d.data_type === "asmqtl",
  },
  {
    label: "Classical HLA allele associations",
    filter: (d) => d.data_type === "hla",
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
  {
    label: "Open chromatin",
    filter: (d) => d.data_type === "open_chromatin",
  },
];

// Public resources the assistant queries live during a conversation, as opposed to the
// datasets below which we ingest and serve ourselves. Keep in sync with the external
// tools in genetics-mcp-server (docs/project-spec.md) — both the natively-called APIs
// and the proxied external MCP servers.
const externalResources: { name: string; url: string; description: string }[] = [
  {
    name: "gnomAD",
    url: "https://gnomad.broadinstitute.org",
    description:
      "How common each variant is in large reference populations, plus which genes appear intolerant to damaging variation.",
  },
  {
    name: "Open Targets Platform",
    url: "https://platform.opentargets.org",
    description:
      "Evidence linking genes to diseases and to drugs that target them, aggregated across many sources.",
  },
  {
    name: "MGI (Mouse Genome Informatics)",
    url: "https://www.informatics.jax.org",
    description:
      "Curated phenotypes of mice in which a gene has been knocked out or altered, and which mouse gene corresponds to which human gene.",
  },
  {
    name: "cBioPortal",
    url: "https://www.cbioportal.org",
    description:
      "Which genes are recurrently mutated in which cancers, across hundreds of tumour sequencing studies. These are somatic changes acquired by tumours, not inherited variants.",
  },
  {
    name: "UniProt",
    url: "https://www.uniprot.org",
    description:
      "What the protein a gene encodes actually does, and which parts of it matter: domains, active sites and disease-linked residues.",
  },
  {
    name: "ChEMBL",
    url: "https://www.ebi.ac.uk/chembl",
    description:
      "Which drugs and clinical candidates act on the protein a gene encodes, what they do to it, how far each got in the clinic, what it is used for, and how much medicinal chemistry exists against the target.",
  },
  {
    name: "myvariant.info",
    url: "https://myvariant.info",
    description:
      "Per-variant clinical and computational annotation gathered from ClinVar, CADD, SIFT, PolyPhen-2, COSMIC, dbSNP etc.",
  },
  {
    name: "Perplexity",
    url: "https://www.perplexity.ai",
    description:
      "AI search across a broad set of scientific web domains, returning a summary with citations.",
  },
  {
    name: "Europe PMC",
    url: "https://europepmc.org",
    description:
      "Biomedical literature, including preprints, so answers can cite published work. The alternative literature backend to Perplexity.",
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

  // surface any dataset not matched by a category above under "Other" so nothing
  // silently disappears from the dialog (normally empty once products are correct).
  const shown = new Set(categorized.flatMap((c) => c.datasets.map((d) => d.dataset_id)));
  const uncategorized = datasets.filter((d) => !shown.has(d.dataset_id));
  if (uncategorized.length > 0) {
    categorized.push({
      label: "Other",
      datasets: uncategorized,
      filter: () => false,
    });
  }

  return (
    <SideSheet open={open} onClose={onClose} title="Currently available datasets">
        {/* static prose: rendered while the dataset list is still loading */}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
          These datasets are results from large human genetics studies, spanning genome-wide
          association results for thousands of diseases and quantitative traits, rare-variant and
          gene-level burden results from exome sequencing, and QTL studies linking variants to gene
          expression, protein levels, splicing and chromatin activity across many tissues and cell
          types. Alongside them sit colocalization results, expression atlases, curated
          gene-disease relationships and regulatory annotation, so a variant or gene can be
          followed from a disease association through to the molecular mechanism that may underlie
          it.
        </Typography>

        <Box
          sx={{
            mb: 3,
            p: 2,
            borderRadius: 1,
            border: 1,
            borderColor: "divider",
            bgcolor: "action.hover",
          }}
        >
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Live external resources
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Alongside the datasets listed below, which we host ourselves, the assistant can query
            these public resources live while answering. Their content always reflects the
            resource as it stands today and is not stored here.
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 200 }}>Resource</TableCell>
                  <TableCell>Description</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {externalResources.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell>
                      <Link href={r.url} target="_blank" rel="noreferrer">
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell sx={{ color: "text.secondary" }}>{r.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            The assistant can also run general web searches via DuckDuckGo when a question is not
            covered by any of the above.
          </Typography>
        </Box>

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
    </SideSheet>
  );
};

const DatasetTable = ({ datasets, category }: { datasets: Dataset[]; category: string }) => {
  const showCredibleSets =
    category === "GWAS credible sets" ||
    category === "QTL datasets (eQTL / pQTL / caQTL / sQTL)";
  const showQtlTypes =
    category !== "Colocalization-only" && datasets.some((d) => d.qtl_types);
  const showSumstats = [
    "GWAS credible sets",
    "QTL datasets (eQTL / pQTL / caQTL / sQTL)",
    "asmQTL sumstats",
  ].includes(category);
  const showColoc = datasets.some((d) => (d.products as Record<string, unknown>)?.colocalization);
  const showStats =
    category !== "QTL datasets (eQTL / pQTL / caQTL / sQTL)" &&
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
                          label={partners.length + (partners.length === 1 ? " partner" : " partners")}
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
