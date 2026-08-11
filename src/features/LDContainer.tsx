import {
  Box,
  Button,
  TextField,
  Typography,
  useTheme,
  CircularProgress,
  Alert,
  Paper,
  Switch,
  FormControlLabel,
  Link,
} from "@mui/material";
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { MaterialReactTable, type MRT_ColumnDef } from "material-react-table";
import { variantSort, naInfSort } from "./table/utils/sorting";
import api from "../store/api";
import { isCoding, isLoF } from "../utils/coding";

interface LDResult {
  variation1: string;
  variation2: string;
  d_prime: number;
  r2: number;
}

interface LDResultWithAnnotation extends LDResult {
  [key: string]: any; // annotation fields are dynamic
}

const RSID_RE = /^rs\d+$/i;
// LD is FinnGen-panel based, so annotate against the FinnGen source
const ANNOTATION_SOURCE = "finngen";
// API's max_query_variants
const ANNOTATION_CHUNK_SIZE = 2000;

/**
 * One-line "FinnGen AF: 1.80e-1, missense, APOE" summary of a variant's annotation, used for the
 * query variant of a single-variant lookup and for both variants of a pairwise comparison.
 * Consequence and gene are dropped when the annotation doesn't have them.
 */
const formatAnnotationSummary = (annotation: any): string | null => {
  if (!annotation) {
    return null;
  }
  // the annotation parser writes the string "NA" for every missing field (an intergenic variant has
  // no gene), so drop those instead of printing them
  const present = (value: any): boolean => !!value && value !== "NA" && value !== "N/A";

  const af = typeof annotation.AF === "number" ? annotation.AF.toExponential(2) : "N/A";
  const parts = [`FinnGen AF: ${af}`];
  if (present(annotation.most_severe)) {
    parts.push(annotation.most_severe.toLowerCase().replace("_variant", "").replace(/_/g, " "));
  }
  if (present(annotation.gene_most_severe)) {
    parts.push(annotation.gene_most_severe);
  }
  return parts.join(", ");
};

const EXAMPLES = {
  // the APOE ε4-defining missense variant, as an rsid to show that rsids work as input
  single: "rs429358",
  pair: "15:90883330:G:A, 15:90885291:CT:C",
};

const LDContainer = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const [searchParams] = useSearchParams();
  const [variantInput, setVariantInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ldResults, setLdResults] = useState<LDResultWithAnnotation[] | null>(null);
  const [annotationColumns, setAnnotationColumns] = useState<string[]>([]);
  const [queryVariantAnnotation, setQueryVariantAnnotation] = useState<any>(null);
  const [showOnlyCoding, setShowOnlyCoding] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<{
    variant1: string;
    variant2: string;
    d_prime: number;
    r2: number;
    annotation1: any;
    annotation2: any;
  } | null>(null);

  const isLDPage = window.location.pathname.startsWith("/ld");

  // load from URL parameter on mount
  useEffect(() => {
    const variants = searchParams.get("variants");
    if (variants) {
      setVariantInput(variants);
      // trigger lookup after setting input
      performLookup(variants);
    }
  }, [searchParams]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setVariantInput(event.target.value);
  };

  const parseVariant = (variant: string): { chr: string; pos: number } | null => {
    // parse variants in formats like "2:9508859:G:T", "chr2-9508859-G-T", etc.
    const cleaned = variant.trim().replace(/^chr/, "");
    const parts = cleaned.split(/[:-_|\/\\]/);
    if (parts.length >= 2) {
      const chr = parts[0];
      const pos = parseInt(parts[1], 10);
      if (!isNaN(pos)) {
        return { chr, pos };
      }
    }
    return null;
  };

  // parse one TSV response from variant_annotation into (variant id -> annotation) plus its columns
  const parseAnnotationTsv = (
    tsv: string
  ): { annotations: Map<string, any>; columns: string[] } => {
    const rows = tsv.split("\n");
    if (rows.length < 2) {
      return { annotations: new Map(), columns: [] };
    }

    const columns = rows[0].split("\t").map((h) => h.replace("#", ""));
    const headerIndex = columns.reduce((acc, field, idx) => {
      acc[field] = idx;
      return acc;
    }, {} as { [key: string]: number });

    const annotations = new Map<string, any>();

    for (let i = 1; i < rows.length; i++) {
      if (rows[i].length === 0) {
        continue;
      }
      const fields = rows[i].split("\t");
      const variant = `${fields[headerIndex["chr"]]}:${fields[headerIndex["pos"]]}:${
        fields[headerIndex["ref"]]
      }:${fields[headerIndex["alt"]]}`;

      const annotation: any = {};
      columns.forEach((col, idx) => {
        let value: any = fields[idx];
        if (value === "NA" || value === undefined || value === "") {
          value = "NA";
        } else if (col.startsWith("AF")) {
          const parsed = parseFloat(value);
          value = isNaN(parsed) ? "NA" : parsed;
        }
        annotation[col] = value;
      });

      annotations.set(variant, annotation);
    }

    return { annotations, columns };
  };

  const fetchAnnotations = async (
    variants: string[]
  ): Promise<{ annotations: Map<string, any>; columns: string[] }> => {
    try {
      // the API rejects more than max_query_variants (2000) per request, and an LD window can hold
      // more than that, so split into chunks and issue them concurrently
      const chunks: string[][] = [];
      for (let i = 0; i < variants.length; i += ANNOTATION_CHUNK_SIZE) {
        chunks.push(variants.slice(i, i + ANNOTATION_CHUNK_SIZE));
      }

      const responses = await Promise.all(
        chunks.map((c) =>
          api.post<string>(`/v1/variant_annotation/${ANNOTATION_SOURCE}`, { variants: c })
        )
      );

      const annotations = new Map<string, any>();
      let columns: string[] = [];
      for (const response of responses) {
        const parsed = parseAnnotationTsv(response.data);
        if (parsed.columns.length > 0) {
          columns = parsed.columns;
        }
        parsed.annotations.forEach((value, key) => annotations.set(key, value));
      }

      return { annotations, columns };
    } catch (err) {
      console.error("Error fetching annotations:", err);
      return { annotations: new Map(), columns: [] };
    }
  };

  /**
   * Replace any rsid token with the variant id it maps to. Returns null (after setting an error) when
   * an rsid is unknown or maps to several variants — the LD API only takes a single variant id, so
   * there is nothing sensible to pick in the ambiguous case.
   */
  const resolveRsidTokens = async (tokens: string[]): Promise<string[] | null> => {
    const rsids = tokens.filter((t) => RSID_RE.test(t));
    if (rsids.length === 0) {
      return tokens;
    }

    const response = await api.get<{ rsid: string; variants: string[] }[]>("/v1/rsid/variants", {
      params: { rsids: rsids.join(",") },
    });
    const byRsid = new Map(
      (response.data ?? []).map((r) => [r.rsid.toLowerCase(), r.variants ?? []])
    );

    const resolved: string[] = [];
    for (const token of tokens) {
      if (!RSID_RE.test(token)) {
        resolved.push(token);
        continue;
      }
      const variants = byRsid.get(token.toLowerCase()) ?? [];
      if (variants.length === 0) {
        setError(`${token} not found`);
        return null;
      }
      if (variants.length > 1) {
        setError(
          `${token} maps to several variants (${variants.join(", ")}) — please enter one of them`
        );
        return null;
      }
      resolved.push(variants[0].replace(/-/g, ":"));
    }
    return resolved;
  };

  const performLookup = async (input: string) => {
    setError(null);
    setLdResults(null);
    setComparisonResult(null);
    setAnnotationColumns([]);
    setQueryVariantAnnotation(null);

    let variants = input
      .split(/[,\s]+/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0);

    if (variants.length === 0) {
      setError("Please enter at least one variant");
      return;
    }

    if (variants.length > 2) {
      setError("Please enter only one or two variants");
      return;
    }

    setLoading(true);

    try {
      const resolved = await resolveRsidTokens(variants);
      if (resolved === null) {
        setLoading(false);
        return;
      }
      variants = resolved;

      if (variants.length === 1) {
        // single variant lookup
        const response = await fetch(
          `https://api.finngen.fi/api/ld?variant=${encodeURIComponent(
            variants[0]
          )}&window=1500000&panel=sisu42&r2_thresh=0.05`
        );

        if (!response.ok) {
          if (response.status === 400) {
            setError("Invalid variant");
            setLoading(false);
            return;
          }
          if (response.status === 404) {
            setError("Variant not found");
            setLoading(false);
            return;
          }
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const ldData: LDResult[] = data.ld;

        if (ldData && ldData.length > 0) {
          const queryVariant = ldData[0].variation1;

          // fetch annotations for all variants including the query variant
          const variantList = [queryVariant, ...ldData.map((r) => r.variation2)];
          const { annotations, columns } = await fetchAnnotations(variantList);

          // store query variant annotation
          const queryAnnotation = annotations.get(queryVariant);
          setQueryVariantAnnotation(queryAnnotation || null);

          // the finngen annotation source has no AF_fin — its AF already is the FinnGen (Finnish) AF
          const allowedColumns = ["AF", "most_severe", "gene_most_severe"];
          const displayColumns = allowedColumns.filter((col) => columns.includes(col));
          setAnnotationColumns(displayColumns);

          // left join: add annotation data to LD results
          const enrichedResults: LDResultWithAnnotation[] = ldData.map((ldRow) => {
            const annotation = annotations.get(ldRow.variation2);
            const result: LDResultWithAnnotation = { ...ldRow };

            if (annotation) {
              displayColumns.forEach((col) => {
                result[col] = annotation[col] || "N/A";
              });
            } else {
              displayColumns.forEach((col) => {
                result[col] = "N/A";
              });
            }

            return result;
          });

          setLdResults(enrichedResults);
        } else {
          setLdResults(ldData);
        }
      } else {
        // two variant comparison
        const parsed1 = parseVariant(variants[0]);
        const parsed2 = parseVariant(variants[1]);

        if (!parsed1 || !parsed2) {
          setError("Could not parse variant positions");
          setLoading(false);
          return;
        }

        if (parsed1.chr !== parsed2.chr) {
          setError("Variants are on different chromosomes");
          setLoading(false);
          return;
        }

        const distance = Math.abs(parsed1.pos - parsed2.pos);
        if (distance > 5000000) {
          setError(`Variants are ${distance.toLocaleString()} bp apart (maximum is 5,000,000 bp)`);
          setLoading(false);
          return;
        }

        // there is some bug in the LD API / Tomahawk with the window size, so we need to use a larger window
        const window = Math.max(distance * 2, 1000000);

        const response = await fetch(
          `https://api.finngen.fi/api/ld?variant=${encodeURIComponent(
            variants[0]
          )}&window=${window}&panel=sisu42`
        );

        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const ldData: LDResult[] = data.ld;

        // find the matching variant in the results
        // normalize both variants for comparison
        const variant2Normalized = variants[1].toLowerCase().replace(/^chr/, "");
        const match = ldData.find((result) => {
          const resultVariantNormalized = result.variation2
            .toLowerCase()
            .replace(/^chr/, "")
            .replace(/:/g, "-");
          return (
            variant2Normalized.replace(/:/g, "-") === resultVariantNormalized ||
            variant2Normalized.replace(/-/g, ":") === resultVariantNormalized
          );
        });

        if (!match) {
          setError(`Could not find LD information between ${variants[0]} and ${variants[1]}`);
          setLoading(false);
          return;
        }

        // the LD API's ids are already canonical, so they double as the annotation lookup keys
        const { annotations } = await fetchAnnotations([match.variation1, match.variation2]);

        setComparisonResult({
          variant1: match.variation1,
          variant2: match.variation2,
          d_prime: match.d_prime,
          r2: match.r2,
          annotation1: annotations.get(match.variation1) ?? null,
          annotation2: annotations.get(match.variation2) ?? null,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleLookup = () => {
    // update URL with query parameter
    navigate(`/ld?variants=${encodeURIComponent(variantInput)}`);
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      handleLookup();
    }
  };

  // go through the URL like handleLookup does, so the example is bookmarkable and the mount effect
  // is what triggers the lookup
  const runExample = (variants: string) => {
    setVariantInput(variants);
    navigate(`/ld?variants=${encodeURIComponent(variants)}`);
  };

  const baseColumns: MRT_ColumnDef<LDResultWithAnnotation>[] = [
    {
      accessorKey: "variation2",
      header: "Variant",
      sortingFn: variantSort,
      enableColumnFilter: false,
      Cell: ({ cell }) => {
        const variant = cell.getValue<string>();
        return (
          <Typography
            component="a"
            href={`/?q=${encodeURIComponent(variant)}`}
            style={{
              color: theme.palette.primary.main,
              textDecoration: "none",
              cursor: "pointer",
            }}
            onClick={(e) => {
              e.preventDefault();
              navigate(`/?q=${encodeURIComponent(variant)}`);
            }}>
            {variant}
          </Typography>
        );
      },
    },
    {
      accessorKey: "r2",
      header: "r²",
      sortingFn: naInfSort,
      enableColumnFilter: true,
      filterFn: "greaterThan",
      muiFilterTextFieldProps: { placeholder: "> value" },
      Cell: ({ cell }) => {
        const value = cell.getValue<number>();
        return typeof value === "number" ? value.toFixed(4) : "N/A";
      },
    },
    {
      accessorKey: "d_prime",
      header: "D'",
      sortingFn: naInfSort,
      enableColumnFilter: true,
      filterFn: "greaterThan",
      muiFilterTextFieldProps: { placeholder: "> value" },
      Cell: ({ cell }) => {
        const value = cell.getValue<number>();
        return typeof value === "number" ? value.toFixed(4) : "N/A";
      },
    },
  ];

  // extract unique values for most_severe multi-select filter
  const mostSevereOptions = ldResults
    ? Array.from(new Set(ldResults.map((r) => r.most_severe).filter((v) => v && v !== "NA")))
        .sort()
        .map((value) => ({ text: value, value }))
    : [];

  // add annotation columns
  const columns: MRT_ColumnDef<LDResultWithAnnotation>[] = [
    ...baseColumns,
    ...annotationColumns.map((col) => {
      // format header: remove underscores
      let header = col;
      if (col === "gene_most_severe") {
        header = "most severe gene";
      } else if (col === "AF") {
        header = "FinnGen AF";
      } else {
        header = col.replace(/_/g, " ");
      }

      const columnDef: MRT_ColumnDef<LDResultWithAnnotation> = {
        accessorKey: col,
        header: header,
        enableColumnFilter: true,
        Cell: ({ cell }: { cell: any }) => {
          const value = cell.getValue();
          if (value === "NA" || value === undefined) return "N/A";
          if (col.startsWith("AF") && typeof value === "number") {
            return value.toExponential(2);
          }
          if (col === "most_severe") {
            return value.toLowerCase().replace("_variant", "").replace(/_/g, " ");
          }
          return String(value);
        },
      };

      if (col === "most_severe") {
        columnDef.filterVariant = "multi-select";
        columnDef.filterSelectOptions = mostSevereOptions;
        columnDef.muiFilterTextFieldProps = { placeholder: "consequence" };
      } else if (col === "gene_most_severe") {
        columnDef.filterFn = "contains";
        columnDef.muiFilterTextFieldProps = { placeholder: "gene" };
      } else if (col === "AF") {
        columnDef.filterFn = "greaterThan";
        columnDef.muiFilterTextFieldProps = { placeholder: "> value" };
      }

      return columnDef;
    }),
  ];

  return (
    <Box display="flex" flexDirection="column">
      <Box display="flex" flexDirection="row" gap={2} style={{ marginBottom: "20px" }}>
        {isLDPage && (
          <>
            <Typography
              variant="h6"
              style={{ cursor: "pointer", color: theme.palette.primary.main }}
              onClick={() => navigate("/")}>
              Variant tables
            </Typography>
            <Typography
              variant="h6"
              style={{ cursor: "pointer", color: theme.palette.primary.main }}
              onClick={() => navigate("/gene")}>
              Gene view
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <Typography variant="h6">LD lookup</Typography>
            </Box>
          </>
        )}
      </Box>

      <Box display="flex" flexDirection="column" sx={{ maxWidth: "600px" }}>
        <Typography variant="body1" sx={{ marginBottom: "10px" }}>
          Enter one variant to see all variants in linkage disequilibrium with it,
          <br />
          or two variants to see the LD between them.
          <br />
          LD is calculated using SiSu 4.2 FinnGen imputation panel.
          <br />
          Variants can be given as chr:pos:ref:alt or as rsids.
        </Typography>
        <Typography variant="body2" sx={{ marginBottom: "10px" }}>
          Examples:
          <br />
          <Link
            component="button"
            type="button"
            sx={{ verticalAlign: "baseline" }}
            onClick={() => runExample(EXAMPLES.single)}>
            APOE4 missense ({EXAMPLES.single})
          </Link>
          <br />
          <Link
            component="button"
            type="button"
            sx={{ verticalAlign: "baseline" }}
            onClick={() => runExample(EXAMPLES.pair)}>
            FURIN/FES leads ({EXAMPLES.pair})
          </Link>
        </Typography>
        <TextField
          label="Enter variant(s)"
          placeholder="e.g., 2:9508859:G:T, chr2-9508859-G-T or rs13410158"
          value={variantInput}
          onChange={handleInputChange}
          onKeyDown={handleKeyPress}
          variant="outlined"
          style={{ width: "250px", marginTop: "10px", marginBottom: "0px" }}
          helperText="For two variants, separate with comma, space or newline"
          multiline
          rows={2}
        />
        <Button
          sx={{ marginBottom: "10px", width: "160px" }}
          size="small"
          color="primary"
          variant="contained"
          onClick={handleLookup}
          disabled={loading}>
          {loading ? <CircularProgress size={20} /> : "Lookup"}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ marginTop: "20px", maxWidth: "600px" }}>
          {error}
        </Alert>
      )}

      {comparisonResult && (
        <Paper sx={{ padding: "20px", marginTop: "20px", maxWidth: "600px" }}>
          <Typography variant="h6" sx={{ marginBottom: "10px" }}>
            LD between variants
          </Typography>
          {[
            { variant: comparisonResult.variant1, annotation: comparisonResult.annotation1 },
            { variant: comparisonResult.variant2, annotation: comparisonResult.annotation2 },
          ].map(({ variant, annotation }) => {
            const summary = formatAnnotationSummary(annotation);
            return (
              <Box key={variant} sx={{ marginBottom: "6px" }}>
                <Typography variant="body1">{variant}</Typography>
                {summary && (
                  <Typography variant="body2" color="text.secondary">
                    {summary}
                  </Typography>
                )}
              </Box>
            );
          })}
          <Typography variant="body1" sx={{ marginTop: "10px" }}>
            <strong>D'</strong> {comparisonResult.d_prime.toFixed(4)}
          </Typography>
          <Typography variant="body1">
            <strong>r²</strong> {comparisonResult.r2.toFixed(4)}
          </Typography>
        </Paper>
      )}

      {ldResults &&
        ldResults.length > 0 &&
        (() => {
          // calculate summary statistics
          const r2_099_variants = ldResults.filter((r) => r.r2 > 0.99);
          const r2_09_variants = ldResults.filter((r) => r.r2 > 0.9);
          const r2_06_variants = ldResults.filter((r) => r.r2 > 0.6);
          const r2_005_variants = ldResults.filter((r) => r.r2 > 0.05);

          // helper to count coding/LoF variants
          const countCodingLoF = (variants: LDResultWithAnnotation[]) => {
            const coding = variants.filter(
              (r) =>
                r.most_severe &&
                r.most_severe !== "NA" &&
                isCoding(r.most_severe.replace("_variant", ""))
            ).length;
            const lof = variants.filter(
              (r) =>
                r.most_severe &&
                r.most_severe !== "NA" &&
                isLoF(r.most_severe.replace("_variant", ""))
            ).length;
            return { coding, lof };
          };

          const counts099 = countCodingLoF(r2_099_variants);
          const counts09 = countCodingLoF(r2_09_variants);
          const counts06 = countCodingLoF(r2_06_variants);
          const counts005 = countCodingLoF(r2_005_variants);

          const getMafRange = (variants: LDResultWithAnnotation[], afField: string) => {
            const afValues = variants
              .map((r) => r[afField])
              .filter(
                (af) => af !== "N/A" && af !== undefined && typeof af === "number"
              ) as number[];
            const mafValues = afValues.map((af) => Math.min(af, 1 - af));
            const mafMin = mafValues.length > 0 ? Math.min(...mafValues) : null;
            const mafMax = mafValues.length > 0 ? Math.max(...mafValues) : null;
            return { mafMin, mafMax };
          };

          const mafFin099 = getMafRange(r2_099_variants, "AF");
          const mafFin09 = getMafRange(r2_09_variants, "AF");
          const mafFin06 = getMafRange(r2_06_variants, "AF");
          const mafFin005 = getMafRange(r2_005_variants, "AF");

          const formatMafRange = (mafMin: number | null, mafMax: number | null) => {
            return mafMin !== null && mafMax !== null
              ? `${mafMin.toExponential(2)} to ${mafMax.toExponential(2)}`
              : "N/A";
          };

          const queryVariant = ldResults[0].variation1 || "the query variant";
          const queryVariantInfo = formatAnnotationSummary(queryVariantAnnotation) ?? queryVariant;

          return (
            <Box sx={{ marginTop: "20px" }}>
              <Typography variant="h6" sx={{ marginBottom: "10px" }}>
                {queryVariant}
                <br />
                {queryVariantInfo}
                <br />
                <br />
                Variants in LD (r² &gt; 0.05, within 1.5 Mb from query variant)
              </Typography>

              <Box
                sx={{
                  marginBottom: "15px",
                  padding: "10px",
                  backgroundColor:
                    theme.palette.mode === "dark"
                      ? "rgba(255, 255, 255, 0.05)"
                      : "rgba(0, 0, 0, 0.02)",
                  borderRadius: "4px",
                }}>
                <table style={{ borderCollapse: "collapse", fontSize: "0.75rem" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "2px 8px", fontWeight: "bold" }}>
                        r²
                      </th>
                      <th style={{ textAlign: "left", padding: "2px 8px", fontWeight: "bold" }}>
                        variants
                      </th>
                      <th style={{ textAlign: "left", padding: "2px 8px", fontWeight: "bold" }}>
                        FinnGen MAF
                      </th>
                      <th style={{ textAlign: "left", padding: "2px 8px", fontWeight: "bold" }}>
                        coding
                      </th>
                      <th style={{ textAlign: "left", padding: "2px 8px", fontWeight: "bold" }}>
                        LoF
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: "2px 8px" }}>&gt; 0.99</td>
                      <td style={{ textAlign: "right", padding: "2px 8px" }}>
                        {r2_099_variants.length}
                      </td>
                      <td style={{ textAlign: "right", padding: "2px 8px" }}>
                        {formatMafRange(mafFin099.mafMin, mafFin099.mafMax)}
                      </td>
                      <td style={{ textAlign: "right", padding: "2px 8px" }}>{counts099.coding}</td>
                      <td style={{ textAlign: "right", padding: "2px 8px" }}>{counts099.lof}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "2px 8px" }}>&gt; 0.9</td>
                      <td style={{ textAlign: "right", padding: "2px 8px" }}>
                        {r2_09_variants.length}
                      </td>
                      <td style={{ textAlign: "right", padding: "2px 8px" }}>
                        {formatMafRange(mafFin09.mafMin, mafFin09.mafMax)}
                      </td>
                      <td style={{ textAlign: "right", padding: "2px 8px" }}>{counts09.coding}</td>
                      <td style={{ textAlign: "right", padding: "2px 8px" }}>{counts09.lof}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "2px 8px" }}>&gt; 0.6</td>
                      <td style={{ textAlign: "right", padding: "2px 8px" }}>
                        {r2_06_variants.length}
                      </td>
                      <td style={{ textAlign: "right", padding: "2px 8px" }}>
                        {formatMafRange(mafFin06.mafMin, mafFin06.mafMax)}
                      </td>
                      <td style={{ textAlign: "right", padding: "2px 8px" }}>{counts06.coding}</td>
                      <td style={{ textAlign: "right", padding: "2px 8px" }}>{counts06.lof}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "2px 8px" }}>&gt; 0.05</td>
                      <td style={{ textAlign: "right", padding: "2px 8px" }}>
                        {r2_005_variants.length}
                      </td>
                      <td style={{ textAlign: "right", padding: "2px 8px" }}>
                        {formatMafRange(mafFin005.mafMin, mafFin005.mafMax)}
                      </td>
                      <td style={{ textAlign: "right", padding: "2px 8px" }}>{counts005.coding}</td>
                      <td style={{ textAlign: "right", padding: "2px 8px" }}>{counts005.lof}</td>
                    </tr>
                  </tbody>
                </table>
              </Box>

              <Box sx={{ marginBottom: "10px", marginLeft: "10px" }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={showOnlyCoding}
                      onChange={(e) => setShowOnlyCoding(e.target.checked)}
                    />
                  }
                  label="Show only coding variants"
                />
              </Box>

              <MaterialReactTable
                columns={columns}
                data={
                  showOnlyCoding
                    ? ldResults.filter(
                        (r) =>
                          r.most_severe &&
                          r.most_severe !== "NA" &&
                          isCoding(r.most_severe.replace("_variant", ""))
                      )
                    : ldResults
                }
                enableColumnFilters={true}
                enableDensityToggle={false}
                enableFullScreenToggle={false}
                enableHiding={false}
                initialState={{
                  density: "compact",
                  sorting: [{ id: "r2", desc: true }],
                  showColumnFilters: true,
                  pagination: { pageSize: 20, pageIndex: 0 },
                }}
                muiTableBodyCellProps={{ sx: { fontSize: "0.75rem" } }}
              />
            </Box>
          );
        })()}

      {ldResults && ldResults.length === 0 && (
        <Alert severity="info" sx={{ marginTop: "20px", maxWidth: "600px" }}>
          No variants found in LD with the query variant (r² ≥ 0.05, within 1.5 Mb from query
          variant)
        </Alert>
      )}
    </Box>
  );
};

export default LDContainer;
