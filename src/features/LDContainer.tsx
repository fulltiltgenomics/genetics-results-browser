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
} from "@mui/material";
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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

  const fetchAnnotations = async (
    chr: string,
    minPos: number,
    maxPos: number,
    variants: string[]
  ): Promise<{ annotations: Map<string, any>; columns: string[] }> => {
    try {
      const response = await api.post<string>(
        `/v1/variant_annotation_range/${chr}/${minPos}/${maxPos}`,
        variants
      );

      const rows = response.data.split("\n");
      if (rows.length < 2) {
        return { annotations: new Map(), columns: [] };
      }

      const header = rows[0].split("\t");
      const columns = header.map((h) => h.replace("#", ""));

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
    } catch (err) {
      console.error("Error fetching annotations:", err);
      return { annotations: new Map(), columns: [] };
    }
  };

  const performLookup = async (input: string) => {
    setError(null);
    setLdResults(null);
    setComparisonResult(null);
    setAnnotationColumns([]);
    setQueryVariantAnnotation(null);

    const variants = input
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
          // extract chromosome and position range from LD results
          const queryVariant = ldData[0].variation1;
          const chr = ldData[0].variation2.split(":")[0];

          // include query variant position in the range
          const queryPos = parseInt(queryVariant.split(":")[1], 10);
          const positions = ldData.map((r) => parseInt(r.variation2.split(":")[1], 10));
          positions.push(queryPos);
          const minPos = Math.min(...positions);
          const maxPos = Math.max(...positions);

          // fetch annotations for all variants including the query variant
          const variantList = [queryVariant, ...ldData.map((r) => r.variation2)];
          const { annotations, columns } = await fetchAnnotations(chr, minPos, maxPos, variantList);

          // store query variant annotation
          const queryAnnotation = annotations.get(queryVariant);
          setQueryVariantAnnotation(queryAnnotation || null);

          const allowedColumns = ["AF", "AF_fin", "most_severe", "gene_most_severe"];
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

        const window = Math.max(distance + 1, 100000);

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

        setComparisonResult({
          variant1: variants[0],
          variant2: variants[1],
          d_prime: match.d_prime,
          r2: match.r2,
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
        header = "AF global";
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
            return value.toExponential(3);
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
      } else if (col === "AF" || col === "AF_fin") {
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
              Variant table
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
        </Typography>
        <TextField
          label="Enter variant(s)"
          placeholder="e.g., 2:9508859:G:T or chr2-9508859-G-T"
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
          <Typography variant="body1">{comparisonResult.variant1}</Typography>
          <Typography variant="body1">{comparisonResult.variant2}</Typography>
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

          const mafFin099 = getMafRange(r2_099_variants, "AF_fin");
          const mafFin09 = getMafRange(r2_09_variants, "AF_fin");
          const mafFin06 = getMafRange(r2_06_variants, "AF_fin");
          const mafFin005 = getMafRange(r2_005_variants, "AF_fin");

          const formatMafRange = (mafMin: number | null, mafMax: number | null) => {
            return mafMin !== null && mafMax !== null
              ? `${mafMin.toExponential(3)} to ${mafMax.toExponential(3)}`
              : "N/A";
          };

          const queryVariant = ldResults[0].variation1 || "the query variant";

          // format query variant annotation
          let queryVariantInfo = queryVariant;
          if (queryVariantAnnotation) {
            const af =
              queryVariantAnnotation.AF !== "N/A" && typeof queryVariantAnnotation.AF === "number"
                ? queryVariantAnnotation.AF.toExponential(3)
                : "N/A";
            const afFin =
              queryVariantAnnotation.AF_fin !== "N/A" &&
              typeof queryVariantAnnotation.AF_fin === "number"
                ? queryVariantAnnotation.AF_fin.toExponential(3)
                : "N/A";
            const mostSevere =
              queryVariantAnnotation.most_severe && queryVariantAnnotation.most_severe !== "N/A"
                ? queryVariantAnnotation.most_severe
                    .toLowerCase()
                    .replace("_variant", "")
                    .replace(/_/g, " ")
                : "N/A";
            const gene =
              queryVariantAnnotation.gene_most_severe &&
              queryVariantAnnotation.gene_most_severe !== "N/A"
                ? queryVariantAnnotation.gene_most_severe
                : "N/A";

            queryVariantInfo = `AF: ${af}, AF fin: ${afFin}`;
            if (mostSevere !== "N/A") {
              queryVariantInfo = `${queryVariantInfo}, ${mostSevere}`;
            }
            if (gene !== "N/A") {
              queryVariantInfo = `${queryVariantInfo}, ${gene}`;
            }
          }

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
                <table style={{ borderCollapse: "collapse", fontSize: "0.875rem" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: "bold" }}>
                        r²
                      </th>
                      <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: "bold" }}>
                        variants
                      </th>
                      <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: "bold" }}>
                        MAF fin
                      </th>
                      <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: "bold" }}>
                        coding
                      </th>
                      <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: "bold" }}>
                        LoF
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: "4px 8px" }}>&gt; 0.99</td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>
                        {r2_099_variants.length}
                      </td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>
                        {formatMafRange(mafFin099.mafMin, mafFin099.mafMax)}
                      </td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>{counts099.coding}</td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>{counts099.lof}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 8px" }}>&gt; 0.9</td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>
                        {r2_09_variants.length}
                      </td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>
                        {formatMafRange(mafFin09.mafMin, mafFin09.mafMax)}
                      </td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>{counts09.coding}</td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>{counts09.lof}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 8px" }}>&gt; 0.6</td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>
                        {r2_06_variants.length}
                      </td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>
                        {formatMafRange(mafFin06.mafMin, mafFin06.mafMax)}
                      </td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>{counts06.coding}</td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>{counts06.lof}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 8px" }}>&gt; 0.05</td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>
                        {r2_005_variants.length}
                      </td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>
                        {formatMafRange(mafFin005.mafMin, mafFin005.mafMax)}
                      </td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>{counts005.coding}</td>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>{counts005.lof}</td>
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
