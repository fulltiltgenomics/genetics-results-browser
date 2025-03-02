import { lazy, Suspense, useMemo } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { indigo, pink } from "@mui/material/colors";
import Header from "./features/page/Header";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CircularProgress from "@mui/material/CircularProgress"; // Import a component for fallback
import { Box } from "@mui/material";
import GeneContainer from "./features/GeneContainer";

const TableContainer = lazy(() => import("./features/table/TableContainer"));
const About = lazy(() => import("./features/page/About"));
const ChangeLog = lazy(() => import("./features/page/ChangeLog"));

export const App = () => {
  //TODO dark/light mode
  const prefersDarkMode = true; //useMediaQuery('(prefers-color-scheme: dark)');

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          primary: indigo,
          secondary: pink,
          mode: prefersDarkMode ? "dark" : "light",
        },
        typography: {
          body1: {
            fontSize: 12,
          },
          fontSize: 12,
        },
      }),
    [prefersDarkMode]
  );

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
        retry: false,
      },
    },
  });

  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <CssBaseline enableColorScheme />
          <Box p={1.5}>
            <Header />
            <Suspense fallback={<CircularProgress />}>
              <Routes>
                {/* <Route path="/" element={<TableContainer />} /> */}
                <Route path="/" element={<GeneContainer />} />
                <Route path="/gene/:geneName" element={<GeneContainer />} />
                <Route path="/about" element={<About />} />
                <Route path="/changelog" element={<ChangeLog />} />
              </Routes>
            </Suspense>
          </Box>
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
};
