import { Fragment } from "react";
import { Link as RouterLink } from "react-router";
import { Link, Typography } from "@mui/material";
import { GeneNotFoundError } from "@/store/serverQuery";

/** the message of a failed gene lookup, with the search's near-misses offered as links */
const GeneNotFound = ({ error }: { error: Error }) => {
  const suggestions = error instanceof GeneNotFoundError ? error.suggestions : [];
  return (
    <Typography component="div">
      {error.message}
      {suggestions.length > 0 && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          Did you mean:{" "}
          {suggestions.map((s, i) => (
            <Fragment key={s.symbol}>
              {i > 0 && ", "}
              <Link component={RouterLink} to={`/gene/${encodeURIComponent(s.symbol)}`}>
                {s.symbol}
              </Link>
              {s.matchedOn && ` (${s.matchedOn})`}
            </Fragment>
          ))}
        </Typography>
      )}
    </Typography>
  );
};

export default GeneNotFound;
