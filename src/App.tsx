import { lazy, Suspense, useMemo } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { indigo, pink } from "@mui/material/colors";
import Header from "./features/page/Header";
import CircularProgress from "@mui/material/CircularProgress"; // Import a component for fallback
import { Box, useMediaQuery } from "@mui/material";
import GeneContainer from "./features/GeneContainer";
import { useThemeStore } from "./store/store.theme";
import { AuthProvider } from "./features/auth/AuthProvider";
import { QueryProvider } from "./features/auth/QueryClientProvider";
const TableContainer = lazy(() => import("./features/table/TableContainer"));
const PhenotypeSearchContainer = lazy(
  () => import("./features/phenoSearch/PhenotypeSearchContainer")
);
const About = lazy(() => import("./features/page/About"));
const ChangeLog = lazy(() => import("./features/page/ChangeLog"));
const LDContainer = lazy(() => import("./features/LDContainer"));
const PhenotypeContainer = lazy(() => import("./features/phenotype/PhenotypeContainer"));
const ChatPage = lazy(() => import("./features/chat/ChatPage"));
const AdminPage = lazy(() => import("./features/admin/AdminPage"));

export const App = () => {
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
  const { isDarkMode } = useThemeStore();
  const isActualDarkMode = isDarkMode ?? prefersDarkMode;

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          primary: indigo,
          secondary: pink,
          mode: isActualDarkMode ? "dark" : "light",
        },
        typography: {
          body1: {
            fontSize: 12,
          },
          fontSize: 12,
        },
      }),
    [isDarkMode]
  );

  return (
    <BrowserRouter>
      <QueryProvider>
        <ThemeProvider theme={theme}>
          <CssBaseline enableColorScheme />
          <AuthProvider>
            <Box p={1.5}>
              <Header />
              <Suspense fallback={<CircularProgress />}>
                <Routes>
                  <Route path="/" element={<ChatPage />} />
                  {/* variant annotation tool moved off / to /annotate; ChatPage owns / (refactor.md §3) */}
                  <Route path="/annotate" element={<TableContainer />} />
                  {/* phenotype-search view: full sumstats for input variants × a chosen phenotype (refactor.md §5) */}
                  <Route
                    path="/annotate/phenotype-search"
                    element={<PhenotypeSearchContainer />}
                  />
                  <Route path="/gene" element={<GeneContainer />} />
                  <Route path="/gene/:geneName" element={<GeneContainer />} />
                  <Route path="/ld" element={<LDContainer />} />
                  <Route path="/chat" element={<ChatPage />} />
                  <Route path="/chat/:sessionId" element={<ChatPage />} />
                  <Route path="/phenotype" element={<PhenotypeContainer />} />
                  <Route path="/phenotype/:phenocode" element={<PhenotypeContainer />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/changelog" element={<ChangeLog />} />
                  <Route path="/admin" element={<AdminPage />} />
                </Routes>
              </Suspense>
            </Box>
          </AuthProvider>
        </ThemeProvider>
      </QueryProvider>
    </BrowserRouter>
  );
};
