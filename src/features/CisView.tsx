import {
  Box,
  Collapse,
  IconButton,
  Table,
  TableBody,
  TableRow,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import {
  useGeneCredibleSets,
  useGeneInfo,
  useGenesInRegion,
  useGeneTransCredibleSets,
  useResourceMetadata,
  useTraitNameMapping,
} from "@/store/serverQuery";
import {
  buildAffectedGeneList,
  buildAffectingGeneList,
  EQTL_CATALOGUE_DATA_NAME,
  geneViewTraitCode,
  geneViewTraitName,
  needsTraitNameMapping,
} from "@/store/geneCS";
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
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import AffectedGeneList from "./AffectedGeneList";
import { afRepr, cleanConsequence, pValRepr } from "./table/utils/tableutil";
import AffectingGeneList from "./AffectingGeneList";
import CleanTableCell from "@/style";
import { DataTypeIcon } from "./table/DataTypeIcon";
import { CredibleSetDataType } from "@/types/types.normalized";

const CisView = ({ geneName }: { geneName: string }) => {
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
  const { isDarkMode } = useThemeStore();
  const isActualDarkMode = isDarkMode ?? prefersDarkMode;
  const { resourceToggles } = useGeneViewStore();
  // resolve the gene's coordinates first; genes_in_region (the gene track) and the plot range both
  // need an explicit chr/start/end, which the credible-set endpoints no longer carry.
  const {
    data: geneInfo,
    isPending: geneInfoIsPending,
    isError: geneInfoIsError,
    error: geneInfoError,
  } = useGeneInfo(geneName);

  const range = useMemo(() => {
    if (!geneInfo) {
      return undefined;
    }
    const minPos = geneInfo.start - config.gene_view.gene_padding;
    const maxPos = geneInfo.end + config.gene_view.gene_padding;
    return [Number(geneInfo.chr.replace("X", "23").replace("Y", "24")), minPos, maxPos];
  }, [geneInfo]);

  const {
    data: geneModels,
    isPending: geneModelsIsPending,
    isError: geneModelsIsError,
    error: geneModelsError,
  } = useGenesInRegion(geneInfo?.chr, range?.[1], range?.[2]);

  const { data, isPending, isError, error } = useGeneCredibleSets(geneName);

  const {
    data: transData,
    isPending: transIsPending,
    isError: transIsError,
    error: transError,
  } = useGeneTransCredibleSets(geneName);

  // the credible-set endpoints already name most traits; only the phenocodes they leave unresolved
  // (FinnGen drugs/labs) need the trait_name_mapping dictionary, and it is 2 MB, so the fetch is
  // gated on this region actually having such a row. rows render with their code until it lands.
  // tissue-label enrichment for eQTL Catalogue is still missing (genetics-results-browser-3uu.18/.25).
  const { data: traitNames } = useTraitNameMapping(needsTraitNameMapping(data));

  // an eQTL Catalogue row's resource label ("eQTL Cat") is the same on every one of them; the study
  // behind the QTD sub-dataset is what distinguishes them, and it comes from resource_metadata keyed
  // by QTD id. only fetched when the region actually has such rows.
  const hasEqtlCatalogue = useMemo(
    () => data?.some((d) => d.resource === EQTL_CATALOGUE_DATA_NAME) ?? false,
    [data]
  );
  const { data: eqtlCatalogueMeta } = useResourceMetadata("eqtl_catalogue", hasEqtlCatalogue);

  const [codingOnly, setCodingOnly] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
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

  const {
    filteredData,
    filteredDataWithResourceToggles,
  }: {
    filteredData: CSDatum[] | undefined;
    filteredDataWithResourceToggles: CSDatum[] | undefined;
  } = useMemo(() => {
    console.time("filter data");
    const filteredData = data?.filter(
      (d) =>
        ((d.dataType !== "eQTL" && d.dataType !== "pQTL") || d.trait.toLowerCase() === geneName.toLowerCase()) && // only QTLs that affect the input gene
        d.mlog10p.filter((mlog10p) => mlog10p >= minLeadMlog10p).length > 0 &&
        d.csSize <= maxCsSize &&
        d.variant.length > 0 &&
        (!codingOnly || d.isCoding.some((c) => c))
    );
    // `?? true` keeps this in step with the switch in DatasetOptions, which renders an unknown
    // resource as on: without it the two disagree and rows vanish under a checked toggle
    const filteredDataWithResourceToggles = filteredData?.filter(
      (d) => resourceToggles[d.resource] ?? true
    );
    console.timeEnd("filter data");
    return { filteredData, filteredDataWithResourceToggles };
  }, [data, maxCsSize, minLeadMlog10p, codingOnly, resourceToggles]);

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
        consequence: csDatum.consequence[index] || "not in gnomAD",
        isLoF: csDatum.isLoF[index],
        isCoding: csDatum.isCoding[index],
        mlog10p: csDatum.mlog10p[index],
        pip: csDatum.pip[index],
        beta: csDatum.beta[index],
        se: csDatum.se[index],
        af: String(csDatum.af[index] || "not in gnomAD"),
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
    // index the credible sets by variant first: two CSs overlap iff they appear in the same bucket.
    // the previous all-pairs scan compared every CS against every other one and grew quadratically
    // with the row count — 6s on APOE once Open Targets was added.
    const csIdsByVariant = new Map<string, string[]>();
    for (const d of data) {
      for (const variant of d.variant) {
        const ids = csIdsByVariant.get(variant);
        if (ids === undefined) {
          csIdsByVariant.set(variant, [d.traitCSId]);
        } else {
          ids.push(d.traitCSId);
        }
      }
    }
    // a CS is in its own overlap set, as it was before: consumers subtract it (see traitStatus)
    const overlap: { [key: string]: Set<string> } = {};
    for (const ids of csIdsByVariant.values()) {
      for (const csId of ids) {
        let set = overlap[csId];
        if (set === undefined) {
          set = new Set<string>();
          overlap[csId] = set;
        }
        for (const other of ids) {
          set.add(other);
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
    return filteredDataWithResourceToggles?.sort((a, b) => {
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
  }, [filteredDataWithResourceToggles]);

  // the two gene lists derive straight from the raw cis/trans CS data (not the resource-toggled
  // view data), so they stay stable as the user toggles resources in the plot.
  const genesAffectedByInputGene2CS = useMemo(
    () =>
      data === undefined
        ? undefined
        : buildAffectedGeneList(data, geneName, { maxCsSize, minLeadMlog10p, codingOnly }),
    [data, geneName, maxCsSize, minLeadMlog10p, codingOnly]
  );

  const genesAffectingInputGene2CS = useMemo(
    () =>
      transData === undefined
        ? undefined
        : buildAffectingGeneList(transData, { maxCsSize, minLeadMlog10p, codingOnly }),
    [transData, maxCsSize, minLeadMlog10p, codingOnly]
  );

  const titleRows = useMemo(() => {
    const rows = sortedData?.map((d) => {
      let color = "white";
      let resourceShortName = "TBA";
      const traitName = geneViewTraitName(d, traitNames, geneName);
      const traitCode = geneViewTraitCode(d);
      const highlighted = highlightCSs === undefined || highlightCSs.has(d.traitCSId);
      const resource = config.gene_view.resources.find(
        (resource) => d.resource === resource.dataName
      );
      if (resource === undefined) {
        console.error(`Resource not found: ${d.resource}`);
      } else {
        color = highlighted
          ? resource.color
          : isActualDarkMode
          ? config.gene_view.colors.dimDark
          : config.gene_view.colors.dim;
        resourceShortName = resource.label;
      }
      // the study says more than "eQTL Cat", which every one of these rows would otherwise repeat
      if (d.resource === EQTL_CATALOGUE_DATA_NAME) {
        resourceShortName = eqtlCatalogueMeta?.[d.dataset]?.study ?? resourceShortName;
      }

      const topPipVariantIndex = d.pip.indexOf(Math.max(...d.pip));

      return (
        <TableRow
          key={d.traitCSId}
          id={d.traitCSId}
          data-trait-id={d.traitId}
          style={{
            color: color,
            backgroundColor:
              d.traitId === mouseOverTrait ? (isActualDarkMode ? "black" : "#eeeeee") : "inherit",
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
            {d.beta[topPipVariantIndex] > 0 ? (
              <NorthIcon
                style={{
                  height: 20,
                  color: highlighted
                    ? "red"
                    : isActualDarkMode
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
                    : isActualDarkMode
                    ? config.gene_view.colors.dimDark
                    : config.gene_view.colors.dim,
                }}
              />
            )}
          </CleanTableCell>
          <CleanTableCell align="right" style={{ width: "20px", marginRight: "5px", color: color }}>
            {d.csSize}
          </CleanTableCell>
          {/* same letter badge as the variant tables, dimmed with the row when it is not highlighted */}
          <CleanTableCell
            style={{
              width: "18px",
              marginRight: "5px",
              display: "inline-flex",
              alignItems: "center",
              opacity: highlighted ? 1 : 0.35,
            }}>
            <DataTypeIcon dataType={d.dataType as CredibleSetDataType} size={14} />
          </CleanTableCell>
          {/* wide enough for the longest resource labels ("Open Targets", "FG+MVP+UKB") */}
          <CleanTableCell
            align="right"
            style={{
              width: "80px",
              marginRight: "5px",
              color: color,
              overflow: "scroll",
              whiteSpace: "nowrap",
            }}>
            {resourceShortName}
          </CleanTableCell>
          <CleanTableCell
            style={{
              width: config.gene_view.titleWidth - 123,
              overflow: "hidden",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "flex-start",
              whiteSpace: "nowrap",
              color: color,
            }}>
            <Tooltip
              title={
                <>
                  {/* the row label is clipped at titleWidth, so the tooltip carries the full name */}
                  <Typography style={{ fontWeight: "bold" }}>{traitName}</Typography>
                  {traitCode !== undefined && <Typography>{traitCode}</Typography>}
                  <Typography>Credible set size: {d.csSize}</Typography>
                  <Box mb={2} />
                  <Typography style={{ fontWeight: "bold" }}>Top PIP variant</Typography>
                  <Box mb={2} />
                  <Typography>{d.variant[topPipVariantIndex]}</Typography>
                  <Typography>
                    {d.gene[topPipVariantIndex] == "NA" ? "" : `${d.gene[topPipVariantIndex]} `}
                    {cleanConsequence(d.consequence[topPipVariantIndex])}
                  </Typography>
                  <Box mb={2} />
                  <Table>
                    <TableBody>
                      <TableRow>
                        <CleanTableCell style={{ color: "white" }}>PIP</CleanTableCell>
                        <CleanTableCell style={{ color: "white" }}>
                          {d.pip[topPipVariantIndex].toFixed(3)}
                        </CleanTableCell>
                      </TableRow>
                      <TableRow>
                        <CleanTableCell style={{ color: "white", paddingRight: "5px" }}>
                          p-value
                        </CleanTableCell>
                        <CleanTableCell style={{ color: "white" }}>
                          {pValRepr(d.mlog10p[topPipVariantIndex])}
                        </CleanTableCell>
                      </TableRow>
                      <TableRow>
                        <CleanTableCell style={{ color: "white" }}>beta</CleanTableCell>
                        <CleanTableCell style={{ color: "white" }}>
                          {d.beta[topPipVariantIndex].toFixed(2)}
                        </CleanTableCell>
                      </TableRow>
                      <TableRow>
                        <CleanTableCell style={{ color: "white" }}>AF</CleanTableCell>
                        <CleanTableCell style={{ color: "white" }}>
                          {afRepr(d.af[topPipVariantIndex])}
                        </CleanTableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </>
              }
              placement="top">
              <Typography noWrap>{traitName}</Typography>
            </Tooltip>
          </CleanTableCell>
        </TableRow>
      );
    });
    return (
      <Table>
        <TableBody>{rows}</TableBody>
      </Table>
    );
  }, [sortedData, mouseOverTrait, highlightCSs, traitNames, eqtlCatalogueMeta, geneName]);

  if (!geneName) {
    return null;
  }
  if (isError || geneInfoIsError || geneModelsIsError || transIsError) {
    return (
      <Typography>
        {(error || geneInfoError || geneModelsError || transError)!.message}
      </Typography>
    );
  }
  if (
    isPending ||
    geneInfoIsPending ||
    geneModelsIsPending ||
    transIsPending
  ) {
    return <Typography>Loading...</Typography>;
  }

  return (
    <>
      <Box display="flex" flexDirection="column">
        <Typography>
          Hold <code>Ctrl</code> and scroll on the credible set area to zoom.
        </Typography>
        <Box
          display="flex"
          flexDirection="row"
          flexWrap="wrap"
          mt={2}
          mb={2}
          sx={{ columnGap: 10, rowGap: 2 }}>
          <DatasetOptions data={filteredData} />
          <CisViewOptions
            maxCsSize={maxCsSize}
            setMaxCsSize={setMaxCsSize}
            minLeadMlog10p={minLeadMlog10p}
            setMinLeadMlog10p={setMinLeadMlog10p}
            codingOnly={codingOnly}
            setCodingOnly={setCodingOnly}
            disabled={false}
          />
        </Box>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 2 }}>
          <IconButton size="small" onClick={() => setShowHelp(!showHelp)} sx={{ mt: 0.5 }}>
            <HelpOutlineIcon />
          </IconButton>
          <Collapse in={showHelp}>
            <Typography>Each row represents a credible set.</Typography>
            <Box mb={2} />
            <Typography>
              The arrow before the trait name on the left shows signal direction: up for
              risk/increasing (red) and down for protective/decreasing (green).
            </Typography>
            <Typography>
              The number before the trait name shows the number of variants in the credible set.
              Hover over the trait name to see the top variant in that credible set.
            </Typography>
            <Box mb={2} />
            <Typography>
              The height of each bar represents the posterior inclusion probability (PIP) of the
              variant in the credible set.
            </Typography>
            <Typography>
              Different data sources have different colors. pLoF variants are highlighted in red and
              other coding variants in orange.
            </Typography>
            <Box mb={2} />
            <Typography>
              eQTL and pQTL variants that affect the input gene are shown. There can be other QTL
              variants affecting other genes in the region but they are not shown.
            </Typography>
            <Typography>
              eQTL Catalogue credible sets are shown for gene-level expression (ge) quantification
              only.
            </Typography>
            <Typography>Shown allele frequencies are gnomAD global allele frequencies.</Typography>
            <Box mb={2} />
            <Typography style={{ marginBottom: "10px" }}>
              Hover over trait names or variants to highlight traits with an overlapping credible
              set. Hold <code>ctrl</code> and scroll on the credible set area to zoom.
            </Typography>
          </Collapse>
        </Box>
        <Box display="flex" flexDirection="row">
          <Box display="flex" flexDirection="column">
            <Box height={geneModelHeight} width={config.gene_view.titleWidth} />
            <Box sx={{ overflow: "hidden" }}>{titleRows}</Box>
          </Box>
          <CSPlot
            geneName={geneName}
            data={sortedData || []}
            range={range?.slice(1) || [0, 0, 0]}
            resources={config.gene_view.resources}
            width={windowWidth - config.gene_view.titleWidth - 50 - config.gene_view.transGeneWidth}
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
          <Box display="flex" flexDirection="column" gap={1}>
            {/* TODO cis/trans indicator */}
            {/* TODO indicator if gene is on Olink/SomaScan */}
            <Typography style={{ fontWeight: "bold" }}>pQTLs</Typography>
            <AffectedGeneList
              geneName={geneName}
              gene2cs={genesAffectedByInputGene2CS}
              width={config.gene_view.transGeneWidth}
              title={`Variants in ${geneName} affect these genes`}
              noDataTitle={`No genes found to be affected by variants in ${geneName}`}
              highlightedVariant={highlightedVariant}
            />
            <AffectingGeneList
              geneName={geneName}
              gene2cs={genesAffectingInputGene2CS}
              width={config.gene_view.transGeneWidth}
              title={`Variants in these genes affect ${geneName}`}
              noDataTitle={`No genes found to affect ${geneName}`}
            />
          </Box>
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
