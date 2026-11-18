import { Fragment, ReactNode, useState } from "react";
import { Box, Link, Typography } from "@mui/material";
import {
  useGeneAnnotation,
  useGeneConstraint,
  useGeneInfo,
  useGenesInRegion,
} from "@/store/serverQuery";
import type { GeneAnnotation, GoTerm } from "../../../bff/geneAnnotationTypes";
import { Section } from "./evidenceTable";
import GeneModelPlot from "./GeneModelPlot";
import {
  chrName,
  geneLinks,
  GO_ASPECTS,
  goUrl,
  interproUrl,
  pathwaySource,
} from "./geneAnnotation";

// GO and pathway lists run to over a hundred entries; this many are shown before the rest is asked for
const LINKS_SHOWN = 12;

const ExternalLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} target="_blank" rel="noopener noreferrer" underline="hover">
    {children}
  </Link>
);

const Heading = ({ children }: { children: ReactNode }) => (
  <Typography variant="subtitle2" sx={{ mt: 2.5, mb: 0.5, fontWeight: 700 }}>
    {children}
  </Typography>
);

const Facts = ({ rows }: { rows: [string, ReactNode][] }) => (
  <Typography
    variant="body2"
    component="div"
    sx={{
      display: "grid",
      gridTemplateColumns: "max-content 1fr",
      columnGap: 2,
      rowGap: 0.25,
    }}>
    {rows.map(([name, value]) => (
      <Fragment key={name}>
        <Box sx={{ color: "text.secondary" }}>{name}</Box>
        <Box>{value}</Box>
      </Fragment>
    ))}
  </Typography>
);

interface ListedLink {
  id: string;
  href: string;
  text: string;
}

// a long list is cut to its first items and shown in full on request
const LinkList = ({ items }: { items: ListedLink[] }) => {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, LINKS_SHOWN);
  return (
    <>
      {shown.map((item, i) => (
        <Fragment key={item.id}>
          {i > 0 && " · "}
          <ExternalLink href={item.href}>{item.text}</ExternalLink>
        </Fragment>
      ))}
      {items.length > LINKS_SHOWN && (
        <>
          {" · "}
          <Link component="button" onClick={() => setShowAll(!showAll)} sx={{ fontWeight: 600 }}>
            {showAll ? "show fewer" : `show all ${items.length}`}
          </Link>
        </>
      )}
    </>
  );
};

const GoTerms = ({ label, terms }: { label: string; terms: GoTerm[] }) => (
  <Box sx={{ mb: 1 }}>
    <Typography variant="body2" color="text.secondary">
      {label} ({terms.length})
    </Typography>
    <Typography variant="body2">
      <LinkList items={terms.map((t) => ({ id: t.id, href: goUrl(t.id), text: t.term }))} />
    </Typography>
  </Box>
);

const MyGeneAnnotation = ({ annotation }: { annotation: GeneAnnotation }) => {
  const goAspects = GO_ASPECTS.filter((a) => annotation.go[a.key].length > 0);
  return (
    <>
      {annotation.summary && (
        <>
          <Heading>Summary</Heading>
          <Typography variant="body2" sx={{ maxWidth: 900 }}>
            {annotation.summary}
          </Typography>
        </>
      )}
      {annotation.clingen.length > 0 && (
        <>
          <Heading>ClinGen gene-disease validity</Heading>
          {annotation.clingen.map((c) => (
            <Typography variant="body2" key={`${c.disease}|${c.classification}`}>
              {c.report ? <ExternalLink href={c.report}>{c.disease}</ExternalLink> : c.disease}
              {" · "}
              {c.classification}
              {c.modeOfInheritance && ` · ${c.modeOfInheritance}`}
            </Typography>
          ))}
        </>
      )}
      {annotation.interpro.length > 0 && (
        <>
          <Heading>Protein domains and families (InterPro)</Heading>
          <Typography variant="body2">
            <LinkList
              items={annotation.interpro.map((d) => ({
                id: d.id,
                href: interproUrl(d.id),
                text: d.desc,
              }))}
            />
          </Typography>
        </>
      )}
      {annotation.pathways.length > 0 && (
        <>
          <Heading>Pathways</Heading>
          <Facts
            rows={(["kegg", "reactome", "wikipathways"] as const).flatMap((source) => {
              const pathways = annotation.pathways.filter((p) => p.source === source);
              return pathways.length === 0
                ? []
                : [
                    [
                      `${pathwaySource(source).label} (${pathways.length})`,
                      <LinkList
                        key={source}
                        items={pathways.map((p) => ({
                          id: p.id,
                          href: pathwaySource(source).url(p.id),
                          text: p.name,
                        }))}
                      />,
                    ] as [string, ReactNode],
                  ];
            })}
          />
        </>
      )}
      {goAspects.length > 0 && (
        <>
          <Heading>Gene ontology</Heading>
          {goAspects.map((a) => (
            <GoTerms key={a.key} label={a.label} terms={annotation.go[a.key]} />
          ))}
        </>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
        summary, ClinGen, domains, pathways and gene ontology from{" "}
        <ExternalLink href="https://mygene.info">mygene.info</ExternalLink>
      </Typography>
    </>
  );
};

// a pLI near zero is a statement in itself, so it keeps its exponent instead of rounding to 0.00
const formatPli = (v: number): string => (v < 0.01 ? v.toExponential(1) : v.toFixed(2));

const na = <T,>(v: T | null, format: (v: T) => string): string => (v == null ? "NA" : format(v));

const GnomadConstraint = ({ ensemblId }: { ensemblId: string }) => {
  const constraint = useGeneConstraint(ensemblId);
  const c = constraint.data;
  return (
    <>
      <Heading>gnomAD</Heading>
      {constraint.isPending ? (
        <Typography variant="body2" color="text.secondary">
          loading…
        </Typography>
      ) : constraint.isError ? (
        <Typography variant="body2" color="error">
          failed to load: {constraint.error.message}
        </Typography>
      ) : !c ? (
        <Typography variant="body2" color="text.secondary">
          no gnomAD record for this gene
        </Typography>
      ) : (
        <Facts
          rows={[
            ["pLI", na(c.pLI, formatPli)],
            ["LOEUF", na(c.loeuf, (v) => v.toFixed(2))],
            ["observed LoF variants", na(c.observedLof, (v) => v.toLocaleString())],
            ["observed missense variants", na(c.observedMissense, (v) => v.toLocaleString())],
            ["ClinVar pathogenic", c.clinvar.pathogenic.toLocaleString()],
            [
              "ClinVar pathogenic/likely pathogenic",
              c.clinvar.pathogenicLikelyPathogenic.toLocaleString(),
            ],
            ["ClinVar likely pathogenic", c.clinvar.likelyPathogenic.toLocaleString()],
            ["constraint flags", c.flags.length > 0 ? c.flags.join(", ") : "none"],
          ]}
        />
      )}
    </>
  );
};

const GeneAnnotationSection = ({ geneName }: { geneName: string }) => {
  const info = useGeneInfo(geneName);
  const gene = info.data;
  const region = useGenesInRegion(gene?.chr, gene?.start, gene?.end);
  const model = region.data?.find((g) => g.geneName === gene?.symbol);
  const annotation = useGeneAnnotation(gene?.hgncId);
  // HGNC's aliases and previous symbols only: these are the ones the gene search resolves
  const aliases = gene?.aliases ?? [];
  const ensemblId = gene?.ensemblId ?? annotation.data?.ensemblGeneId ?? null;
  const links = gene ? geneLinks(gene, annotation.data ?? null) : [];

  return (
    <Section
      isPending={info.isPending}
      isError={info.isError}
      error={info.error}
      isEmpty={!gene}
      emptyText="gene not found">
      {gene && (
        <>
          <Typography variant="h6" sx={{ mb: 1 }}>
            {gene.symbol}
            {gene.name && (
              <Typography component="span" variant="body1" color="text.secondary" sx={{ ml: 1.5 }}>
                {gene.name}
              </Typography>
            )}
          </Typography>
          <Facts
            rows={[
              ...(aliases.length > 0
                ? [["also known as", aliases.join(", ")] as [string, string]]
                : []),
              [
                "location",
                [
                  annotation.data?.cytoband,
                  `chr${chrName(gene.chr)}:${gene.start.toLocaleString()}-${gene.end.toLocaleString()}`,
                  model && (model.strand === 1 ? "forward strand" : "reverse strand"),
                ]
                  .filter(Boolean)
                  .join(" · "),
              ],
              ...(annotation.data?.typeOfGene
                ? [["gene type", annotation.data.typeOfGene] as [string, string]]
                : []),
              ...(links.length > 0
                ? [
                    [
                      "links",
                      links.map((l, i) => (
                        <Fragment key={l.href}>
                          {i > 0 && " · "}
                          <ExternalLink href={l.href}>{l.label}</ExternalLink>
                        </Fragment>
                      )),
                    ] as [string, ReactNode],
                  ]
                : []),
            ]}
          />
          {model && (
            <Box sx={{ mt: 2, maxWidth: 900 }}>
              <GeneModelPlot model={model} />
            </Box>
          )}
          {ensemblId && <GnomadConstraint ensemblId={ensemblId} />}
          {gene.hgncId && (
            <Section
              isPending={annotation.isPending}
              isError={annotation.isError}
              error={annotation.error}
              isEmpty={!annotation.data}
              emptyText="no mygene.info record for this gene">
              {annotation.data && <MyGeneAnnotation annotation={annotation.data} />}
            </Section>
          )}
        </>
      )}
    </Section>
  );
};

export default GeneAnnotationSection;
