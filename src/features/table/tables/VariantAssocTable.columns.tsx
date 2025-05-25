import type { MRT_ColumnDef } from "material-react-table";
import { DatasetMap, GroupedAssocRecord, PhenoMap, TableData } from "../../../types/types";
import { filterAbsGreaterThanHTML, filterContainsWithTooltip, pValRepr } from "../utils/tableutil";
import { PhenoTooltip } from "../../tooltips/PhenoTooltip";
import { UpOrDownIcon } from "../UpDownIcons";
import { isQTLInCis, isQTLInTrans } from "../../../store/munge";
import { AssocPValLDTooltip } from "../../tooltips/AssocPValLDTooltip";

export const getAssociationTableColumns = (
  variant: string | undefined,
  cisWindow: number,
  phenoMap: PhenoMap,
  datasetMap: DatasetMap,
  meta: TableData["meta"]
): MRT_ColumnDef<GroupedAssocRecord>[] => [
  {
    accessorFn: (row) => phenoMap[row.resource + ":" + row.phenocode[0]].data_type,
    header: "type",
    filterFn: "contains",
    //filterVariant: 'multi-select',
    //filterSelectOptions: props.data.assoc.resources,
    muiFilterTextFieldProps: { placeholder: "type" },
    size: 65,
  },
  {
    accessorFn: (row) => {
      // if dataset metadata is available, use it to display dataset name
      const dataset = datasetMap[row.dataset];
      const datasetName = dataset
        ? `${dataset.study_label}:${dataset.sample_group}:${dataset.quant_method}`
        : row.dataset;
      return datasetName.replace(/_/g, " ");
    },
    header: "dataset",
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "dataset" },
    size: 150,
  },
  {
    accessorFn: (row) => {
      const phenos = row.phenocode.map((phenocode) => phenoMap[row.resource + ":" + phenocode]);
      const resource = meta.assoc.resources.find((r) => r.resource == phenos[0].resource)!;
      const qtlNote =
        variant === undefined
          ? ""
          : isQTLInCis(variant, phenos[0], cisWindow)
          ? " [cis]"
          : isQTLInTrans(variant, phenos[0], cisWindow)
          ? " [trans]"
          : "";
      return (
        <PhenoTooltip
          resource={resource}
          phenos={phenos}
          row={row}
          content=<span>
            {row.count == 1 ? row.phenostring : row.phenostring + " (" + row.count + ")"}
            {qtlNote}
          </span>
        />
      );
    },
    header: "trait",
    filterFn: filterContainsWithTooltip,
    muiFilterTextFieldProps: { placeholder: "trait" },
  },
  {
    accessorFn: (row) => {
      const phenos = row.phenocode.map((phenocode) => phenoMap[row.resource + ":" + phenocode]);
      const resource = meta.assoc.resources.find((r) => r.resource == phenos[0].resource)!;
      return row.ld[0] && !row.lead[0] ? (
        <AssocPValLDTooltip
          variant={variant!}
          phenos={phenos}
          resource={resource}
          row={row}
          content={
            <span style={{ textDecoration: "underline dotted" }}>{pValRepr(row.mlog10p[0])}</span>
          }
        />
      ) : (
        <span>{pValRepr(row.mlog10p[0])}</span>
      );
    },
    id: "mlog10p",
    header: "p-value",
    sortingFn: "naInfSort",
    sortDescFirst: true,
    filterFn: "lessThan",
    muiFilterTextFieldProps: { placeholder: "filter" },
    size: 60,
  },
  {
    accessorFn: (row) => <UpOrDownIcon value={row.beta[0]} withValue precision={3} />,
    id: "beta",
    header: "beta",
    sortingFn: "naInfSort",
    sortDescFirst: true,
    filterFn: filterAbsGreaterThanHTML,
    muiFilterTextFieldProps: { placeholder: "filter" },
    size: 60,
  },
];
