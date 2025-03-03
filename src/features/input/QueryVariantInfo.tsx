import { Typography } from "@mui/material";
import { useDataStore } from "../../store/store";
import { HtmlTooltip } from "../tooltips/HtmlTooltip";
import { useServerQuery } from "../../store/serverQuery";

const QueryVariantInfo = (props: {}) => {
  const variantInput: string = useDataStore((state) => state.variantInput)!;
  const message: string | undefined = useDataStore((state) => state.message);
  const { error, isError, isFetching, isLoading } = useServerQuery(variantInput);
  const nVariants = useDataStore((state) => state.clientData?.data.length);
  const input = useDataStore((state) => state.clientData?.input_variants);
  const queryType = useDataStore((state) => state.clientData?.query_type);
  const gnomadVersion = useDataStore((state) => state.serverData?.meta.gnomad.version);

  if (queryType === "gene") {
    return isLoading || isFetching || isError ? (
      <></>
    ) : (
      <Typography variant="h6" gutterBottom>
        Found {nVariants} coding variants with gnomAD gene_most_severe {variantInput}
      </Typography>
    );
  }
  if (!input || isLoading || isFetching || isError) {
    return <></>;
  }
  let messageElem = message ? (
    <Typography variant="h6" gutterBottom>
      {message}
    </Typography>
  ) : (
    <></>
  );
  let foundElem = <></>;
  if (input.found.length > 0) {
    if (input.found.length > 1) {
      foundElem = (
        <Typography variant="h6" gutterBottom>
          {input.not_found.length + input.unparsed.length == 0
            ? input.found.length == 2
              ? "Both "
              : `All ${input.found.length} `
            : input.found.length}{" "}
          variants found
        </Typography>
      );
    } else {
      foundElem = (
        <Typography variant="h6" gutterBottom>
          Variant {input.found[0]} found
        </Typography>
      );
    }
  }
  let notFoundElem = <></>;
  if (input.not_found.length > 0) {
    if (input.not_found.length > 1) {
      const tooltipTableRows = input.not_found.map((nf, i) => (
        <tr key={nf}>
          <td>{nf}</td>
        </tr>
      ));
      notFoundElem = (
        <Typography variant="h6" gutterBottom>
          <HtmlTooltip
            title={
              <table>
                <tbody>{tooltipTableRows}</tbody>
              </table>
            }>
            <span style={{ textDecoration: "underline #fff dotted" }}>
              {input.not_found.length} variants
            </span>
          </HtmlTooltip>{" "}
          were not found. Please check they are either in chr-pos-ref-alt format in genome build
          GRCh38 or rsids. If they are in this format or rsids, they don't exist in gnomAD{" "}
          {gnomadVersion!}.
        </Typography>
      );
    } else {
      notFoundElem = (
        <Typography variant="h6" gutterBottom>
          Variant {input.not_found[0]} was not found. Please check it is in chr-pos-ref-alt format
          in genome build GRCh38. If it is in this format, it doesn't exist in gnomAD{" "}
          {gnomadVersion!}.
        </Typography>
      );
    }
  }
  let unparsedElem = <></>;
  if (input.unparsed.length > 0) {
    if (input.unparsed.length > 1) {
      const tooltipTableRows = input.unparsed.map((nf, i) => (
        <tr key={nf}>
          <td>{nf}</td>
        </tr>
      ));
      unparsedElem = (
        <Typography variant="h6" gutterBottom>
          <HtmlTooltip
            title={
              <table>
                <tbody>{tooltipTableRows}</tbody>
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
      );
    } else {
      unparsedElem = (
        <Typography variant="h6" gutterBottom>
          Variant {input.unparsed[0]} could not be parsed. Please check it is in chr-pos-ref-alt
          format.
        </Typography>
      );
    }
  }
  let ac0Elem = <></>;
  if (input.ac0.length > 0) {
    if (input.ac0.length > 1) {
      const tooltipTableRows = input.ac0.map((nf, i) => (
        <tr key={nf}>
          <td>{nf}</td>
        </tr>
      ));
      notFoundElem = (
        <Typography variant="h6" gutterBottom>
          <HtmlTooltip
            title={
              <table>
                <tbody>{tooltipTableRows}</tbody>
              </table>
            }>
            <span style={{ textDecoration: "underline #fff dotted" }}>
              {input.ac0.length} variants
            </span>
          </HtmlTooltip>{" "}
          exist in gnomAD {gnomadVersion!} but do not have any alleles called.
        </Typography>
      );
    } else {
      notFoundElem = (
        <Typography variant="h6" gutterBottom>
          Variant {input.ac0[0]} exists in gnomAD {gnomadVersion!} but does not have any alleles
          called.
        </Typography>
      );
    }
  }

  let rsidElem = <></>;
  const multipleVariantsPerRsid = Object.keys(input.rsid_map).filter(
    (rsid) => input!.rsid_map[rsid].length > 1
  );
  if (multipleVariantsPerRsid.length == 1) {
    const rsid = multipleVariantsPerRsid[0];
    rsidElem = (
      <Typography variant="h6" gutterBottom>
        rsid {rsid} maps to {input.rsid_map[rsid].length} variants.{" "}
        {input.rsid_map[rsid].length == 2 ? "Both" : "All"} mapping variants are included in the
        results.
      </Typography>
    );
  } else if (multipleVariantsPerRsid.length > 1) {
    rsidElem = (
      <Typography variant="h6" gutterBottom>
        rsids{" "}
        {multipleVariantsPerRsid
          // yeah
          .join(", ")
          .split("")
          .reverse()
          .join("")
          .replace(" ,", " dna ")
          .split("")
          .reverse()
          .join("")}{" "}
        map to multiple variants. All mapping variants are included in the results.
      </Typography>
    );
  }
  return (
    <>
      {messageElem}
      {foundElem}
      {notFoundElem}
      {unparsedElem}
      {ac0Elem}
      {rsidElem}
    </>
  );
};

export default QueryVariantInfo;
