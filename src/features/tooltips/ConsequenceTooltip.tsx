import { HtmlTooltip } from "./HtmlTooltip";
import { VariantRecord } from "../../types/types";

export const ConsequenceTooltip = (props: { row: VariantRecord; content: React.ReactElement }) => {
  if (props.row.gnomad[props.row.gnomad.preferred]!.consequences.length === 0) {
    // no tooltip
    return props.content;
  }
  const tooltipTableRows = props.row.gnomad[props.row.gnomad.preferred]!.consequences.map(
    (c, i) => (
      <tr key={c.gene_symbol + ":" + c.consequence}>
        <td>{c.gene_symbol}</td>
        <td>{c.consequence}</td>
      </tr>
    )
  );
  return (
    <HtmlTooltip
      title={
        <table>
          <thead>
            <tr>
              <th style={{ fontWeight: "bold", textAlign: "start" }}>gene</th>
              <th style={{ fontWeight: "bold", textAlign: "start" }}>VEP consequence</th>
            </tr>
          </thead>
          <tbody>{tooltipTableRows}</tbody>
        </table>
      }>
      {props.content}
    </HtmlTooltip>
  );
};
