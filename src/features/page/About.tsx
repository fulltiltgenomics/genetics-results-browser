import { Link, Typography } from "@mui/material";
import { MaterialReactTable, MRT_ColumnDef } from "material-react-table";
import { DatasetRow, useDatasets } from "../../store/serverQuery";
import { useMemo } from "react";

const About = () => {
  const { data: datasets } = useDatasets();

  // prefer qtl_types (e.g. eQTL/sQTL/pQTL) over the coarse data_type when present
  const dataTypeLabel = (row: DatasetRow): string =>
    row.qtlTypes && row.qtlTypes.length > 0
      ? row.qtlTypes.join(", ")
      : row.dataType.replace(/_/g, " ");

  const products = (row: DatasetRow): string => {
    const p: string[] = [];
    if (row.hasCredibleSets) p.push("credible sets");
    if (row.hasSummaryStats) p.push("summary stats");
    if (row.hasColocalization) p.push("colocalization");
    return p.join(", ");
  };

  const columns = useMemo<MRT_ColumnDef<DatasetRow>[]>(
    () => [
      {
        accessorFn: (row) => row.resource.replace(/_/g, " "),
        header: "resource",
        size: 90,
      },
      {
        accessorKey: "datasetId",
        header: "dataset",
        size: 110,
      },
      {
        accessorFn: dataTypeLabel,
        header: "data type",
        size: 90,
      },
      {
        accessorKey: "description",
        header: "description",
        size: 260,
      },
      {
        accessorFn: products,
        header: "products",
        size: 130,
      },
      {
        accessorFn: (row) => row.nPhenotypes ?? "",
        header: "phenotypes",
        size: 70,
      },
      {
        accessorFn: (row) => (row.nSamples != null ? row.nSamples.toLocaleString() : ""),
        header: "samples",
        size: 70,
      },
    ],
    []
  );

  return (
    <>
      <Typography>
        This variant annotation and interpretation tool came out of a need to interpret lists of
        genetic variants.
        <br />
        Suppose you've run a GWAS and have N hits.
        <br />
        How many of them are novel?
        <br />
        What other disease or molecular traits do some of those variants affect and are the effect
        directions consistent?
        <br />
        Are your variants likely to be causal based on fine-mapping and variant consequence?
        <br />
        This tool helps you answer these kinds of questions while also allowing for deep dives to
        the effects of individual variants.
      </Typography>
      <Typography>
        <br />
        The variant annotation tool is available at <Link href="/annotate">/annotate</Link>, where
        you can paste a list of variants or enter a gene. The landing page at{" "}
        <Link href="/">/</Link> is a chat assistant for asking questions about variants and genes in
        natural language.
      </Typography>
      <Typography>
        <br />
        Results are based on <b>credible sets from statistical fine-mapping</b>. For each input
        variant we show the credible sets it belongs to across all resources, spanning disease and
        molecular (eQTL, caQTL, pQTL) traits. You can filter by fine-mapping posterior inclusion
        probability (PIP) and, optionally, by the linkage between your input variant and the credible
        set (cs_min_r2). Resources and data types can be selected in the main options and are derived
        dynamically from the underlying data.
      </Typography>
      <Typography>
        <br />
        Within the expanded view of a variant, each credible set shows the other signals it{" "}
        <b>colocalizes</b> with. A separate phenotype-search view returns full summary statistics for
        all of your input variants for a chosen phenotype, flagging which variants fall in a credible
        set for that phenotype. The gene view includes a <b>Gene evidence</b> tab with gene burden
        results, gene expression and Mendelian gene-disease associations. eQTL Catalogue results are
        shown at gene level (ge) by default, with the option to also include exon, transcript,
        txrev and leafcutter quantification levels.
      </Typography>
      <Typography>
        <br />
        The tool was devised by Juha Karjalainen and Mark Daly with significant input from Mary Pat
        Reeve and Masahiro Kanai.
      </Typography>
      <Typography>
        <br />
        Thank you to all beta testers who also provided valuable suggestions: Mikko Arvas, A. Mesut
        Erzurumluoglu,
        <br />
        Jarkko Toivonen, Yanfei Zhang, Mari Niemi, Andrew Stiemke, Bin Guo, Ivy Aneas Swanson and
        Bridget Riley-Gillis.
      </Typography>
      <Typography>
        <br />
        source code in GitHub:{" "}
        <Link target="_blank" href="https://github.com/fulltiltgenomics/genetics-results-api">
          backend API
        </Link>{" "}
        <Link target="_blank" href="https://github.com/fulltiltgenomics/genetics-results-browser">
          frontend browser
        </Link>
      </Typography>
      <Typography variant="h6" sx={{ marginTop: "20px" }}>
        Currently included datasets
      </Typography>
      <MaterialReactTable
        columns={columns}
        data={datasets ?? []}
        enablePagination={false}
        enableBottomToolbar={false}
        enableTopToolbar={false}
        enableColumnFilters={false}
        initialState={{
          density: "compact",
          pagination: { pageSize: 20, pageIndex: 0 },
        }}
        muiTableProps={{
          sx: {
            tableLayout: "fixed",
          },
        }}
        muiTableBodyCellProps={{
          sx: {
            fontSize: "0.75rem",
          },
        }}
        muiTableBodyProps={{
          sx: {
            "& tr:nth-of-type(even)": {
              backgroundColor: "#333333",
            },
          },
        }}
      />
      <Typography>
        <br />
        Open Targets credible sets are from their March 2025 release and are only shown for GWAS
        traits that have been fine-mapped with SuSiE-inf. FinnGen results from Open Targets are not
        shown in this tool as we show those directly from FinnGen.
      </Typography>
      <Typography>
        <br />
        rsids, variant consequence and gene assignments come from gnomAD v4.0.
        <br />
        The <i>vep.most_severe_consequence</i> gnomAD field is used to determine most severe
        <br />
        variant consequence. Note that in gnomAD internally, <i>vep.most_severe_consequence</i> is
        <br />
        determined by Ensembl and RefSeq annotations, but only Ensembl annotations are shown in the
        <br />
        gnomAD browser.
      </Typography>
      <Typography>
        <br />
        Gene information in gene tooltips comes from{" "}
        <Link href="https://mygene.info/">mygene.info</Link>
      </Typography>
    </>
  );
};

export default About;
