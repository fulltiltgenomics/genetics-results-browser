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
const About = lazy(() => import("./features/page/About"));
const ChangeLog = lazy(() => import("./features/page/ChangeLog"));
const LDContainer = lazy(() => import("./features/LDContainer"));

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
                  <Route path="/" element={<TableContainer />} />
                  <Route path="/gene" element={<GeneContainer />} />
                  <Route path="/gene/:geneName" element={<GeneContainer />} />
                  <Route path="/ld" element={<LDContainer />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/changelog" element={<ChangeLog />} />
                </Routes>
              </Suspense>
            </Box>
          </AuthProvider>
        </ThemeProvider>
      </QueryProvider>
    </BrowserRouter>
  );
};
