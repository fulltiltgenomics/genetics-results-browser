import { Link, Typography } from "@mui/material";
import { MaterialReactTable, MRT_ColumnDef } from "material-react-table";
import { useConfigQuery } from "../../store/serverQuery";
import { useMemo, useState } from "react";
import { ResourceConfig } from "../../types/types";

const About = () => {
  const { data } = useConfigQuery();
  const [datasets, setDatasets] = useState<ResourceConfig[]>([]);

  useMemo(() => {
    if (data) {
      const dsets: Record<string, ResourceConfig> = {};
      data.assoc.resources.forEach((dataset) => {
        if (!(dataset.resource in dsets)) {
          dsets[dataset.resource] = dataset;
        }
        dsets[dataset.resource].assoc = true;
      });
      data.finemapped.resources.forEach((dataset: any) => {
        if (!(dataset.resource in dsets)) {
          dsets[dataset.resource] = dataset;
        }
        dsets[dataset.resource].finemapped = true;
      });
      setDatasets(Object.values(dsets));
    }
  }, [data]);

  const columns: MRT_ColumnDef<any>[] = [
    {
      accessorFn: (row: any) => {
        return (
          <Link href={row.url} color="inherit" target="_blank">
            {row.resource.replace(/_/g, " ")}
          </Link>
        );
      },
      header: "resource",
      size: 65,
    },
    {
      accessorKey: "version",
      header: "version",
      size: 65,
    },
    {
      accessorFn: (row: any) => {
        return row.data_types.join(", ");
      },
      header: "data types",
      size: 65,
    },
    {
      accessorFn: (row: any) => {
        return row.assoc ? "yes" : "no";
      },
      header: "association results",
      size: 65,
    },
    {
      accessorFn: (row: any) => {
        return row.finemapped ? "yes" : "no";
      },
      header: "fine-mapping results",
      size: 65,
    },
    {
      accessorKey: "n_traits",
      header: "traits",
      size: 65,
    },
  ];

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
        data={datasets}
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
        Open Targets association results are from their October 2022 release (last release with
        non-finemapped association results). Open Targets credible sets are from their March 2025
        release. Open Targets results are only shown for GWAS traits. FinnGen results from Open
        Targets are not shown in this tool as we show those directly from FinnGen.
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
