import { Box, styled, Table, TableBody, TableCell, TableRow, Typography } from "@mui/material";
import {
  useCSQuery,
  useDatasetMetadataQuery,
  useGeneModelByGeneQuery,
  useTraitMetadataQuery,
  useVariantAnnotationQuery,
} from "@/store/serverQuery";
import CSPlot from "./CSPlot";
import { useEffect, useMemo, useState } from "react";
import { CSDatum, CSStatus, SelectedVariantStats, TraitStatus } from "@/types/types.gene";
import config from "@/config.json";
import VariantCSInfoBox from "./VariantCSInfoBox";
import CisViewOptions from "./CisViewOptions";
import NorthIcon from "@mui/icons-material/North";
import SouthIcon from "@mui/icons-material/South";
import DatasetOptions from "./DatasetOptions";
import { useThemeStore } from "@/store/store.theme";
import { useGeneViewStore } from "@/store/store.gene";

const CleanTableCell = styled(TableCell)({
  padding: 0,
  margin: 0,
  border: "none",
});

const CisView = ({ geneName }: { geneName: string }) => {
  const { isDarkMode } = useThemeStore();
  const { resourceToggles } = useGeneViewStore();
  const {
    data: geneModels,
    isPending: geneModelsIsPending,
    isError: geneModelsIsError,
    error: geneModelsError,
  } = useGeneModelByGeneQuery(geneName);
  const geneModel = useMemo(() => {
    if (!geneModels) {
      return undefined;
    }
    return geneModels.find((gm) => gm.geneName === geneName);
  }, [geneModels, geneName]);
  const geneNames = useMemo(() => {
    return [geneName, geneModel?.ensg].filter((n) => n !== undefined);
  }, [geneName, geneModel]);

  const { data, isPending, isError, error } = useCSQuery(geneName, {
    eQTL: geneNames,
    pQTL: geneNames,
  });

  const {
    data: metadata,
    isPending: metaisPending,
    isError: metaIsError,
    error: metaError,
  } = useTraitMetadataQuery(data?.map((d) => ({ resource: d.resource, phenocode: d.trait })));

  const {
    data: datasetMetadata,
    isFetching: datasetMetadataIsFetching,
    isError: datasetMetadataIsError,
    error: datasetMetadataError,
  } = useDatasetMetadataQuery(
    // TODO harmonize dataset metadata across resources
    data
      ?.filter((d) => d.resource.startsWith("eQTL_Catalogue") && d.trait === geneName)
      .map((d) => d.dataset)
  );

  const {
    data: annoData,
    isPending: annoIsPending,
    isError: annoIsError,
    error: annoError,
  } = useVariantAnnotationQuery(Array.from(new Set(data?.flatMap((d) => d.variant))));

  const [codingOnly, setCodingOnly] = useState(false);
  const [traitStatus, setTraitStatus] = useState<TraitStatus | undefined>(undefined);
  const [csStatus, setCsStatus] = useState<CSStatus | undefined>(undefined);
  const [selectedVariantStats, setSelectedVariantStats] = useState<
    SelectedVariantStats | undefined
  >(undefined);
  const [maxCsSize, setMaxCsSize] = useState<number>(50);
  const [minLeadMlog10p, setMinLeadMlog10p] = useState<number>(10);
  const [highlightedVariant, setHighlightedVariant] = useState<string | undefined>(undefined);
  const [mouseOverTrait, setMouseOverTrait] = useState<string | undefined>(undefined);
  const [highlightCSs, setHighlightCSs] = useState<Set<string> | undefined>(undefined);
  const [isZoomEnabled, setIsZoomEnabled] = useState(false);
  const [geneModelHeight, setGeneModelHeight] = useState<number>(0);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  const range = useMemo(() => {
    if (!geneModels || !data || data.length === 0) {
      return [0, 0];
    }
    const minPos =
      geneModels.reduce((acc, d) => {
        if (d.geneName === geneName) {
          return Math.max(acc, ...d.exonStarts);
        }
        return acc;
      }, -Infinity) - config.gene_view.gene_padding;
    const maxPos =
      geneModels.reduce((acc, d) => {
        if (d.geneName === geneName) {
          return Math.max(acc, ...d.exonEnds);
        }
        return acc;
      }, -Infinity) + config.gene_view.gene_padding;
    return [minPos, maxPos];
  }, [data, geneModels, geneName]);

  const filteredData: CSDatum[] | undefined = useMemo(() => {
    console.time("filter data");
    const fd = data?.filter(
      (d) =>
        d.mlog10p.filter((mlog10p) => mlog10p >= minLeadMlog10p).length > 0 &&
        d.csSize <= maxCsSize &&
        d.variant.length > 0 &&
        (annoData && codingOnly ? d.variant.some((v) => annoData[v]?.isCoding) : true) &&
        resourceToggles[d.resource]
    );
    console.timeEnd("filter data");
    return fd;
  }, [data, annoData, maxCsSize, minLeadMlog10p, codingOnly, resourceToggles]);

  const setHighlightVariant = (csDatum: CSDatum | undefined, index: number | undefined) => {
    if (
      csDatum !== undefined &&
      index !== undefined &&
      csOverlap[csDatum.traitCSId] !== undefined
    ) {
      setHighlightedVariant(csDatum.variant[index]);
      setHighlightCSs(csOverlap[csDatum.traitCSId]);
      // TODO things are getting complicated, refactor data structure and states
      const traitsWithCSOverlap = new Set(
        Array.from(csOverlap[csDatum.traitCSId])
          .map((csId) => csId.split("=")[0])
          .filter((traitId) => {
            return sortedData?.find((d) => d.traitId === traitId) !== undefined;
          })
      );
      const traitsWithHighlightedVariant = new Set(
        sortedData?.filter((d) => d.variant.includes(csDatum.variant[index])).map((d) => d.traitId)
      );
      setTraitStatus({
        csOverlappingTraits: traitsWithCSOverlap.size - 1, // -1 for the current trait
        variantOverlappingTraits: traitsWithHighlightedVariant.size - 1,
      });
      setCsStatus({
        csSize: csDatum.csSize,
        csMinR2: csDatum.csMinR2,
      });
      setSelectedVariantStats({
        variant: csDatum.variant[index],
        consequence: String(annoData?.[csDatum.variant[index]]?.consequence || "not in gnomAD"),
        isLoF: annoData?.[csDatum.variant[index]]?.isLoF as boolean,
        isCoding: annoData?.[csDatum.variant[index]]?.isCoding as boolean,
        mlog10p: csDatum.mlog10p[index],
        pip: csDatum.pip[index],
        beta: csDatum.beta[index],
        se: csDatum.se[index],
        af: String(annoData?.[csDatum.variant[index]]?.af || "not in gnomAD"),
      });
    } else {
      setHighlightedVariant(undefined);
      setHighlightCSs(undefined);
      setTraitStatus(undefined);
      setCsStatus(undefined);
      setSelectedVariantStats(undefined);
    }
  };

  const onRowMouseEnter = (traitCSId: string) => {
    if (sortedData === undefined) {
      return;
    }
    const traitId = traitCSId.split("=")[0];
    const overlappingCS = new Set<string>();
    for (let i = 0; i < sortedData.length; i++) {
      if (csOverlap[sortedData[i].traitCSId] !== undefined) {
        if (csOverlap[sortedData[i].traitCSId].has(traitCSId)) {
          overlappingCS.add(sortedData[i].traitCSId);
        }
      }
    }
    setHighlightCSs(overlappingCS);
    setMouseOverTrait(traitId);
    setHighlightCSs(overlappingCS);
  };

  const csOverlap = useMemo(() => {
    if (!data) {
      return {};
    }
    console.time("cs overlap");
    const overlap: { [key: string]: Set<string> } = {};
    for (let d1 = 0; d1 < data.length; d1++) {
      const d1Var = data[d1].variant;
      const d1Pos = data[d1].pos;
      const d1CSId = data[d1].traitCSId;
      for (let d2 = d1; d2 < data.length; d2++) {
        const d2Var = data[d2].variant;
        const d2Pos = data[d2].pos;
        const d2CSId = data[d2].traitCSId;
        for (let i1 = 0; i1 < d1Var.length; i1++) {
          for (let i2 = 0; i2 < d2Var.length; i2++) {
            if (d2Pos[i2] > d1Pos[i1]) {
              break;
            }
            if (d2Pos[i2] < d1Pos[i1]) {
              continue;
            }
            if (d1Var[i1] === d2Var[i2]) {
              if (!overlap[d1CSId]) {
                overlap[d1CSId] = new Set<string>();
              }
              if (!overlap[d2CSId]) {
                overlap[d2CSId] = new Set<string>();
              }
              overlap[d1CSId].add(d2CSId);
              overlap[d2CSId].add(d1CSId);
              break;
            }
          }
        }
      }
    }
    console.timeEnd("cs overlap");
    return overlap;
  }, [data]);

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Control") {
        setIsZoomEnabled(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control") {
        setIsZoomEnabled(false);
      }
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const sortedData = useMemo(() => {
    return filteredData?.sort((a, b) => {
      const resourceAIndex = config.gene_view.resources.findIndex(
        (resource) => a.resource === resource.dataName
      );
      const resourceBIndex = config.gene_view.resources.findIndex(
        (resource) => b.resource === resource.dataName
      );
      if (resourceAIndex !== resourceBIndex) {
        return resourceAIndex - resourceBIndex;
      }
      if (a.dataset !== b.dataset) {
        return a.dataset.localeCompare(b.dataset);
      }
      if (a.trait === b.trait) {
        return a.csNumber - b.csNumber;
      }
      return a.trait.localeCompare(b.trait);
    });
  }, [filteredData]);

  const titleRows = useMemo(() => {
    const rows = sortedData?.map((d) => {
      let color = "white";
      let traitName = d.trait;
      let resourceShortName = "TBA";
      const highlighted = highlightCSs === undefined || highlightCSs.has(d.traitCSId);
      const resource = config.gene_view.resources.find(
        (resource) => d.resource === resource.dataName
      );
      if (resource === undefined) {
        console.error(`Resource not found: ${d.resource}`);
      } else {
        color = highlighted
          ? resource.color
          : isDarkMode
          ? config.gene_view.colors.dimDark
          : config.gene_view.colors.dim;
        // TODO traitName and resourceShortName are a hack based on the resource now
        if (!metaisPending && metadata !== undefined) {
          const trait = metadata[`${d.resource}|${d.trait}`];
          if (trait !== undefined) {
            traitName = trait.phenostring;
          }
        }
        if (d.dataType === "pQTL") {
          if (d.resource === "FinnGen_pQTL") {
            d.trait = d.dataset.match(/FinnGen_(.*?)_/)?.[1] || "NA";
          } else {
            d.trait = "Olink"; // UKBB
          }
        }
        resourceShortName = resource.label;
        if (datasetMetadata !== undefined) {
          const metadata = datasetMetadata[d.dataset];
          if (metadata !== undefined) {
            traitName = metadata.tissue_label;
            resourceShortName = metadata.study_label;
          }
        }
        if (d.dataType === "eQTL" && d.resource === "FinnGen_eQTL") {
          d.trait = d.dataset.match(/FinnGen_(.*?)_/)?.[1] || "NA";
        }
      }

      return (
        <TableRow
          key={d.traitCSId}
          id={d.traitCSId}
          data-trait-id={d.traitId}
          style={{
            color: color,
            backgroundColor:
              d.traitId === mouseOverTrait ? (isDarkMode ? "black" : "#eeeeee") : "inherit",
            height: config.gene_view.rowHeight,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            width: config.gene_view.titleWidth,
          }}
          onMouseEnter={() => onRowMouseEnter(d.traitCSId)}
          onMouseLeave={() => {
            setMouseOverTrait(undefined);
            setHighlightCSs(undefined);
          }}>
          <CleanTableCell>
            {d.beta[0] > 0 ? (
              <NorthIcon
                style={{
                  height: 20,
                  color: highlighted
                    ? "red"
                    : isDarkMode
                    ? config.gene_view.colors.dimDark
                    : config.gene_view.colors.dim,
                }}
              />
            ) : (
              <SouthIcon
                style={{
                  height: 20,
                  color: highlighted
                    ? "green"
                    : isDarkMode
                    ? config.gene_view.colors.dimDark
                    : config.gene_view.colors.dim,
                }}
              />
            )}
          </CleanTableCell>
          <CleanTableCell align="right" style={{ width: "20px", marginRight: "5px", color: color }}>
            {d.csSize}
          </CleanTableCell>
          <CleanTableCell
            align="right"
            style={{
              width: "60px",
              marginRight: "5px",
              color: color,
              overflow: "scroll",
              whiteSpace: "nowrap",
            }}>
            {resourceShortName}
          </CleanTableCell>
          <CleanTableCell
            style={{
              width: config.gene_view.titleWidth - 80,
              overflow: "scroll",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "flex-start",
              whiteSpace: "nowrap",
              color: color,
            }}>
            {traitName}
          </CleanTableCell>
        </TableRow>
      );
    });
    return (
      <Table>
        <TableBody>{rows}</TableBody>
      </Table>
    );
  }, [sortedData, metaisPending, metadata, mouseOverTrait, highlightCSs]);

  if (!geneName) {
    return <Typography>Enter a gene name</Typography>;
  }
  if (isError || metaIsError || annoIsError || geneModelsIsError || datasetMetadataIsError) {
    return (
      <Typography>
        {(error || metaError || annoError || geneModelsError || datasetMetadataError)!.message}
      </Typography>
    );
  }
  if (isPending || metaisPending || geneModelsIsPending || datasetMetadataIsFetching) {
    return <Typography>Loading...</Typography>;
  }

  return (
    <>
      <Box display="flex" flexDirection="column">
        <Box display="flex" flexDirection="row" mt={2} mb={2}>
          <DatasetOptions disabled={isPending} />
          <CisViewOptions
            maxCsSize={maxCsSize}
            setMaxCsSize={setMaxCsSize}
            minLeadMlog10p={minLeadMlog10p}
            setMinLeadMlog10p={setMinLeadMlog10p}
            codingOnly={codingOnly}
            setCodingOnly={setCodingOnly}
            disabled={annoIsPending}
          />
        </Box>
        <Typography>
          Hold <code>ctrl</code> and scroll to zoom
        </Typography>
        <Box display="flex" flexDirection="row">
          <Box display="flex" flexDirection="column">
            <Box height={geneModelHeight} width={config.gene_view.titleWidth} />
            <Box sx={{ overflow: "hidden" }}>{titleRows}</Box>
          </Box>
          <CSPlot
            geneName={geneName}
            data={sortedData || []}
            range={range}
            varAnno={annoData}
            resources={config.gene_view.resources}
            width={windowWidth - config.gene_view.titleWidth - 50}
            rowHeight={config.gene_view.rowHeight}
            highlightTrait={mouseOverTrait}
            setHighlightTrait={setMouseOverTrait}
            highlightVariant={highlightedVariant}
            setHighlightVariant={setHighlightVariant}
            highlightCS={highlightCSs}
            isZoomEnabled={isZoomEnabled}
            geneModels={geneModels || []}
            geneModelHeight={geneModelHeight}
            setGeneModelHeight={setGeneModelHeight}
          />
        </Box>
      </Box>
      <VariantCSInfoBox
        traitStatus={traitStatus}
        csStatus={csStatus}
        selectedVariantStats={selectedVariantStats}
      />
    </>
  );
};

export default CisView;
