import QueryVariantInfo from "../input/QueryVariantInfo";
import InputForm from "../input/InputForm";
import { useDataStore } from "../../store/store";
import { Box, CircularProgress, Tab, Tabs, Tooltip, Typography } from "@mui/material";
import TabPanel from "@mui/lab/TabPanel";
import { TabContext } from "@mui/lab";
import GlobalControlContainer from "../controls/GlobalControlContainer";
import { useNormalizedQuery } from "../../store/serverQuery";
import { lazy, Suspense, useEffect } from "react";

// import factories kept named so we can BOTH lazy() them and preload the chunks (see the preload
// effect): warming the chunks means the first switch to a tab doesn't flash the Suspense fallback,
// which otherwise collapses the panel height and jolts the scroll position (settles once cached).
const importVariantMainTable = () => import("./tables/VariantMainTable");
const importDataTypeTable = () => import("./tables/DataTypeTable.normalized");
const importPhenotypeSummaryTable = () => import("./tables/PhenotypeSummaryTable.normalized");
const importTissueSummaryTable = () => import("./tables/TissueSummaryTable.normalized");
const importPhenotypeSearch = () => import("../phenoSearch/PhenotypeSearchContainer");

const VariantMainTable = lazy(importVariantMainTable);
const DataTypeTable = lazy(importDataTypeTable);
const PhenotypeSummaryTable = lazy(importPhenotypeSummaryTable);
const TissueSummaryTable = lazy(importTissueSummaryTable);
const PhenotypeSearchContainer = lazy(importPhenotypeSearch);

const TableContainer = () => {
  const activeTab = useDataStore((state) => state.activeTab);
  const setActiveTab = useDataStore((state) => state.setActiveTab);
  const setNormalizedData = useDataStore((state) => state.setNormalizedData);
  const normalizedData = useDataStore((state) => state.normalizedData);
  const variantInput = useDataStore((state) => state.variantInput);
  // stage-1 fetch from the BFF; stage-2 filtering happens client-side in the store (refactor.md §1)
  const { data } = useNormalizedQuery(variantInput);
  useEffect(() => {
    if (data) {
      setNormalizedData(data);
    }
  }, [data]);

  // warm the other tabs' lazy chunks in the background so the first switch to a tab renders the real
  // content immediately instead of flashing the Suspense spinner (which collapses the panel and makes
  // the page scroll jump before settling). harmless if already loaded — import() returns the cache.
  useEffect(() => {
    importDataTypeTable();
    importPhenotypeSummaryTable();
    importTissueSummaryTable();
    importPhenotypeSearch();
  }, []);

  // tabs unlock once stage-1 data has arrived; filteredVariants is then derived reactively
  const hasData = normalizedData !== undefined;

  const handleTabChange = (event: React.SyntheticEvent, newValue: string) => {
    setActiveTab(newValue);
  };

  const isVariantPage = window.location.pathname.startsWith("/annotate");

  // a lazy tab chunk suspends for one frame even when preloaded; a bare spinner collapses the panel
  // to ~40px, which clamps the scroll upward and back (the "jump"). reserve panel-sized height so the
  // document height doesn't change while the (preloaded, ~instant) fallback shows.
  const tabFallback = (
    <Box sx={{ display: "flex", justifyContent: "center", pt: 6, minHeight: "100vh" }}>
      <CircularProgress />
    </Box>
  );

  return (
    <>
      {isVariantPage && (
        // top-level nav menu: the current section in bold, the other views as menu links. Gene view
        // and LD lookup are not ready yet — greyed out and disabled with a "coming soon" tooltip.
        <Box
          sx={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 2.5,
            mt: 3,
            mb: "20px",
            pb: 1,
            borderBottom: 1,
            borderColor: "divider",
          }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Variant table
          </Typography>
          {[
            { label: "Gene view" },
            { label: "LD lookup" },
          ].map((item) => (
            <Tooltip key={item.label} title="Coming soon">
              <Typography
                variant="h6"
                aria-disabled="true"
                sx={{ color: "text.disabled", cursor: "not-allowed" }}>
                {item.label}
              </Typography>
            </Tooltip>
          ))}
        </Box>
      )}
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
              <Tab
                value="phenotype_search"
                label="single phenotype sumstats"
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
                  Use the arrows on the left of each variant to expand it and see all credible sets
                  it's in.
                </Typography>
                <Suspense fallback={tabFallback}>
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
                <Suspense fallback={tabFallback}>
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
                  Expand a row to see those variants, or use the arrow before a trait to look up its
                  full summary statistics across all your variants.
                </Typography>
                <Suspense fallback={tabFallback}>
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
                <Suspense fallback={tabFallback}>
                  <Box sx={{ paddingLeft: "20px", paddingRight: "20px" }}>
                    <TissueSummaryTable />
                  </Box>
                </Suspense>
              </Box>
            </TabPanel>
            <TabPanel value="phenotype_search" sx={{ padding: 0 }}>
              <Box display="flex" flexDirection="column" sx={{ paddingTop: "10px" }}>
                <Typography sx={{ marginBottom: "10px", paddingLeft: "20px", fontWeight: "bold" }}>
                  Single phenotype sumstats
                </Typography>
                <Typography sx={{ marginBottom: "10px", paddingLeft: "20px" }}>
                  Look up full summary statistics for your input variants for any one phenotype
                  with summary stats available, and see which variants are in a credible set for it.
                </Typography>
                <Suspense fallback={tabFallback}>
                  <Box sx={{ paddingLeft: "20px", paddingRight: "20px" }}>
                    <PhenotypeSearchContainer />
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
