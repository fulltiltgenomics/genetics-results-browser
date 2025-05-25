import { Link } from "@mui/material";
import { AssocResource, GroupedAssocRecord, Phenotype } from "../../types/types";
import { pValRepr } from "../table/utils/tableutil";
import { HtmlTooltip } from "./HtmlTooltip";

export const PhenoTooltip = (props: {
  phenos: Phenotype[];
  resource: AssocResource | null;
  content: React.ReactElement;
  row?: GroupedAssocRecord;
}) => {
  const seenPhenocodes = new Set<string>();
  const elems = props.phenos
    .filter((pheno) => {
      if (seenPhenocodes.has(pheno.phenocode)) {
        return false;
      }
      seenPhenocodes.add(pheno.phenocode);
      return true;
    })
    .map((pheno, idx) => {
      const info = pheno.pub_date ? `${pheno.pub_author} ${pheno.pub_date!.split("-")[0]}` : "";
      const stats =
        props.phenos.length > 1 ? (
          <>
            <div>p-value {pValRepr(props.row!.mlog10p[idx])}</div>
            <div>beta {props.row!.beta[idx].toPrecision(3)}</div>
          </>
        ) : null;
      const urls =
        props.resource === null || props.resource.pheno_urls === undefined ? (
          <></>
        ) : (
          props.resource.pheno_urls.map((url) => (
            <div key={url.label}>
              <Link
                color="inherit"
                target="_blank"
                href={url.url
                  .replace("[PHENOCODE]", pheno.phenocode)
                  .replace("[GENE]", pheno.phenostring)}>
                {url.label}
              </Link>
            </div>
          ))
        );
      return (
        <div key={pheno.phenocode}>
          <div>{pheno.phenostring}</div>
          <div>{pheno.phenocode}</div>
          {pheno.chromosome ? (
            <div>
              chr{pheno.chromosome} {pheno.gene_start} - {pheno.gene_end}{" "}
              {pheno.strand == 1 ? "forward" : pheno.strand == -1 ? "reverse" : "unknown"} strand
            </div>
          ) : null}
          <div>{info}</div>
          <div>
            {pheno.num_cases
              ? `${pheno.num_cases} cases`
              : pheno.num_samples
              ? `${pheno.num_samples} samples`
              : ""}
          </div>
          <div>{stats}</div>
          {urls}
          {idx === props.phenos.length - 1 ? null : <br />}
        </div>
      );
    });

  return <HtmlTooltip title={elems}>{props.content}</HtmlTooltip>;
};
