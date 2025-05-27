import { MaterialReactTable, MRT_ColumnDef } from "material-react-table";

import { naInfSort, variantSort } from "../utils/sorting";
import { TissueSummaryTableRow, TableData } from "../../../types/types";
import { useMemo, useState } from "react";
import { getTissueSummaryTableColumns } from "./TissueSummaryTable.columns";
import { useDataStore } from "../../../store/store";
import { useServerQuery } from "../../../store/serverQuery";
import { summarizeTissues } from "../../../store/munge";
import VariantMainTable from "./VariantMainTable";
import TissueExportToolbar from "../TissueExportToolbar";

const TissueSummaryTable = (props: {}) => {
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 20,
  });

  const clientData: TableData = useDataStore((state) => state.clientData)!;
  const selectedPopulation: string | undefined = useDataStore((state) => state.selectedPopulation);

  const { isError, isFetching, isLoading } = useServerQuery(
    useDataStore((state) => state.variantInput)!
  );

  const summaryData = useMemo(() => summarizeTissues(clientData), [clientData]);
  const columns = useMemo<MRT_ColumnDef<TissueSummaryTableRow>[]>(() => {
    return getTissueSummaryTableColumns();
  }, [summaryData]);

  return (
    <MaterialReactTable
      data={summaryData}
      columns={columns}
      renderTopToolbarCustomActions={({ table }) => (
        <TissueExportToolbar summaryData={summaryData} selectedPopulation={selectedPopulation} />
      )}
      enableTopToolbar={true}
      enableColumnFilters={true}
      initialState={{
        showColumnFilters: true,
        density: "compact",
        sorting: [{ id: "total", desc: true }],
      }}
      localization={{
        noRecordsToDisplay:
          "No records to display, make sure you have QTL associations toggled above",
      }}
      renderDetailPanel={({ row }) => (
        <VariantMainTable
          data={row.original.qtlAssocs}
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

export default TissueSummaryTable;
