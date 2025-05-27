import QueryVariantInfo from "../input/QueryVariantInfo";
import InputForm from "../input/InputForm";
import { useDataStore } from "../../store/store";
import { Box, CircularProgress, Link, Tab, Tabs, Typography, useTheme } from "@mui/material";
import TabPanel from "@mui/lab/TabPanel";
import { TabContext } from "@mui/lab";
import GlobalControlContainer from "../controls/GlobalControlContainer";
import { useServerQuery } from "../../store/serverQuery";
import { lazy, Suspense, useEffect } from "react";
import { renderPThreshold } from "./utils/tableutil";
import { useNavigate } from "react-router-dom";

const VariantMainTable = lazy(() => import("./tables/VariantMainTable"));
const PhenotypeSummaryTable = lazy(() => import("./tables/PhenotypeSummaryTable"));
const DataTypeTable = lazy(() => import("./tables/DataTypeTable"));
const TissueSummaryTable = lazy(() => import("./tables/TissueSummaryTable"));
const PopulationSummaryTable = lazy(() => import("./tables/PopulationSummaryTable"));

const TableContainer = () => {
  const activeTab = useDataStore((state) => state.activeTab);
  const setActiveTab = useDataStore((state) => state.setActiveTab);
  const setServerData = useDataStore((state) => state.setServerData);
  const clientData = useDataStore((state) => state.clientData);
  const pThreshold = useDataStore((state) => state.pThreshold);
  const variantInput = useDataStore((state) => state.variantInput);
  const navigate = useNavigate();
  const theme = useTheme();
  // set data state when the result from the query or cache updates
  const { data } = useServerQuery(variantInput);
  useEffect(() => {
    if (data) {
      setServerData(data);
    }
  }, [data]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: string) => {
    setActiveTab(newValue);
  };

  const isVariantPage =
    window.location.pathname == "/" || window.location.pathname.startsWith("/q=");

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
              <Tab value="variants" label="variant results" disabled={clientData === undefined} />
              <Tab
                value="datatypes"
                label="data type comparison"
                disabled={clientData === undefined}
              />
              <Tab value="summary" label="phenotype summary" disabled={clientData === undefined} />
              <Tab
                value="tissue_summary"
                label="tissue and cell type summary"
                disabled={clientData === undefined}
              />
            </Tabs>
            <TabPanel value="variants" sx={{ padding: 0 }}>
              <Box display="flex" flexDirection="column" sx={{ paddingTop: "10px" }}>
                <Typography sx={{ marginBottom: "10px", paddingLeft: "20px", fontWeight: "bold" }}>
                  Variant results
                </Typography>
                <Typography sx={{ marginBottom: "10px", paddingLeft: "20px" }}>
                  This table shows annotations, number of trait associations with p-value less than{" "}
                  {renderPThreshold(clientData!, pThreshold)}, and top association statistics for
                  each of your input variants.
                  <br />
                  You can toggle GWAS, eQTL etc. associations with the switches above.
                  <br />
                  Use the arrows on the left of each variant to expand that variant and see all of
                  its associations and fine-mapping results.
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
                  This table shows numbers of trait associations with p-value less than{" "}
                  {renderPThreshold(clientData!, pThreshold)}, and top association for each of your
                  input variants for each of GWAS, eQTL and pQTL data types.
                  <br />
                  Use the arrows on the left of each variant to expand that variant and see all of
                  its associations and fine-mapping results.
                </Typography>
                <Suspense fallback={<CircularProgress />}>
                  <DataTypeTable enableTopToolbar={true} showTraitCounts={true} />
                </Suspense>
              </Box>
            </TabPanel>
            <TabPanel value="summary" sx={{ padding: 0 }}>
              <Box display="flex" flexDirection="row">
                <Box flex="5" display="flex" flexDirection="column" sx={{ paddingTop: "10px" }}>
                  <Typography
                    sx={{ marginBottom: "10px", paddingLeft: "20px", fontWeight: "bold" }}>
                    Phenotype summary
                  </Typography>
                  <Typography sx={{ marginBottom: "10px", paddingLeft: "20px" }}>
                    This table shows the number of your input variants associated with each trait
                    with a p-value less than {renderPThreshold(clientData!, pThreshold)}.
                    <br />
                    You can toggle GWAS, eQTL etc. associations with the switches above.
                    <br />
                    Use the arrows on the left of each trait to expand that trait and see all your
                    input variants that are associated with it.
                    {clientData?.has_betas ? null : (
                      <>
                        <br />
                        If you paste effect size betas with your input variants, the table will also
                        show the number of variants with
                        <br />
                        consistent and opposite effect direction (try the{" "}
                        <Link href="/?q=IwWgLAbAHMAMsE4ogCogMIEhwDoIIFERYAmTAZwFMA3AKFAjATAHZhWQBxVbKHNoqQo16IFizBQAzGCnJuAQUwscsCILJU6oYAFZdwCCQRTYXEEpAkcUQsTIA7AMai9ukqRNhUGbMBwIuoLAwnQkVhAQhlC6ZtwomGD86vahtOEQsJJZulIWXH44hsFpeWC6LCYIJLrmStawUiXkAK7kLmW6MDC6CHXKOMbNInlwhqwx3orYEDj6GhRtHSDAgeKwUCzhaFjWEEHEi+203jVSwCRSW-mcmP7ATcQhWidWumCsmXnTIHxSKUIXt44CQSBAWPpwugePcwM0lq84F0ECxbBB+itVCRhnRag8SB8LhCfFgEKoAZoROjjMwJAhQNCEr8cEwFi90edgFAwV0boUuTjaBySGwPqCSYVIoKOaYYLJvIzMLo8MAFs4heA9B5GHELJgpDhTIKWFYSJMoNAJWIitjUi8TRCjKCWOj0ApfH87EJ1Sa4PApCLVhgeHwHmyRMhMgYZBd+iohnaRH09JUulJavE7kVVU80n0SBc1JlXQUkpBBX0pDIalz0ZwUAoFNDbvGKZh1cmqyK5A9g0yycU7Qi4GIECiWGpQNMyb01S4R8ALiiapJg5ZlVdw9odAWx-TzEz-BBHrBniJFyAZNkmLVFZjEILY4vjM7eTtMHwEG2Xk+A7p9nIJrviAZKglu9CjBcUByiKfZZnIj6nLYCDwGafIgSyByAsO6K2KsRhMP0-ixI+JpSHupC2MGtxJBsc70Ca5THrESAYvctqnmkwCMUgx5gmY0L1AEOacT+fSsNxkRmO6tzWGAsCPn00FfoEUx6tYKFssOyaNO4YrmFgBrcop4BdPglSgAoKBoEoKhZOBQaSBOZrQQZvD8HCQ7HEGsRXCYRgSnw+zgQWl4Blcx59DJWbQYKoVVl4UAfER-BemeYSgGA7BsJOGJ8LOiZhKM-6kAWQG+CAswkbmrTHEAA">
                          COVID-19 all lead variants
                        </Link>{" "}
                        input example).
                      </>
                    )}
                  </Typography>
                  <Suspense fallback={<CircularProgress />}>
                    <PhenotypeSummaryTable />
                  </Suspense>
                </Box>
                <Box
                  flex="1"
                  display="flex"
                  flexDirection="column"
                  sx={{ paddingTop: "10px", paddingLeft: "10px" }}>
                  <Typography sx={{ marginBottom: "10px", fontWeight: "bold" }}>
                    Population allele frequencies
                  </Typography>
                  <Typography sx={{ marginBottom: "10px" }}>
                    This table shows the number of input variants with maximum or minimum
                    <br />
                    allele frequency in each gnomAD population.
                    <br />
                    {clientData?.has_betas ? null : (
                      <>
                        <br />
                        <br />
                      </>
                    )}
                    &nbsp;
                  </Typography>
                  <Suspense fallback={<CircularProgress />}>
                    <PopulationSummaryTable />
                  </Suspense>
                </Box>
              </Box>
            </TabPanel>
            <TabPanel value="tissue_summary" sx={{ padding: 0 }}>
              <Box display="flex" flexDirection="row">
                <Box flex="5" display="flex" flexDirection="column" sx={{ paddingTop: "10px" }}>
                  <Typography
                    sx={{ marginBottom: "10px", paddingLeft: "20px", fontWeight: "bold" }}>
                    Tissue and cell type summary
                  </Typography>
                  <Typography sx={{ marginBottom: "10px", paddingLeft: "20px" }}>
                    This table shows the number of your input variants that are QTLs for at least
                    one gene with a p-value less than {renderPThreshold(clientData!, pThreshold)} in
                    each tissue or cell type. For eQTL Catalogue only gene expression (ge) eQTLs are
                    counted.
                    <br />
                    You can toggle different QTL associations with the switches above.
                    <br />
                    Use the arrows on the left of each cell type to expand it and see variants that
                    are a QTL for that cell type.
                  </Typography>
                  <Suspense fallback={<CircularProgress />}>
                    <TissueSummaryTable />
                  </Suspense>
                </Box>
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
