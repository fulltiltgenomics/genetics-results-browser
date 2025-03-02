#!/usr/bin/env python

# first download from ensembl biomart two files
#
# 1. ../data/ensembl_anno.txt:
# Gene stable ID version
# Transcript stable ID version
# Chromosome/scaffold name
# Gene start (bp)
# Gene end (bp)
# Transcript start (bp)
# Transcript end (bp)
# Transcription start site (TSS)
# Strand
# Gene name
# Gene type
# Exon region start (bp)
# Exon region end (bp)
# Exon rank in transcript
# Exon stable ID
#
# 2: ../data/ensembl_canonical.txt
# Gene stable ID version
# Transcript stable ID version
# Ensembl Canonical

import polars as pl

chrs = {
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "11",
    "12",
    "13",
    "14",
    "15",
    "16",
    "17",
    "18",
    "19",
    "20",
    "21",
    "22",
    "X",
    "Y",
}

data = (
    pl.scan_csv("../data/ensembl_anno.txt", separator="\t", null_values=[""])
    .filter(pl.col("Chromosome/scaffold name").is_in(chrs))
    .filter(pl.col("Gene type").eq("protein_coding"))
    .filter(pl.col("Gene name").is_not_null())
    .join(
        pl.scan_csv("../data/ensembl_canonical.txt", separator="\t").filter(
            pl.col("Ensembl Canonical").eq(1)
        ),
        how="inner",
        on=["Gene stable ID version", "Transcript stable ID version"],
    )
    .sort(
        by=[
            "Chromosome/scaffold name",
            "Gene start (bp)",
            "Gene end (bp)",
            "Exon region start (bp)",
        ]
    )
    .rename({"Gene stable ID version": "#Gene stable ID version"})
    .collect()
)

data.write_csv("../data/ensembl_anno_canonical.tsv", separator="\t", null_value="NA")

data.select(
    [
        "#Gene stable ID version",
        "Chromosome/scaffold name",
        "Gene start (bp)",
        "Gene end (bp)",
        "Gene name",
    ]
).sort(
    by=["Chromosome/scaffold name", "Gene start (bp)", "Gene end (bp)"]
).unique().write_csv(
    "../data/ensembl_gene_pos.tsv", separator="\t", null_value="NA"
)
