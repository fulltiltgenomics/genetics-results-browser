import { styled, TableCell } from "@mui/material";
import { Link } from "react-router-dom";

const CleanTableCell = styled(TableCell)({
  padding: 0,
  margin: 0,
  border: "none",
});

export default CleanTableCell;

export const StyledLink = styled(Link)({
  color: "inherit",
  textDecoration: "none",
  "&:hover": {
    color: "inherit",
    fontWeight: 700,
    textDecoration: "none",
  },
});
