import QueryVariantInfo from "../input/QueryVariantInfo";
import InputForm from "../input/InputForm";
import { useDataStore } from "../../store/store";
import { Box, CircularProgress, Tab, Tabs, Typography, useTheme } from "@mui/material";
import TabPanel from "@mui/lab/TabPanel";
import { TabContext } from "@mui/lab";
import GlobalControlContainer from "../controls/GlobalControlContainer";
import { useNormalizedQuery } from "../../store/serverQuery";
import { lazy, Suspense, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const VariantMainTable = lazy(() => import("./tables/VariantMainTable"));
const DataTypeTable = lazy(() => import("./tables/DataTypeTable.normalized"));
const PhenotypeSummaryTable = lazy(() => import("./tables/PhenotypeSummaryTable.normalized"));
const TissueSummaryTable = lazy(() => import("./tables/TissueSummaryTable.normalized"));

const TableContainer = () => {
  const activeTab = useDataStore((state) => state.activeTab);
  const setActiveTab = useDataStore((state) => state.setActiveTab);
  const setNormalizedData = useDataStore((state) => state.setNormalizedData);
  const normalizedData = useDataStore((state) => state.normalizedData);
  const variantInput = useDataStore((state) => state.variantInput);
  const navigate = useNavigate();
  const theme = useTheme();
  // stage-1 fetch from the BFF; stage-2 filtering happens client-side in the store (refactor.md §1)
  const { data } = useNormalizedQuery(variantInput);
  useEffect(() => {
    if (data) {
      setNormalizedData(data);
    }
  }, [data]);

  // tabs unlock once stage-1 data has arrived; filteredVariants is then derived reactively
  const hasData = normalizedData !== undefined;

  const handleTabChange = (event: React.SyntheticEvent, newValue: string) => {
    setActiveTab(newValue);
  };

  const isVariantPage = window.location.pathname.startsWith("/annotate");

  return (
    <>
      <Box display="flex" flexDirection="row" gap={2} style={{ marginBottom: "20px" }}>
        {isVariantPage && (
          <>
            <Typography variant="h6">Variant table</Typography>
            <Box
              sx={{ display: "flex", alignItems: "center", cursor: "pointer" }}
              onClick={() => navigate("/gene")}>
              <Typography variant="h6" style={{ color: theme.palette.primary.main }}>
                Gene view
              </Typography>
            </Box>
            <Box
              sx={{ display: "flex", alignItems: "center", cursor: "pointer" }}
              onClick={() => navigate("/ld")}>
              <Typography variant="h6" style={{ color: theme.palette.primary.main }}>
                LD lookup
              </Typography>
            </Box>
          </>
        )}
      </Box>
      <InputForm />
      {variantInput !== undefined ? (
        <>
          <QueryVariantInfo />
          <GlobalControlContainer />
          <TabContext value={activeTab}>
            <Tabs value={activeTab} onChange={handleTabChange} aria-label="table_selection_tabs">
              <Tab value="variants" label="variant results" disabled={!hasData} />
              <Tab value="datatypes" label="data type comparison" disabled={!hasData} />
              <Tab value="summary" label="phenotype summary" disabled={!hasData} />
              <Tab
                value="tissue_summary"
                label="tissue and cell type summary"
                disabled={!hasData}
              />
            </Tabs>
            <TabPanel value="variants" sx={{ padding: 0 }}>
              <Box display="flex" flexDirection="column" sx={{ paddingTop: "10px" }}>
                <Typography sx={{ marginBottom: "10px", paddingLeft: "20px", fontWeight: "bold" }}>
                  Variant results
                </Typography>
                <Typography sx={{ marginBottom: "10px", paddingLeft: "20px" }}>
                  This table shows annotations and the credible sets each of your input variants is
                  a member of, across all phenotypes and QTLs.
                  <br />
                  Use the arrows on the left of each variant to expand it and see all of its
                  credible-set / fine-mapping results.
                </Typography>
                <Suspense fallback={<CircularProgress />}>
                  <VariantMainTable enableTopToolbar={true} showTraitCounts={true} />
                </Suspense>
              </Box>
            </TabPanel>
            <TabPanel value="datatypes" sx={{ padding: 0 }}>
              <Box display="flex" flexDirection="column" sx={{ paddingTop: "10px" }}>
                <Typography sx={{ marginBottom: "10px", paddingLeft: "20px", fontWeight: "bold" }}>
                  Data type comparison
                </Typography>
                <Typography sx={{ marginBottom: "10px", paddingLeft: "20px" }}>
                  For each input variant, the number of credible sets it is a member of, broken down
                  by data type. Expand a row to see all of that variant's credible sets.
                </Typography>
                <Suspense fallback={<CircularProgress />}>
                  <DataTypeTable enableTopToolbar={true} />
                </Suspense>
              </Box>
            </TabPanel>
            <TabPanel value="summary" sx={{ padding: 0 }}>
              <Box display="flex" flexDirection="column" sx={{ paddingTop: "10px" }}>
                <Typography sx={{ marginBottom: "10px", paddingLeft: "20px", fontWeight: "bold" }}>
                  Phenotype summary
                </Typography>
                <Typography sx={{ marginBottom: "10px", paddingLeft: "20px" }}>
                  Traits ranked by how many of your input variants are in a credible set for them.
                  Expand a row to see those variants, or use the search button to look up full
                  summary statistics for the trait across all your variants.
                </Typography>
                <Suspense fallback={<CircularProgress />}>
                  <PhenotypeSummaryTable />
                </Suspense>
              </Box>
            </TabPanel>
            <TabPanel value="tissue_summary" sx={{ padding: 0 }}>
              <Box display="flex" flexDirection="column" sx={{ paddingTop: "10px" }}>
                <Typography sx={{ marginBottom: "10px", paddingLeft: "20px", fontWeight: "bold" }}>
                  Tissue and cell type summary
                </Typography>
                <Typography sx={{ marginBottom: "10px", paddingLeft: "20px" }}>
                  Tissues / cell types ranked by how many of your input variants are in a QTL
                  credible set there. Use the toggle to switch between eQTL and caQTL.
                </Typography>
                <Suspense fallback={<CircularProgress />}>
                  <Box sx={{ paddingLeft: "20px", paddingRight: "20px" }}>
                    <TissueSummaryTable />
                  </Box>
                </Suspense>
              </Box>
            </TabPanel>
          </TabContext>
        </>
      ) : (
        <></>
      )}
    </>
  );
};

export default TableContainer;
