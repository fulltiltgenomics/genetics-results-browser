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

  const isGenePage = window.location.pathname.startsWith("/gene");
  const isVariantPage =
    window.location.pathname == "/" || window.location.pathname.startsWith("/q=");

  return (
    <>
      <Box display="flex" flexDirection="row" gap={2} style={{ marginBottom: "20px" }}>
        {isVariantPage && (
          <>
            <Typography variant="h6">Variants</Typography>
            <Box
              sx={{ display: "flex", alignItems: "center", cursor: "pointer" }}
              onClick={() => navigate("/gene")}>
              <Typography variant="h6" style={{ color: theme.palette.primary.main }}>
                Gene
              </Typography>
              <Typography
                component="span"
                sx={{
                  fontSize: "0.7em",
                  backgroundColor: "primary.main",
                  color: "white",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  marginLeft: "4px",
                }}>
                beta
              </Typography>
            </Box>
          </>
        )}
        {isGenePage && (
          <>
            <Typography
              variant="h6"
              style={{ cursor: "pointer", color: theme.palette.primary.main }}
              onClick={() => navigate("/")}>
              Variants
            </Typography>
            <Typography variant="h6">Gene</Typography>
            <Typography
              component="span"
              sx={{
                fontSize: "0.7em",
                backgroundColor: "primary.main",
                color: "white",
                padding: "2px 6px",
                borderRadius: "4px",
                marginLeft: "4px",
              }}>
              beta
            </Typography>
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
                        <Link href="/?q=MwWgLArAHAjLEE4QHEQEECQB2AdAJgQFEQAGGDAZwFMA3AKD1BggDYS88YsQAVEAYQwgWOCCWJlKAVwoBjOkk54SLNiwEoMYHGBYTy1ejCQwSwCHjBg8KARmA4oefZVp11YZspZgStzA7A4qQGblzgCFAswHhsGph4OAgwLoZ0xuBYXKp+aJqJvqluoJBYCMAIeBD+GIlmqTLyMCDMFuzlYLx2LUkQRfScIMAxwFjRSHnIGDCOUP0MzcMdUFY1M2Xz6jFZVhxdgj2q8zDNMJwIF82oPEIz0cfqUMkILJZIqJgzYsdMZ1Cw1m4-F40xwwDmIVc9C2JycLGg6E0PTg8xsbDAUBIkFAk1uOBgekhaU6pg4LCwEAsGhuMxgYAacjonSqwDOoxsuNpwGO3Eg0TEkRqyOcRLcJggZWg5lsNPxKVFRkWVkxYAQ1WBNx6JCICqZLRI0AQWCe6g+ePYxz8ZSNWBUV3QGAQoh17AwADsmsynggSOwoIipiAnZAJHhpIyzi0YqwIODuHwDk6OKGoQoo9twTBQBqhE6CSmKI06NUs5ZPHgKftHTgVAWwjYTgQOBT-QmMFAkoTXWkMhjbXh-v7UAcO1h6aQw4WI8JVWAdtxrkJR-Lu2EkGJRuVXlWO-C6wNmp456YWPbMCAO4h9+4QAQEHPVc0cxedC7J25uBTXs31Pw8oIOwqFMPT1KorDGMwhUArt33obhTF9bYMhzDss2vf02AgLNyxqXACGvJBhmsLCohQHg0DQYEpjwmD3XkbgOCgCAMRYVtulwM5r2aLAxygYAwHBXCa1onskEgKIjWSdAeD4TBcCxa8mDIHxjWYoUREpAsiy2IIAX46kMAgHBT2Apo-EbI0wP9YFzyM0ZrxsWJT1YsQZS0HAxi48BWIQwU23AYy31TcIKguP0kCo9ySAhV0QIyf4XjVTozUSH0tOnVoCQIIIhUSJ5TLoJg1R46KsBsNtEj3Uhw1kPA6CAA">
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
