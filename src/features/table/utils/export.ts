import { MRT_ColumnDef, MRT_TableInstance } from "material-react-table";
import { SHA256 } from "crypto-js";

import {
  AssocRecord,
  FineMappedRecord,
  GroupedFineMappedRecord,
  PhenoMap,
  VariantRecord,
  TableData,
  DatasetMap,
} from "../../../types/types";
import { download, generateCsv, mkConfig } from "export-to-csv";
import { getAssociationTableColumns } from "../tables/VariantAssocTable.columns";
import { pValRepr } from "./tableutil";

export const handlePhenoSummaryTableExport = (data: TableData) => {
  const phenos = Object.keys(data.phenos).map((k) => data.phenos[k]);
  // filter phenos to those that at least one variant has a result for
  const phenosFiltered = phenos.filter(
    (p) =>
      p.data_type !== "NA" &&
      data.data.some((d) => d.assoc.data.some((a) => a.phenocode === p.phenocode))
  );
  const variants = data.data.map((d) => d.variant);

  // make a matrix [phenos][variants] with beta values, or NA if not present
  const dataExport: Record<string, string>[] = phenosFiltered
    .map((p) => {
      const phenoData: Record<string, string> = {
        phenotype: `${p.resource}:${p.phenocode}:${p.phenostring}`,
      };
      let nonNACount = 0;
      variants.forEach((v) => {
        const beta =
          data.data
            .find((d) => d.variant === v)
            ?.assoc.data.find((a) => a.resource === p.resource && a.phenocode === p.phenocode)
            ?.beta || "NA";
        phenoData[v] = String(beta);
        if (beta !== "NA") {
          nonNACount++;
        }
      });
      return { phenoData, nonNACount };
    })
    .sort((a, b) => b.nonNACount - a.nonNACount)
    .map((item) => item.phenoData);

  const csvConfig = mkConfig({
    fieldSeparator: "\t",
    filename: `pheno_annotation_${phenosFiltered.length}_phenos_variant_beta_grid_${SHA256(
      phenosFiltered.map((p) => p.phenocode).join("")
    )
      .toString()
      .substring(0, 7)}`,
    quoteStrings: false,
    decimalSeparator: ".",
    useBom: false,
    useKeysAsHeaders: true,
    useTextFile: true,
  });
  const csv = generateCsv(csvConfig)(dataExport);
  download(csvConfig)(csv);
};

// TODO these functions are complicated and error prone if the tables are changed and should be refactored
// perhaps munging the data to a more direct export format helps
// or make all HTML columns use the same format, e.g. give a value prop
// or use the meta property of the columns
export const handleMainTableExport = (
  variantInput: string,
  table: MRT_TableInstance<VariantRecord>,
  columns: MRT_ColumnDef<VariantRecord>[]
) => {
  const dataExport = table.getExpandedRowModel().rows.map((row) => {
    return columns.reduce((p, c) => {
      const colId = c.id as string;
      let val = row.getValue(colId) as any;
      // not entirely sure why this is necessary, but it is
      if (typeof val === "undefined") {
        p[c.header] = "NA";
      } else {
        const colname = c.header.replace(/ /g, "_").toLocaleLowerCase();
        val = val!;
        if (typeof val === "number") {
          p[colname] = String(val);
        } else if (typeof val === "string") {
          p[colname] = val || "NA";
        } else if (val.props.gnomadData !== undefined) {
          // gnomad AF
          p[colname] = val.props.gnomadData[val.props.gnomadData.preferred]!.AF || "NA";
        } else if (
          val.props.children &&
          typeof val.props.children === "object" &&
          val.props.children.length === 4
        ) {
          // up/down arrows expected
          p[colname] = `${val.props.children[1]}/${val.props.children[3]}`;
        } else if (val.props.children && typeof val.props.children === "object") {
          // two values expected
          p[colname] = val.props.children[1].props.children || "NA";
        } else if (val.props.children && val.props.children !== undefined) {
          if (val.props.children.props !== undefined) {
            // tooltipped value
            p[colname] = val.props.children.props.children || "NA";
          } else {
            // styled value
            p[colname] = val.props.children || "NA";
          }
        } else if (val.props.content && val.props.content.props.children) {
          // tooltipped value
          if (Array.isArray(val.props.content.props.children)) {
            // top pheno has a list
            p[colname] = val.props.content.props.children[0] || "NA";
          } else {
            p[colname] = val.props.content.props.children || "NA";
          }
        } else {
          console.warn(`unhandled export field will be NA: ${colId}`);
          p[colname] = "NA";
        }
      }
      return p;
    }, {} as Record<string, string>);
  });
  console.log(dataExport);
  const csvConfig = mkConfig({
    fieldSeparator: "\t",
    filename: `variant_annotation_${dataExport.length}_variants_${SHA256(variantInput)
      .toString()
      .substring(0, 7)}`,
    quoteStrings: false,
    decimalSeparator: ".",
    useBom: false, //never
    useKeysAsHeaders: true,
    useTextFile: true,
  });
  console.log(dataExport);
  const csv = generateCsv(csvConfig)(dataExport);
  download(csvConfig)(csv);
};

export const handleFineMappingTableExport = (
  variantInput: string,
  phenoMap: PhenoMap,
  datasetMap: DatasetMap,
  numVariants: number,
  table: MRT_TableInstance<VariantRecord>,
  mainTableColumns: MRT_ColumnDef<VariantRecord>[],
  columns: MRT_ColumnDef<GroupedFineMappedRecord>[]
) => {
  const dataExport = table
    .getExpandedRowModel()
    .rows.map((row) => {
      // TODO make modular, use the same code as the main table
      const mainTableMainCols = mainTableColumns
        .slice(0, 6)
        .map((col) => [col.header, col.id as string]);
      const mainTableColsExport = mainTableMainCols.reduce((p, c) => {
        const val = (row.getValue(c[1]) || "NA") as any;
        const colname = c[0].replace(/ /g, "_").toLocaleLowerCase();
        if (typeof val === "object") {
          if (val.props.gnomadData) {
            p[colname] = val.props.gnomadData[val.props.gnomadData.preferred]!.AF || "NA";
          } else if (val.props.children && val.props.children.length === 4) {
            // up/down arrows expected
            p[colname] = `${val.props.children[1]}/${val.props.children[3]}`;
          } else if (val.props.children && val.props.children[1]) {
            // two values
            p[colname] = val.props.children[1].props.children || "NA";
          } else if (val.props.children && val.props.children !== undefined) {
            if (val.props.children.props !== undefined) {
              // tooltipped value
              p[colname] = val.props.children.props.children || "NA";
            } else {
              // styled value
              p[colname] = val.props.children || "NA";
            }
          } else if (val.props.content && val.props.content.props.children) {
            // tooltipped value
            p[colname] = val.props.content.props.children || "NA";
          } else {
            console.warn(`possible unhandled export field will be NA: ${c[1]}`);
            p[colname] = "NA";
          }
        } else {
          p[colname] = String(val);
        }
        return p;
      }, {} as Record<string, string>);
      return row.original.finemapped.data.map((fm) => {
        const fmCols = columns.reduce((p, c) => {
          const hdr = c.header.replace(/ /g, "_").toLocaleLowerCase();
          if (hdr == "trait") {
            // TODO both phenocode - or link to pheno - and phenomap
            //p[hdr] = fm.phenocode;
            p[hdr] = phenoMap[fm.resource + ":" + fm.phenocode].phenostring;
          } else if (hdr == "p-value") {
            p[hdr] = pValRepr(fm.mlog10p);
          } else if (hdr == "dataset") {
            const dataset = datasetMap[fm.dataset];
            const datasetName = dataset
              ? `${dataset.study_label}:${dataset.sample_group}:${dataset.quant_method}`
              : fm.dataset;
            p[hdr] = datasetName.replace(/_/g, " ");
          } else {
            const colId = c.id
              ? (c.id as keyof FineMappedRecord)
              : (c.accessorKey as keyof FineMappedRecord);
            p[hdr] = String(fm[colId]) || "NA";
          }
          return p;
        }, {} as Record<string, string>);
        return {
          ...mainTableColsExport,
          ...fmCols,
        };
      });
    })
    .flat();
  const csvConfig = mkConfig({
    fieldSeparator: "\t",
    filename: `variant_annotation_${numVariants}_variants_finemapping_${SHA256(variantInput)
      .toString()
      .substring(0, 7)}`,
    quoteStrings: false,
    decimalSeparator: ".",
    useBom: false, //never
    useKeysAsHeaders: true,
    useTextFile: true,
  });
  const csv = generateCsv(csvConfig)(dataExport);
  download(csvConfig)(csv);
};

export const handleAssocTableExport = (
  variantInput: string,
  phenoMap: PhenoMap,
  numVariants: number,
  table: MRT_TableInstance<VariantRecord>,
  mainTableColumns: MRT_ColumnDef<VariantRecord>[],
  phenos: PhenoMap,
  datasets: DatasetMap,
  meta: TableData["meta"]
) => {
  const assocColumns = getAssociationTableColumns(undefined, 0, phenos, datasets, meta);
  const dataExport = table
    .getExpandedRowModel()
    .rows.map((row) => {
      // TODO make modular, use the same code as the main table
      const mainTableMainCols = mainTableColumns
        .slice(0, 6)
        .map((col) => [col.header, col.id as string]);
      const mainTableColsExport = mainTableMainCols.reduce((p, c) => {
        const val = (row.getValue(c[1]) || "NA") as any;
        const colname = c[0].replace(/ /g, "_").toLocaleLowerCase();
        if (typeof val === "object") {
          if (val.props.gnomadData) {
            p[colname] = val.props.gnomadData[val.props.gnomadData.preferred]!.AF || "NA";
          } else if (val.props.children && val.props.children.length === 4) {
            // up/down arrows expected
            p[colname] = `${val.props.children[1]}/${val.props.children[3]}`;
          } else if (val.props.children && val.props.children[1]) {
            // two values
            p[colname] = val.props.children[1].props.children || "NA";
          } else if (val.props.children && val.props.children !== undefined) {
            if (val.props.children.props !== undefined) {
              // tooltipped value
              p[colname] = val.props.children.props.children || "NA";
            } else {
              // styled value
              p[colname] = val.props.children || "NA";
            }
          } else if (val.props.content && val.props.content.props.children) {
            // tooltipped value
            p[colname] = val.props.content.props.children || "NA";
          } else {
            console.warn(`possible unhandled export field will be NA: ${c[1]}`);
            p[colname] = "NA";
          }
        } else {
          p[colname] = String(val);
        }
        return p;
      }, {} as Record<string, string>);
      const assocData = row.original.assoc.data.map((assoc) => {
        const assocCols = assocColumns.reduce((p, c) => {
          const hdr = c.header.replace(/ /g, "_").toLocaleLowerCase();
          if (hdr == "resource") {
            p[hdr] = assoc.resource;
          } else if (hdr == "dataset") {
            p[hdr] = assoc.dataset;
          } else if (hdr == "type") {
            p[hdr] = assoc.data_type;
          } else if (hdr === "trait") {
            // TODO both phenocode - or link to pheno - and phenomap
            //p[hdr] = fm.phenocode;
            p[hdr] = phenoMap[assoc.resource + ":" + assoc.phenocode].phenostring;
          } else if (hdr == "p-value") {
            p[hdr] = pValRepr(assoc.mlog10p);
          } else {
            const colId = c.id ? (c.id as keyof AssocRecord) : (c.accessorKey as keyof AssocRecord);
            p[hdr] = String(assoc[colId]) || "NA";
          }
          return p;
        }, {} as Record<string, string>);
        return {
          ...mainTableColsExport,
          ...assocCols,
        };
      });
      // omitting placeholder phenotypes
      return assocData.filter((v) => Number(v["p-value"]) < 1);
    })
    .flat();
  const csvConfig = mkConfig({
    fieldSeparator: "\t",
    filename: `variant_annotation_${numVariants}_variants_associations_${SHA256(variantInput)
      .toString()
      .substring(0, 7)}`,
    quoteStrings: false,
    decimalSeparator: ".",
    useBom: false, //never
    useKeysAsHeaders: true,
    useTextFile: true,
  });
  const csv = generateCsv(csvConfig)(dataExport);
  download(csvConfig)(csv);
};
