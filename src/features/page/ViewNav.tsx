import { Box, Typography } from "@mui/material";
import { useNavigate } from "react-router";

const VIEWS = [
  { key: "annotate", label: "Variant tables", path: "/annotate" },
  { key: "gene", label: "Gene view", path: "/gene" },
  { key: "ld", label: "LD lookup", path: "/ld" },
] as const;

export type ViewKey = (typeof VIEWS)[number]["key"];

/**
 * Top-level nav shared by the variant / gene / LD views, under a one-line description of what the
 * tool does: the current view in bold, the others as links. All three views render it with identical
 * markup and spacing, which is what keeps the row from shifting position when switching between them.
 */
const ViewNav = ({ current }: { current: ViewKey }) => {
  const navigate = useNavigate();

  return (
    <>
      <Typography sx={{ mt: 3 }}>
        In this variant and gene annotation tool you can examine association results for a list of
        variants (e.g. GWAS lead variants) or a gene, and do LD lookups for a variant or a pair of
        variants.
      </Typography>
      <Box
        sx={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 2.5,
          mt: 1.5,
          mb: "20px",
          pb: 1,
          borderBottom: 1,
          borderColor: "divider",
        }}>
        {VIEWS.map((view) =>
          view.key === current ? (
            <Typography key={view.key} variant="h6" sx={{ fontWeight: 700 }}>
              {view.label}
            </Typography>
          ) : (
            <Typography
              key={view.key}
              variant="h6"
              sx={{ cursor: "pointer", color: "primary.main" }}
              onClick={() => navigate(view.path)}>
              {view.label}
            </Typography>
          )
        )}
      </Box>
    </>
  );
};

export default ViewNav;
