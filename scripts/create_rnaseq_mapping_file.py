## get unique ensembl ids is rna-seq sumstats
# gsutil cat gs://finngen-commons/sumstats_subset/FinnGen_snRNAseq_2023-10-05_sumstats.tsv.gz | \
# zcat | cut -f4 | tail -n+2 | sort -u > /mnt/disks/data/fg_rnaseq_ensg

import pandas as pd
import numpy as np

from chromosomes import chr_set

ensg_file = "/mnt/disks/data/fg_rnaseq_ensg"
anno_file = "/mnt/disks/data/mart_export_entrez_ens98.tsv"

a = pd.read_csv(ensg_file, names=["Gene stable ID"])

b = pd.read_csv(anno_file, sep="\t")
b = b[b["Chromosome/scaffold name"].isin(chr_set)]
b["Gene start (bp)"] = b.groupby("Gene stable ID")["Gene start (bp)"].transform("min")
b["Gene end (bp)"] = b.groupby("Gene stable ID")["Gene end (bp)"].transform("max")
b.drop_duplicates("Gene stable ID", inplace=True)

a.merge(b, how="left", on="Gene stable ID").astype(
    {"Gene start (bp)": "Int64", "Gene end (bp)": "Int64", "Strand": "Int64"}
).to_csv("/mnt/disks/data/rnaseq_ensembl.tsv", sep="\t", index=False, na_rep="NA")
