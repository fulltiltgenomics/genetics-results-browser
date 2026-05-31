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

// placeholder for the summary tabs still on the legacy data path (migrated in .19/.20/.21).
const MigratingPlaceholder = ({ title }: { title: string }) => (
  <Box display="flex" flexDirection="column" sx={{ paddingTop: "10px" }}>
    <Typography sx={{ marginBottom: "10px", paddingLeft: "20px", fontWeight: "bold" }}>
      {title}
    </Typography>
    <Typography sx={{ paddingLeft: "20px", fontStyle: "italic" }}>
      This view is being migrated to the new credible-set data and is temporarily unavailable.
    </Typography>
  </Box>
);

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
            {/* these tabs are migrated to the normalized data path in separate tasks (.19/.20/.21).
                until then show a placeholder instead of the legacy clientData-driven tables, which
                would crash now that the normalized path no longer populates clientData. */}
            <TabPanel value="datatypes" sx={{ padding: 0 }}>
              <MigratingPlaceholder title="Data type comparison" />
            </TabPanel>
            <TabPanel value="summary" sx={{ padding: 0 }}>
              <MigratingPlaceholder title="Phenotype summary" />
            </TabPanel>
            <TabPanel value="tissue_summary" sx={{ padding: 0 }}>
              <MigratingPlaceholder title="Tissue and cell type summary" />
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
