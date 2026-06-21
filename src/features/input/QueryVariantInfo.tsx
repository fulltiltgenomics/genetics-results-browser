import { Typography } from "@mui/material";
import { useDataStore } from "../../store/store";
import { HtmlTooltip } from "../tooltips/HtmlTooltip";
import { useNormalizedQuery } from "../../store/serverQuery";

/**
 * Summary line(s) above the results: how many input variants were found / not found / unparsed, and
 * any rsid-to-multiple-variant notes. Reads the normalized stage-1 payload (inputVariants) and shares
 * the single useNormalizedQuery cache key — the legacy useServerQuery it used before fired a SECOND
 * /v1/results request (with the old TableData query key) that errored on the new shape and retried.
 */
const QueryVariantInfo = () => {
  const variantInput: string = useDataStore((state) => state.variantInput)!;
  const message: string | undefined = useDataStore((state) => state.message);
  const normalizedData = useDataStore((state) => state.normalizedData);
  const { isError, isFetching, isLoading } = useNormalizedQuery(variantInput);

  const input = normalizedData?.inputVariants;

  if (normalizedData?.queryType === "gene") {
    return isLoading || isFetching || isError ? (
      <></>
    ) : (
      <Typography variant="h6" gutterBottom>
        Found {normalizedData.variants.length} credible-set variants for {variantInput}
      </Typography>
    );
  }

  if (!input || isLoading || isFetching || isError) {
    return <></>;
  }

  const messageElem = message ? (
    <Typography variant="h6" gutterBottom>
      {message}
    </Typography>
  ) : (
    <></>
  );

  // the tables only render variants that are a member of at least one credible set, so surface that
  // count alongside the found count to explain why fewer rows may show than variants found.
  const inCredibleSet = (normalizedData?.variants ?? []).filter(
    (v) => v.credibleSets.length > 0
  ).length;

  // natural quantifier for the "<n> in at least one credible set" clause: none / both / all / the number
  const inCredibleSetPhrase =
    inCredibleSet === 0
      ? "none"
      : inCredibleSet === input.found.length
        ? input.found.length === 2
          ? "both"
          : "all"
        : inCredibleSet;

  let foundElem = <></>;
  if (input.found.length > 0) {
    foundElem =
      input.found.length > 1 ? (
        <Typography variant="h6" gutterBottom>
          {input.notFound.length + input.unparsed.length === 0
            ? input.found.length === 2
              ? "Both "
              : `All ${input.found.length} `
            : input.found.length}{" "}
          variants found, {inCredibleSetPhrase} in at least one credible set across all datasets
        </Typography>
      ) : (
        <Typography variant="h6" gutterBottom>
          Variant {input.found[0]} found
          {inCredibleSet === 0 ? ", not in any credible set" : ""}
        </Typography>
      );
  }

  let notFoundElem = <></>;
  if (input.notFound.length > 0) {
    notFoundElem =
      input.notFound.length > 1 ? (
        <Typography variant="h6" gutterBottom>
          <HtmlTooltip
            title={
              <table>
                <tbody>
                  {input.notFound.map((nf) => (
                    <tr key={nf}>
                      <td>{nf}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }>
            <span style={{ textDecoration: "underline #fff dotted" }}>
              {input.notFound.length} variants
            </span>
          </HtmlTooltip>{" "}
          were not found. Please check they are either in chr-pos-ref-alt format in genome build
          GRCh38 or rsids.
        </Typography>
      ) : (
        <Typography variant="h6" gutterBottom>
          Variant {input.notFound[0]} was not found. Please check it is in chr-pos-ref-alt format in
          genome build GRCh38 or an rsid.
        </Typography>
      );
  }

  let unparsedElem = <></>;
  if (input.unparsed.length > 0) {
    unparsedElem =
      input.unparsed.length > 1 ? (
        <Typography variant="h6" gutterBottom>
          <HtmlTooltip
            title={
              <table>
                <tbody>
                  {input.unparsed.map((nf) => (
                    <tr key={nf}>
                      <td>{nf}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }>
            <span style={{ textDecoration: "underline #fff dotted" }}>
              {input.unparsed.length} variants
            </span>
          </HtmlTooltip>{" "}
          could not be parsed. Please check they are in chr-pos-ref-alt format.
          {input.found.length > 0
            ? " Or you're an expert and pasted extra data on purpose, that's awesome."
            : ""}
        </Typography>
      ) : (
        <Typography variant="h6" gutterBottom>
          Variant {input.unparsed[0]} could not be parsed. Please check it is in chr-pos-ref-alt
          format.
        </Typography>
      );
  }

  let rsidElem = <></>;
  const multipleVariantsPerRsid = Object.keys(input.rsidMap).filter(
    (rsid) => input.rsidMap[rsid].length > 1
  );
  if (multipleVariantsPerRsid.length === 1) {
    const rsid = multipleVariantsPerRsid[0];
    rsidElem = (
      <Typography variant="h6" gutterBottom>
        rsid {rsid} maps to {input.rsidMap[rsid].length} variants.{" "}
        {input.rsidMap[rsid].length === 2 ? "Both" : "All"} mapping variants are included in the
        results.
      </Typography>
    );
  } else if (multipleVariantsPerRsid.length > 1) {
    rsidElem = (
      <Typography variant="h6" gutterBottom>
        rsids {multipleVariantsPerRsid.join(", ")} map to multiple variants. All mapping variants are
        included in the results.
      </Typography>
    );
  }

  return (
    <>
      {messageElem}
      {foundElem}
      {notFoundElem}
      {unparsedElem}
      {rsidElem}
    </>
  );
};

export default QueryVariantInfo;
