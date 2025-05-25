import {
  Phenotype,
  VariantRecord,
  TableData,
  GroupedAssocRecord,
  AssocRecord,
  PhenoMap,
  AssocResource,
  FineMappedRecord,
  GroupedFineMappedRecord,
  FineMappedResource,
  PhenoSummaryTableData,
  DataType,
  QTLType,
  TissueSummaryTableData,
} from "../types/types";

const groupAssocPhenos = (d: AssocRecord[], phenos: PhenoMap) => {
  return Object.values(
    d.reduce((p, c) => {
      const pheno = phenos[c.resource + ":" + c.phenocode];
      const groupId: string =
        c.resource +
        ":" +
        c.dataset +
        ":" +
        pheno.phenostring +
        ":" +
        (c.beta > 0 ? "up" : c.beta < 0 ? "down" : "NA");
      if (p[groupId] === undefined) {
        p[groupId] = {
          id: groupId,
          resource: pheno.resource,
          dataset: c.dataset,
          data_type: c.data_type,
          phenostring: pheno.phenostring,
          phenocode: [pheno.phenocode],
          mlog10p: [c.mlog10p],
          beta: [c.beta],
          sebeta: [c.sebeta],
          ld: [c.ld],
          lead: [c.lead || false],
          overall_r2: [c.overall_r2 || undefined],
          lead_chr: [c.lead_chr || undefined],
          lead_pos: [c.lead_pos || undefined],
          lead_ref: [c.lead_ref || undefined],
          lead_alt: [c.lead_alt || undefined],
          count: 1,
        };
      } else {
        p[groupId]["phenocode"].push(pheno.phenocode);
        p[groupId]["mlog10p"].push(c.mlog10p);
        p[groupId]["beta"].push(c.beta);
        p[groupId]["sebeta"].push(c.sebeta);
        p[groupId]["ld"].push(c.ld);
        p[groupId]["overall_r2"].push(c.overall_r2 || undefined);
        p[groupId]["lead"].push(c.lead || false);
        p[groupId]["lead_chr"].push(c.lead_chr || undefined);
        p[groupId]["lead_pos"].push(c.lead_pos || undefined);
        p[groupId]["lead_ref"].push(c.lead_ref || undefined);
        p[groupId]["lead_alt"].push(c.lead_alt || undefined);
        p[groupId]["count"] += 1;
      }
      // remove results that are in LD when there is also a result of the exact variant
      Object.keys(p).forEach((key) => {
        if (p[key].ld.includes(true) && p[key].ld.includes(false)) {
          const ld_idxs = p[key].ld.map((ld, idx) => (ld ? idx : -1)).filter((idx) => idx !== -1);
          Object.keys(p[key]).forEach((k) => {
            if (Array.isArray(p[key][k as keyof GroupedAssocRecord])) {
              // @ts-ignore
              p[key][k] = p[key][k].filter((_, idx) => !ld_idxs.includes(idx));
            }
          });
        }
      });
      // remove results that are from LD data and the LD variant is not the lead when there is also a result where the exact variant is the lead
      Object.keys(p).forEach((key) => {
        if (p[key].lead.includes(true) && p[key].lead.includes(false)) {
          const lead_idxs = p[key].lead
            .map((lead, idx) => (lead ? idx : -1))
            .filter((idx) => idx !== -1);
          Object.keys(p[key]).forEach((k) => {
            if (Array.isArray(p[key][k as keyof GroupedAssocRecord])) {
              // @ts-ignore
              p[key][k] = p[key][k].filter((_, idx) => lead_idxs.includes(idx));
            }
          });
        }
        p[key].count = new Set(p[key].phenocode).size;
      });
      return p;
    }, {} as Record<string, GroupedAssocRecord>)
  );
};

const countAssocPhenos = (d: GroupedAssocRecord[], resources: Array<AssocResource>) => {
  const total = {
    up: d.filter((d) => d.beta[0] > 0).length,
    down: d.filter((d) => d.beta[0] < 0).length,
    // placeholder phenos have beta 0..
    total: d.filter((d) => d.beta[0] != 0).length,
  };
  const datasetsInitial = resources
    .map((d) => d.resource)
    .reduce((p, c) => {
      p[c] = {
        up: 0,
        down: 0,
        total: 0,
      };
      return p;
    }, {} as Record<string, { up: number; down: number; total: 0 }>);
  const resource = d.reduce((p, c) => {
    if (c.beta[0] > 0) {
      p[c.resource].up += 1;
      p[c.resource].total += 1;
    } else if (c.beta[0] < 0) {
      p[c.resource].down += 1;
      p[c.resource].total += 1;
    }
    return p;
  }, datasetsInitial);
  const dqtl = d.filter((d) => d.data_type.endsWith("QTL"));
  const qtl = {
    up: dqtl.filter((d) => d.beta[0] > 0).length,
    down: dqtl.filter((d) => d.beta[0] < 0).length,
    total: dqtl.length,
  };
  const deqtl = dqtl.filter((d) => d.data_type === DataType.EQTL);
  const eqtl = {
    up: deqtl.filter((d) => d.beta[0] > 0).length,
    down: deqtl.filter((d) => d.beta[0] < 0).length,
    total: deqtl.length,
  };
  const dpqtl = dqtl.filter((d) => d.data_type === DataType.PQTL);
  const pqtl = {
    up: dpqtl.filter((d) => d.beta[0] > 0).length,
    down: dpqtl.filter((d) => d.beta[0] < 0).length,
    total: dpqtl.length,
  };
  const dsqtl = dqtl.filter((d) => d.data_type === DataType.SQTL);
  const sqtl = {
    up: dsqtl.filter((d) => d.beta[0] > 0).length,
    down: dsqtl.filter((d) => d.beta[0] < 0).length,
    total: dsqtl.length,
  };
  const dedqtl = dqtl.filter((d) => d.data_type === DataType.EDQTL);
  const edqtl = {
    up: dedqtl.filter((d) => d.beta[0] > 0).length,
    down: dedqtl.filter((d) => d.beta[0] < 0).length,
    total: dedqtl.length,
  };
  const dmetaboqtl = dqtl.filter((d) => d.data_type === DataType.METABOQTL);
  const metaboqtl = {
    up: dmetaboqtl.filter((d) => d.beta[0] > 0).length,
    down: dmetaboqtl.filter((d) => d.beta[0] < 0).length,
    total: dmetaboqtl.length,
  };
  const dgwas = d.filter((d) => d.data_type === DataType.GWAS);
  const gwas = {
    up: dgwas.filter((d) => d.beta[0] > 0).length,
    down: dgwas.filter((d) => d.beta[0] < 0).length,
    total: dgwas.length,
  };
  return { total, resource, eqtl, pqtl, sqtl, edqtl, metaboqtl, qtl, gwas };
};

// convert array to a deduped array:
// only one item per dataset/trait/direction, with possibly multiple molecular_trait_ids
// otherwise e.g. GTEx exons could be too many crowding out other datasets
// TODO is this still necessary now that eQTL Catalogue only has top cs?
const groupFineMappedTraits = (d: FineMappedRecord[]) => {
  // sort here by dataset, then by trait, then by direction, then by molecular_trait_id, then by pip
  // to make sure that exons will be in sorted order in grouping
  d.sort((a, b) => {
    if (a.dataset < b.dataset) {
      return -1;
    } else if (a.dataset > b.dataset) {
      return 1;
    } else if (a.phenocode < b.phenocode) {
      return -1;
    } else if (a.phenocode > b.phenocode) {
      return 1;
    } else if (a.beta < 0 && b.beta > 0) {
      return -1;
    } else if (a.beta > 0 && b.beta < 0) {
      return 1;
    } else if (a.phenocode < b.phenocode) {
      return -1;
    } else if (a.phenocode > b.phenocode) {
      return 1;
    } else if (a.pip > b.pip) {
      return -1;
    } else if (a.pip < b.pip) {
      return 1;
    }
    return 0;
  });
  const grouped = Object.values(
    d.reduce((p, c) => {
      const groupId: string = c.dataset + ":" + c["phenocode"] + ":" + (c.beta > 0 ? "up" : "down");
      if (p[groupId] === undefined) {
        p[groupId] = {
          id: groupId,
          resource: c.resource,
          dataset: c.dataset,
          data_type: c.data_type,
          phenocode: [c.phenocode],
          mlog10p: [c.mlog10p],
          beta: [c.beta],
          pip: [c.pip],
          cs_size: [c.cs_size],
          cs_min_r2: [c.cs_min_r2],
          count: 1,
          max_pip: c.pip,
        };
      } else {
        p[groupId]["phenocode"].push(c.phenocode);
        p[groupId]["mlog10p"].push(c.mlog10p);
        p[groupId]["beta"].push(c.beta);
        p[groupId]["pip"].push(c.pip);
        p[groupId]["cs_size"].push(c.cs_size);
        p[groupId]["cs_min_r2"].push(c.cs_min_r2);
        p[groupId]["count"] += 1;
        p[groupId]["max_pip"] = Math.max(p[groupId]["max_pip"], c.pip);
      }
      return p;
    }, {} as Record<string, GroupedFineMappedRecord>)
  );
  // sort groups by max PIP descending
  grouped.sort((a, b) => {
    if (a.max_pip > b.max_pip) {
      return -1;
    } else if (a.max_pip < b.max_pip) {
      return 1;
    }
    return 0;
  });
  return grouped;
};

const countFineMappedTraits = (
  d: GroupedFineMappedRecord[],
  resources: Array<FineMappedResource>
) => {
  const total = {
    up: d.filter((d) => d.beta[0] > 0).length,
    down: d.filter((d) => d.beta[0] < 0).length,
    total: d.length,
  };
  const resourcesInitial = resources
    .map((d) => d.resource)
    .reduce((p, c) => {
      p[c] = {
        up: 0,
        down: 0,
        total: 0,
      };
      return p;
    }, {} as Record<string, { up: number; down: number; total: 0 }>);
  const resource = d.reduce((p, c) => {
    if (c.beta[0] > 0) {
      p[c.resource].up += 1;
    } else {
      p[c.resource].down += 1;
    }
    p[c.resource].total += 1;
    return p;
  }, resourcesInitial);
  const dqtl = d.filter((d) => d.data_type.endsWith("QTL"));
  const qtl = {
    up: dqtl.filter((d) => d.beta[0] > 0).length,
    down: dqtl.filter((d) => d.beta[0] < 0).length,
    total: dqtl.length,
  };
  const deqtl = dqtl.filter((d) => d.data_type === DataType.EQTL);
  const eqtl = {
    up: deqtl.filter((d) => d.beta[0] > 0).length,
    down: deqtl.filter((d) => d.beta[0] < 0).length,
    total: deqtl.length,
  };
  const dpqtl = dqtl.filter((d) => d.data_type === DataType.PQTL);
  const pqtl = {
    up: dpqtl.filter((d) => d.beta[0] > 0).length,
    down: dpqtl.filter((d) => d.beta[0] < 0).length,
    total: dpqtl.length,
  };
  const dsqtl = dqtl.filter((d) => d.data_type === DataType.SQTL);
  const sqtl = {
    up: dsqtl.filter((d) => d.beta[0] > 0).length,
    down: dsqtl.filter((d) => d.beta[0] < 0).length,
    total: dsqtl.length,
  };
  const dedqtl = dqtl.filter((d) => d.data_type === DataType.EDQTL);
  const edqtl = {
    up: dedqtl.filter((d) => d.beta[0] > 0).length,
    down: dedqtl.filter((d) => d.beta[0] < 0).length,
    total: dedqtl.length,
  };
  const dmetaboqtl = dqtl.filter((d) => d.data_type === DataType.METABOQTL);
  const metaboqtl = {
    up: dmetaboqtl.filter((d) => d.beta[0] > 0).length,
    down: dmetaboqtl.filter((d) => d.beta[0] < 0).length,
    total: dmetaboqtl.length,
  };
  const dgwas = d.filter((d) => d.data_type === DataType.GWAS);
  const gwas = {
    up: dgwas.filter((d) => d.beta[0] > 0).length,
    down: dgwas.filter((d) => d.beta[0] < 0).length,
    total: dgwas.length,
  };
  return { total, resource, eqtl, pqtl, sqtl, edqtl, metaboqtl, qtl, gwas };
};

// change placeholder text according to p-value threshold
// this is quite a function
const changePlaceholderPhenostring = (
  resources: AssocResource[],
  selectedPheno: Phenotype | undefined,
  changePheno: Phenotype,
  p: number
) => {
  if (p < 1) {
    changePheno.phenostring =
      selectedPheno === undefined
        ? `No p < ${p} associations`
        : `No p < ${p} association with selected phenotype`;
  } else {
    changePheno.phenostring =
      selectedPheno === undefined
        ? `No associations ${resources
            .map((r) => `p < ${r.p_thres} in ${r.resource}`)
            .join(" or ")}`
        : `No p < ${
            resources.find((r) => r.resource == selectedPheno.resource)!.p_thres
          } association with selected phenotype`;
  }
};

export const isQTLInCis = (variant: string, p: Phenotype, cisWindow: number) => {
  if (p.data_type === DataType.METABOQTL) {
    return false;
  }
  const chr = variant.split("-")[0];
  if (
    !p.data_type.endsWith("QTL") ||
    p.chromosome !== chr ||
    p.gene_start === undefined ||
    p.gene_end === undefined ||
    p.strand === undefined
  ) {
    return false;
  }
  const pos = Number(variant.split("-")[1]);
  const start = p.strand === 1 ? p.gene_start : p.gene_end;
  return pos - cisWindow * 1e6 < start && pos + cisWindow * 1e6 > start;
};

export const isQTLInTrans = (variant: string, p: Phenotype, cisWindow: number) => {
  if (p.data_type === DataType.METABOQTL) {
    return false;
  }
  const chr = variant.split("-")[0];
  if (
    !p.data_type.endsWith("QTL") ||
    p.gene_start === undefined ||
    p.gene_end === undefined ||
    p.strand === undefined
  ) {
    return false;
  }
  if (p.chromosome !== chr) {
    return true;
  }
  return !isQTLInCis(variant, p, cisWindow);
};

export const filterRows = (
  data: TableData,
  assocTypes: Record<DataType, boolean>,
  gwasTypes: Record<string, boolean>,
  qtlTypes: Record<QTLType, boolean>,
  cisWindow: number,
  p: number,
  pip: number,
  pheno: Phenotype | undefined,
  keepPlaceholders: boolean
): TableData => {
  const startTime = performance.now();
  let newData = structuredClone(data.data) as VariantRecord[];
  newData.forEach((d) => {
    if (pheno === undefined) {
      // keep associations whose trait type is selected and with p-value < p
      // possibly keep the placeholders for no association
      d.assoc.data = d.assoc.data.filter((a) => {
        const assocPheno = data.phenos[a.resource + ":" + a.phenocode];
        return (
          (assocTypes[assocPheno.data_type] &&
            (assocPheno.data_type !== "GWAS" || gwasTypes[assocPheno.trait_type]) &&
            (!isQTLInCis(d.variant, assocPheno, cisWindow) || qtlTypes["CIS"]) &&
            (!isQTLInTrans(d.variant, assocPheno, cisWindow) || qtlTypes["TRANS"]) &&
            a.mlog10p > -Math.log10(p)) ||
          (keepPlaceholders && assocPheno.is_na)
        );
      });
    } else {
      // keep association whose trait type is selected and with p-value < p of the given phenotype
      // possibly keep the given phenotype's placeholder for no association
      d.assoc.data = d.assoc.data.filter((a) => {
        const assocPheno = data.phenos[a.resource + ":" + a.phenocode];
        return (
          (assocTypes[assocPheno.data_type] &&
            (assocPheno.data_type !== "GWAS" || gwasTypes[assocPheno.trait_type]) &&
            (!isQTLInCis(d.variant, assocPheno, cisWindow) || qtlTypes["CIS"]) &&
            (!isQTLInTrans(d.variant, assocPheno, cisWindow) || qtlTypes["TRANS"]) &&
            a.mlog10p > -Math.log10(p) &&
            a.resource == pheno.resource &&
            a.phenocode == pheno.phenocode) ||
          (keepPlaceholders && assocPheno.is_na && assocPheno.resource === assocPheno.resource)
        );
      });
    }
    if (d.assoc.data.length > 0) {
      const firstPheno = data.phenos[d.assoc.data[0].resource + ":" + d.assoc.data[0].phenocode];
      if (firstPheno.is_na) {
        changePlaceholderPhenostring(data.meta.assoc.resources, pheno, firstPheno, p);
      }
    }
    d.finemapped.data = d.finemapped.data.filter((a) => a.pip >= pip);
    d.assoc.groupedData = groupAssocPhenos(d.assoc.data, data.phenos);
    d.assoc.counts = countAssocPhenos(d.assoc.groupedData, data.meta.assoc.resources);
    d.finemapped.groupedData = groupFineMappedTraits(d.finemapped.data);
    d.finemapped.counts = countFineMappedTraits(
      d.finemapped.groupedData,
      data.meta.finemapped.resources
    );
  });
  if (!keepPlaceholders) {
    // actually filter out variants with no associations
    newData = newData.filter((d) => d.assoc.data.length > 0);
  }
  console.info(`${(performance.now() - startTime) / 1000} seconds to filter rows`);
  return { ...data, data: newData };
};

export const summarizePhenotypes = (data: TableData): PhenoSummaryTableData => {
  const startTime = performance.now();
  data.data.forEach((d) => {
    d.assoc.data.forEach((a) => {
      a.beta_input = d.beta;
    });
  });
  const assocs: AssocRecord[] = data.data.flatMap((d) => d.assoc.data).filter((a) => !a.ld); // filter out ld variants
  // TODO keys of phenoCounts not used
  const phenoCounts = assocs.reduce((p, c) => {
    const id = c.resource + ":" + c.dataset + ":" + c.phenocode;
    p[id] = {
      resource: c.resource,
      dataset: c.dataset,
      phenocode: c.phenocode,
      consistent:
        ((p[id]?.consistent as number) || 0) +
        (c.beta_input !== undefined && c.beta * c.beta_input > 0 ? 1 : 0),
      opposite:
        ((p[id]?.opposite as number) || 0) +
        (c.beta_input !== undefined && c.beta * c.beta_input < 0 ? 1 : 0),
      total: ((p[id]?.total as number) || 0) + 1,
    };
    return p;
  }, {} as Record<string, Record<string, number | string>>);
  const summaryTableData: PhenoSummaryTableData = Object.entries(phenoCounts)
    .sort((a, b) => (b[1].total as number) - (a[1].total as number))
    .map((d) => ({
      pheno: data.phenos[d[1].resource + ":" + d[1].phenocode],
      dataset: d[1].dataset as string,
      total: d[1].total as number,
      consistent: d[1].consistent as number,
      opposite: d[1].opposite as number,
    }))
    .filter((d) => !d.pheno.is_na);
  console.log(summaryTableData);
  console.info(`${(performance.now() - startTime) / 1000} seconds to summarize over phenotypes`);
  return summaryTableData;
};

type TissueInfo = {
  count: number;
  qtlAssocs: VariantRecord[];
};

export const summarizeTissues = (data: TableData): TissueSummaryTableData => {
  const startTime = performance.now();
  const qtlAssocs: AssocRecord[][] = data.data.map((d) =>
    d.assoc.data.filter((item) => item.data_type.endsWith("QTL"))
  );
  const tissueCounts = qtlAssocs.reduce((acc: Record<string, TissueInfo>, d, dIndex) => {
    d.forEach((a) => {
      if (
        data.datasets[a.dataset] &&
        data.datasets[a.dataset].quant_method !== "ge" &&
        data.datasets[a.dataset].quant_method !== "leafcutter" &&
        data.datasets[a.dataset].quant_method !== "aptamer"
      ) {
        return;
      }
      const tissue_label = data.datasets[a.dataset]?.tissue_label || a.dataset; // TODO map FG and UK data to tissues
      if (!acc[tissue_label]) {
        acc[tissue_label] = { count: 0, qtlAssocs: [] };
      }
      const variantRecord = data.data[dIndex];
      const filteredAssocs = variantRecord.assoc.data.filter(
        (item) =>
          (data.datasets[item.dataset] &&
            data.datasets[item.dataset]?.tissue_label === tissue_label &&
            (data.datasets[item.dataset].quant_method === "ge" ||
              data.datasets[item.dataset].quant_method === "leafcutter" ||
              data.datasets[item.dataset].quant_method === "aptamer")) ||
          item.dataset === a.dataset // TODO map FG and UK data to tissues
      );
      const filteredFM = variantRecord.finemapped.data.filter(
        (item) =>
          (data.datasets[item.dataset] &&
            data.datasets[item.dataset]?.tissue_label === tissue_label &&
            // TODO these should be decided by the toggles, now showing all of these in the detail table even if the corresponding toggle is not on
            (data.datasets[item.dataset].quant_method === "ge" ||
              data.datasets[item.dataset].quant_method === "leafcutter" ||
              data.datasets[item.dataset].quant_method === "aptamer")) ||
          item.dataset === a.dataset // TODO map FG and UK data to tissues
      );
      const filteredVariantRecord = {
        ...variantRecord,
        assoc: {
          ...variantRecord.assoc,
          data: filteredAssocs,
          groupedData: groupAssocPhenos(filteredAssocs, data.phenos),
        },
        finemapped: {
          ...variantRecord.finemapped,
          data: filteredFM,
          groupedData: groupFineMappedTraits(filteredFM),
        },
      };
      const isVariantRecordPresent = acc[tissue_label].qtlAssocs.some(
        (vr) => vr.variant === filteredVariantRecord.variant
      );
      if (!isVariantRecordPresent) {
        acc[tissue_label].count += 1;
        acc[tissue_label].qtlAssocs.push(filteredVariantRecord);
      }
    });
    return acc;
  }, {});

  const tissueCountsArray = Object.entries(tissueCounts).map(([tissue, { count, qtlAssocs }]) => ({
    tissue,
    total: count,
    qtlAssocs,
  }));

  console.info(`${(performance.now() - startTime) / 1000} seconds to summarize over tissues`);
  return tissueCountsArray;
};
