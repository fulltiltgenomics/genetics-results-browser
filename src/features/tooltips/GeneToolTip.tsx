import { Link } from "@mui/material";
import { useEffect, useState } from "react";
import { GeneInfo } from "../../types/types";
import { HtmlTooltip } from "./HtmlTooltip";

const GeneTooltip = (props: { geneName: string; content: React.ReactElement }) => {
  const [geneInfo, setGeneInfo] = useState<GeneInfo | undefined>(undefined);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (isHovered) {
      const fetchData = async () => {
        fetch(`https://mygene.info/v3/query?q=symbol:${props.geneName}`)
          .then((result) => {
            return result.json();
          })
          .then((data) => {
            const geneId = data.hits[0]?._id;
            if (!geneId) {
              throw new Error(`${props.geneName}`);
            }
            return fetch(`https://mygene.info/v3/gene/${geneId}`);
          })
          .then((result) => {
            return result.json();
          })
          .then((data) => {
            setGeneInfo(data);
          })
          .catch((error) => {
            setGeneInfo({
              _id: "NA",
              symbol: "NA",
              name: "NA",
              summary: error.message,
            });
          });
      };
      fetchData();
    }
  }, [isHovered, props.geneName]);

  return (
    <div onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      <HtmlTooltip
        title={
          geneInfo === undefined ? (
            "loading..."
          ) : geneInfo._id == "NA" ? (
            geneInfo.summary
          ) : (
            <div>
              <div style={{ fontWeight: "bold" }}>{geneInfo?.symbol}</div>
              <div>{geneInfo?.name}</div>
              <br />
              <div>{geneInfo?.summary}</div>
              <div>
                <Link href={`https://www.ncbi.nlm.nih.gov/gene/${geneInfo?._id}`}>NCBI</Link>
              </div>
            </div>
          )
        }>
        <div>{geneInfo ? props.content : props.geneName}</div>
      </HtmlTooltip>
    </div>
  );
};

export default GeneTooltip;
