import { ReactNode } from "react";
import { HtmlTooltip } from "./HtmlTooltip";
import { GnomadConsequence } from "../../types/types.normalized";
import { cleanConsequence } from "../table/utils/tableutil";

/**
 * Credible-set-model port of the legacy ConsequenceTooltip: lists every gnomAD VEP consequence and
 * its gene for the variant (the "most severe" column shows only the single most-severe one). No
 * consequences -> renders the trigger with no tooltip.
 */
export const GnomadConsequenceTooltip = (props: {
  consequences: GnomadConsequence[] | undefined;
  children: ReactNode;
}) => {
  const cons = props.consequences ?? [];
  if (cons.length === 0) return <>{props.children}</>;
  return (
    <HtmlTooltip
      title={
        <table>
          <thead>
            <tr>
              <th style={{ fontWeight: "bold", textAlign: "start", paddingRight: "12px" }}>gene</th>
              <th style={{ fontWeight: "bold", textAlign: "start" }}>VEP consequence</th>
            </tr>
          </thead>
          <tbody>
            {cons.map((c, i) => (
              <tr key={`${c.gene}:${c.consequence}:${i}`}>
                <td style={{ paddingRight: "12px" }}>{c.gene}</td>
                <td>{cleanConsequence(c.consequence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }>
      <span>{props.children}</span>
    </HtmlTooltip>
  );
};

export default GnomadConsequenceTooltip;
