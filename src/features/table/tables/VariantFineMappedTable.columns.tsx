import type { MRT_ColumnDef } from "material-react-table";
import { PhenoMap, GroupedFineMappedRecord, DatasetMap } from "../../../types/types";
import { filterAbsGreaterThanHTML, filterContainsWithTooltip, pValRepr } from "../utils/tableutil";
import { HtmlTooltip } from "../../tooltips/HtmlTooltip";
import { UpOrDownIcon } from "../UpDownIcons";

export const getFineMappingTableColumns = (
  phenoMap: PhenoMap,
  datasetMap: DatasetMap
): MRT_ColumnDef<GroupedFineMappedRecord>[] => [
  {
    accessorKey: "data_type",
    header: "type",
    filterFn: "contains",
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
      return row.count == 1
        ? datasetName.replace(/_/g, " ")
        : datasetName.replace(/_/g, " ") + " (" + row.count + ")";
    },
    id: "dataset",
    header: "dataset",
    filterFn: filterContainsWithTooltip,
    //filterVariant: 'multi-select',
    //filterSelectOptions: data.finemapped.datasets,
    muiFilterTextFieldProps: { placeholder: "dataset" },
    size: 150,
  },
  {
    accessorFn: (row) => phenoMap[row.resource + ":" + row.phenocode]?.phenostring ?? "unknown",
    // TODO PhenoTooltip
    // accessorFn: (row) => {
    //   const phenos = row.assoc.groupedData[0].phenocode.map(
    //     (phenocode) => data.phenos[row.assoc.groupedData[0].resource + ":" + phenocode]
    //   );
    //   const resource = data.meta.assoc.resources.find((r) => r.id == phenos[0].resource) || null;
    //   return (
    //     <PhenoTooltip
    //       resource={resource}
    //       phenos={phenos}
    //       row={row.assoc.groupedData[0]}
    //       content=<span style={phenos[0].is_na ? { color: "gray" } : {}}>
    //         {row.assoc.groupedData[0].count == 1
    //           ? row.assoc.groupedData[0].phenostring
    //           : row.assoc.groupedData[0].phenostring +
    //             " (" +
    //             row.assoc.groupedData[0].count +
    //             ")"}
    //       </span>
    //     />
    //   );
    // },
    header: "trait",
    filterFn: "contains",
    muiFilterTextFieldProps: { placeholder: "trait" },
  },
  {
    accessorFn: (row) => pValRepr(row.mlog10p[0]),
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
  {
    //TODO sorting
    accessorFn: (row) => {
      const ttTableRows = row.phenocode.map((phenocode, i) => (
        <tr key={phenocode}>
          <td>{phenocode}</td>
          <td style={{ textAlign: "center" }}>{row.cs_size[i]}</td>
          <td style={{ textAlign: "center" }}>{row.cs_min_r2[i]}</td>
          <td>{row.pip[i].toPrecision(3)}</td>
        </tr>
      ));
      return (
        <HtmlTooltip
          title={
            <>
              <table>
                <thead>
                  <tr>
                    <th style={{ fontWeight: "bold", textAlign: "start" }}>molecular trait</th>
                    <th style={{ fontWeight: "bold", textAlign: "start" }}>cs size</th>
                    <th style={{ fontWeight: "bold", textAlign: "start" }}>cs min r2</th>
                    <th style={{ fontWeight: "bold", textAlign: "start" }}>PIP</th>
                  </tr>
                </thead>
                <tbody>{ttTableRows}</tbody>
              </table>
            </>
          }>
          <span>{row.max_pip.toPrecision(3)}</span>
        </HtmlTooltip>
      );
    },
    id: "pip",
    header: "PIP",
    sortingFn: "naInfSort",
    sortDescFirst: true,
    filterFn: filterAbsGreaterThanHTML,
    muiFilterTextFieldProps: { placeholder: "filter" },
    size: 75,
  },
];
