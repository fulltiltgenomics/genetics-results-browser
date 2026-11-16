# gsutil ls gs://finngen-production-library-green/omics/proteomics/release_2023_10_11/data/Olink/pQTL/*.gz | \
# xargs -I{} basename {} .txt.gz > /mnt/disks/data/fg_olink_probes
# gsutil ls gs://zz-red/Omics/Proteomics/UKB-PPP/pQTL2/*.txt.gz | \
# xargs -I{} basename {} .txt.gz > /mnt/disks/data/ukb_olink_probes
# cat /mnt/disks/data/fg_olink_probes /mnt/disks/data/ukb_olink_probes | sort -u > /mnt/disks/data/all_olink_probes

# gsutil ls gs://finngen-production-library-green/omics/proteomics/release_2023_03_02/data/Somascan/pQTL/*.gz | \
# xargs -I{} basename {} .txt.gz | sed 's/SomaScan_Batch2_//' > fg_soma_probes
# but this is not needed as all probes are already in the mapping file

# gsutil ls gs://zz-red/Omics/Proteomics/deCODE/pQTL/*.gz | \
# xargs -I{} basename {} .txt.gz | sed 's/deCODE_//' > decode_soma_probes
# this also is not needed because there are no probes in decode that would not be in fg

import pandas as pd
import numpy as np

from chromosomes import chr_set

soma_info_file = "/mnt/disks/data/Soma_info_all.csv"
entrez_file = "/mnt/disks/data/mart_export_entrez.tsv"
olink_probe_file = "/mnt/disks/data/all_olink_probes"
gene_name_file = "/mnt/disks/data/mart_export_gene_name.tsv"

# SomaScan

a = pd.read_csv(soma_info_file)
a.to_csv("/mnt/disks/data/Soma_info_all.tsv", sep="\t", index=False, na_rep="NA")
a["EntrezGeneID"] = a["EntrezGeneID"].astype(str)

b = pd.read_csv(entrez_file, sep="\t").rename(
    columns={"NCBI gene (formerly Entrezgene) ID": "EntrezGeneID"}
)
b = b[~np.isnan(b["EntrezGeneID"])]
b["EntrezGeneID"] = b["EntrezGeneID"].astype(int)
b["EntrezGeneID"] = b["EntrezGeneID"].astype(str)
a.merge(b, how="left", on="EntrezGeneID").astype(
    {"Gene start (bp)": "Int64", "Gene end (bp)": "Int64", "Strand": "Int64"}
).drop_duplicates("AptName").to_csv(
    "/mnt/disks/data/Soma_info_all_ensembl.tsv", sep="\t", index=False, na_rep="NA"
)

# Olink

a = pd.read_csv(olink_probe_file, names=["geneName"])

b = pd.read_csv(gene_name_file, sep="\t").rename(columns={"Gene name": "geneName"})
b = b[b["Chromosome/scaffold name"].isin(chr_set)]
b["Gene start (bp)"] = b.groupby("geneName")["Gene start (bp)"].transform("min")
b["Gene end (bp)"] = b.groupby("geneName")["Gene end (bp)"].transform("max")
b.drop_duplicates("geneName", inplace=True)

a.merge(b, how="left", on="geneName").astype(
    {"Gene start (bp)": "Int64", "Gene end (bp)": "Int64", "Strand": "Int64"}
).to_csv(
    "/mnt/disks/data/olink_probe_map_ensembl.tsv", sep="\t", index=False, na_rep="NA"
)
