import { MaterialReactTable, MRT_ColumnDef } from "material-react-table";

import { naInfSort, variantSort } from "../utils/sorting";
import { PhenoSummaryTableRow, TableData } from "../../../types/types";
import { useMemo, useState } from "react";
import { getPhenoSummaryTableColumns } from "./PhenotypeSummaryTable.columns";
import PhenoExportToolbar from "../PhenoExportToolbar";
import { useDataStore } from "../../../store/store";
import { useServerQuery } from "../../../store/serverQuery";
import { summarizePhenotypes } from "../../../store/munge";
import VariantMainTable from "./VariantMainTable";

const PhenotypeSummaryTable = (props: {}) => {
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 20,
  });

  const clientData: TableData = useDataStore((state) => state.clientData)!;

  const { isError, isFetching, isLoading } = useServerQuery(
    useDataStore((state) => state.variantInput)!
  );

  const summaryData = useMemo(() => summarizePhenotypes(clientData), [clientData]);
  const columns = useMemo<MRT_ColumnDef<PhenoSummaryTableRow>[]>(() => {
    return getPhenoSummaryTableColumns(
      clientData.phenos,
      clientData.datasets,
      clientData.meta,
      clientData.has_betas
    );
  }, [summaryData]);

  return (
    <MaterialReactTable
      data={summaryData}
      columns={columns}
      enableTopToolbar={true}
      renderTopToolbarCustomActions={({ table }) => <PhenoExportToolbar />} //table={table} />}
      enableColumnFilters={true}
      initialState={{
        showColumnFilters: true,
        density: "compact",
        sorting: [{ id: "total", desc: true }],
      }}
      renderDetailPanel={({ row }) => (
        <VariantMainTable
          phenotype={row.original.pheno}
          showTraitCounts={false}
          enableTopToolbar={false}
        />
      )}
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
      muiToolbarAlertBannerProps={
        isError
          ? {
              color: "error",
              //@ts-ignore
              children: props.error.response?.data?.message || props.error.message,
            }
          : undefined
      }
      muiPaginationProps={{
        rowsPerPageOptions: [10, 20, 100, 1000],
      }}
      onPaginationChange={setPagination}
      state={{
        isLoading: isLoading,
        showAlertBanner: isError,
        showProgressBars: isFetching,
        pagination,
      }}
      sortingFns={{
        naInfSort,
        variantSort,
      }}
      enableGlobalFilter={false}
    />
  );
};

export default PhenotypeSummaryTable;
