#!/usr/bin/env python3

# adapted from https://github.com/FINNGEN/genotype_browser/blob/main/scripts/populate_sqlite.py

import gzip
import json
import timeit
import sqlite3
import argparse

# TODO pub_date should be a date, not a string
CREATE_STMT = """
CREATE TABLE IF NOT EXISTS trait (
    resource TEXT NOT NULL,
    data_type TEXT NOT NULL CHECK( data_type IN ('GWAS','eQTL','pQTL','sQTL','edQTL','metaboQTL','asmQTL') ),
    trait_type TEXT NOT NULL CHECK( trait_type IN ('continuous','case-control')),
    phenocode TEXT NOT NULL,
    phenostring TEXT NOT NULL,
    category TEXT,
    chromosome TEXT,
    gene_start UNSIGNED INTEGER,
    gene_end UNSIGNED INTEGER,
    strand SMALLINT,
    num_samples UNSIGNED INTEGER,
    num_cases UNSIGNED INTEGER,
    num_controls UNSIGNED INTEGER,
    pub_author TEXT,
    pub_date TEXT,
    PRIMARY KEY (resource, phenocode)
)
"""

DELETE_TEMPLATE = """
DELETE FROM trait WHERE resource = ?
"""

INSERT_TEMPLATE = (
    "INSERT INTO trait VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
)


def main():
    parser = argparse.ArgumentParser(
        description="Script for populating fine-mapping dataset/trait sqlite3 db from tab-delimited files."
    )
    parser.add_argument("db_name", help="sqlite3 db file to be created or overwritten")
    parser.add_argument(
        "--drop_table", help="drop existing db table", action="store_true"
    )
    parser.add_argument(
        "--resources",
        help="comma-separated list of resources to be included",
    )
    args = parser.parse_args()
    populate_traits(args)


def generate_entries_eqtl_cat(resource, filename, data_type):
    """
    Generator for eQTL Catalogue entries to be inserted into the sqlite3 db.
    Reads the input gzipped tsv eQTL Catalogue metadata file and yields a tuple for each row.
    """
    with gzip.open(filename, "rt") as f:
        h = {h: i for i, h in enumerate(f.readline().strip().split("\t"))}
        for line in f:
            s = line.strip().split("\t")
            yield (
                (
                    resource,
                    data_type,
                    "continuous",
                    s[h["phenotype_id"]],
                    s[h["gene_name"]],
                    None,
                    s[h["chromosome"]],
                    s[h["gene_start"]],
                    s[h["gene_end"]],
                    s[h["strand"]],
                    None,
                    None,
                    None,
                    None,
                    None,
                )
            )


def generate_entries_eqtl_cat_with_dataset(
    resource, dataset, filename_template, data_type
):
    with gzip.open(filename_template.replace("[STUDY]", dataset), "rt") as f:
        h = {h: i for i, h in enumerate(f.readline().strip().split("\t"))}
        for line in f:
            s = line.strip().split("\t")
            yield (
                (
                    resource,
                    data_type,
                    "continuous",
                    dataset + ":" + s[h["phenotype_id"]],
                    s[h["gene_name"]],
                    None,
                    s[h["chromosome"]],
                    s[h["gene_start"]],
                    s[h["gene_end"]],
                    s[h["strand"]],
                    None,
                    None,
                    None,
                    None,
                    None,
                )
            )


def generate_entries_ukbb_bbj(filename):
    with open(filename, "rt") as f:
        h = {h: i for i, h in enumerate(f.readline().strip().split("\t"))}
        for line in f:
            s = line.strip().split("\t")
            yield (
                (
                    s[h["cohort"]],
                    "GWAS",
                    "continuous" if s[h["n_cases"]] == "NA" else "case-control",
                    s[h["trait"]],
                    s[h["description"]],
                    None,
                    None,
                    None,
                    None,
                    None,
                    int(s[h["n_samples"]]),
                    int(s[h["n_cases"]]) if s[h["n_cases"]] != "NA" else None,
                    int(s[h["n_controls"]]) if s[h["n_controls"]] != "NA" else None,
                    "Kanai",
                    "2021-09-05",
                )
            )


def generate_entries_opentargets(resource, filename):
    with open(filename, "r") as f:
        ot_phenos = json.load(f)
    for p in ot_phenos.values():
        yield (
            (
                resource,
                "GWAS",
                "continuous" if p["n_cases"] == "None" else "case-control",
                p["study_id"],
                p["trait_reported"],
                p["trait_category"],
                None,
                None,
                None,
                None,
                int(p["n_initial"]),
                int(p["n_cases"]) if p["n_cases"] != "None" else None,
                (
                    int(p["n_initial"]) - int(p["n_cases"])
                    if p["n_cases"] != "None"
                    else None
                ),
                p["pub_author"],
                p["pub_date"],
            )
        )


def generate_entries_finngen(resource, filename, date):
    with open(filename, "r") as f:
        phenos = json.load(f)
    for p in phenos:
        yield (
            (
                resource,
                "GWAS",
                "continuous" if p["num_controls"] == 0 else "case-control",
                p["phenocode"],
                p["phenostring"],
                p["category"],
                None,
                None,
                None,
                None,
                (
                    p["num_cases"]
                    if p["num_controls"] == 0
                    else p["num_cases"] + p["num_controls"]
                ),
                None if p["num_controls"] == 0 else p["num_cases"],
                None if p["num_controls"] == 0 else p["num_controls"],
                "FinnGen",
                date,
            )
        )


def generate_entries_finngen_ukbb_meta(resource, filename, date):
    with open(filename, "r") as f:
        phenos = json.load(f)
    for p in phenos:
        yield (
            (
                resource,
                "GWAS",
                "continuous" if p["fg_n_controls"] == 0 else "case-control",
                p["phenocode"],
                p["phenostring"],
                p["category"],
                None,
                None,
                None,
                None,
                (
                    p["fg_n_cases"] + p["ukbb_n_cases"]
                    if p["fg_n_controls"] == 0
                    else p["fg_n_cases"]
                    + p["ukbb_n_cases"]
                    + p["fg_n_controls"]
                    + p["ukbb_n_controls"]
                ),
                (
                    None
                    if p["fg_n_controls"] == 0
                    else p["fg_n_cases"] + p["ukbb_n_cases"]
                ),
                (
                    None
                    if p["fg_n_controls"] == 0
                    else p["fg_n_controls"] + p["ukbb_n_controls"]
                ),
                "FinnGen",
                date,
            )
        )


def generate_entries_finngen_mvp_ukbb_meta(resource, filename, date):
    with open(filename, "r") as f:
        phenos = json.load(f)
    for p in phenos:
        yield (
            (
                resource,
                "GWAS",
                "continuous" if p["fg_n_controls"] == 0 else "case-control",
                p["phenocode"],
                p["phenostring"],
                p["category"],
                None,
                None,
                None,
                None,
                p["num_cases"] + p["num_controls"],
                p["num_cases"],
                p["num_controls"],
                "FinnGen",
                date,
            )
        )


def generate_entries_soma(resource, source_name, filename, n_samples, date):
    with open(filename, "r") as f:
        h = {h: i for i, h in enumerate(f.readline().strip().split("\t"))}
        for line in f:
            s = line.strip().split("\t")
            yield (
                (
                    resource,
                    "pQTL",
                    "continuous",
                    s[h["AptName"]],
                    s[h["Gene name"]],
                    None,
                    s[h["Chromosome/scaffold name"]],
                    s[h["Gene start (bp)"]],
                    s[h["Gene end (bp)"]],
                    s[h["Strand"]],
                    n_samples,
                    None,
                    None,
                    source_name,
                    date,
                )
            )


def generate_entries_olink(resource, source_name, filename, n_samples, date):
    with open(filename, "r") as f:
        h = {h: i for i, h in enumerate(f.readline().strip().split("\t"))}
        for line in f:
            s = line.strip().split("\t")
            yield (
                (
                    resource,
                    "pQTL",
                    "continuous",
                    s[h["geneName"]],
                    s[h["geneName"]],
                    None,
                    s[h["Chromosome/scaffold name"]],
                    s[h["Gene start (bp)"]],
                    s[h["Gene end (bp)"]],
                    s[h["Strand"]],
                    n_samples,
                    None,
                    None,
                    source_name,
                    date,
                )
            )


def generate_entries_finngen_eqtl(resource, source_name, filename, n_samples, date):
    with open(filename, "r") as f:
        h = {h: i for i, h in enumerate(f.readline().strip().split("\t"))}
        for line in f:
            s = line.strip().split("\t")
            yield (
                (
                    resource,
                    "eQTL",
                    "continuous",
                    s[h["Gene stable ID"]],
                    s[h["Gene name"]],
                    None,
                    s[h["Chromosome/scaffold name"]],
                    s[h["Gene start (bp)"]],
                    s[h["Gene end (bp)"]],
                    s[h["Strand"]],
                    n_samples,
                    None,
                    None,
                    source_name,
                    date,
                )
            )


def generate_entries_decode_pqtl(
    resource, filename_probemap, filename_probelist, num_samples, date
):
    with open(filename_probemap, "r") as f:
        h = {h: i for i, h in enumerate(f.readline().strip().split("\t"))}
        probe2meta = {
            line.strip().split("\t")[h["AptName"]]: line.strip().split("\t")
            for line in f
        }
    with open(filename_probelist, "r") as f:
        for line in f:
            p = line.strip().split("\t")
            # for missing gene names keep probe name
            phenostring = (
                probe2meta[p[0]][h["Gene name"]] if p[0] in probe2meta else p[0]
            )
            if phenostring == "NA":
                phenostring = p[0]
            organism = probe2meta[p[0]][h["Organism"]] if p[0] in probe2meta else None
            chromosome = (
                probe2meta[p[0]][h["Chromosome/scaffold name"]]
                if p[0] in probe2meta
                else None
            )
            gene_start = (
                probe2meta[p[0]][h["Gene start (bp)"]] if p[0] in probe2meta else None
            )
            gene_end = (
                probe2meta[p[0]][h["Gene end (bp)"]] if p[0] in probe2meta else None
            )
            strand = probe2meta[p[0]][h["Strand"]] if p[0] in probe2meta else None
            yield (
                (
                    resource,
                    "pQTL",
                    "continuous",
                    p[0],
                    phenostring,
                    None if organism == "NA" else organism,
                    None if chromosome == "NA" else chromosome,
                    None if gene_start == "NA" else gene_start,
                    None if gene_end == "NA" else gene_end,
                    None if strand == "NA" else strand,
                    num_samples,
                    None,
                    None,
                    "deCODE genetics",
                    date,
                )
            )


# zcat GTEx_v8_edQTL.tsv.gz | cut -f4 | tail -n+2  | sort -u > GTEx_v8_edQTL.traits
def generate_entries_edqtl(resource, filename, date):
    with open(filename, "r") as f:
        for line in f:
            p = line.strip().split("\t")
            yield (
                (
                    resource,
                    "edQTL",
                    "continuous",
                    p[0],
                    p[0],
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    "GTEx",
                    date,
                )
            )


# gsutil cat red/nmr/Variable_description_*.csv | grep -v DATATYPE_FORMAT_ID | cut -d';' -f2-4 | tr ';' '\t' | sort -u > nmr_phenos.tsv
def generate_entries_nmr(resource, filename, num_samples, date):
    with open(filename, "r") as f:
        for line in f:
            p = line.strip().split("\t")
            yield (
                (
                    resource,
                    "metaboQTL",
                    "continuous",
                    p[0],
                    p[2].capitalize(),
                    "Nuclear Magnetic Resonance",
                    None,
                    None,
                    None,
                    None,
                    num_samples,
                    None,
                    None,
                    "FinnGen",
                    date,
                )
            )


def populate_traits(args):
    start_time = timeit.default_timer()
    conn = sqlite3.connect(args.db_name)
    c = conn.cursor()

    if args.drop_table:
        print("Dropping trait table if it exists...")
        c.execute("DROP TABLE IF EXISTS trait")
        print(str(timeit.default_timer() - start_time) + " seconds dropping table")
        start_time = timeit.default_timer()
    c.execute(CREATE_STMT)

    print("Populating trait table...")
    n_datasets = 0

    for resource in args.resources.split(","):
        print(resource)
        c.execute(DELETE_TEMPLATE, (resource,))
        if resource == "eQTL_Catalogue_R7":
            for file in [
                (
                    "/mnt/disks/data/eqtl_catalogue_r7/metadata/Affy_Human_Gene_1_0_ST_Ensembl_96_phenotype_metadata.tsv.gz",
                    "eQTL",
                ),
                (
                    "/mnt/disks/data/eqtl_catalogue_r7/metadata/HumanHT-12_V4_Ensembl_96_phenotype_metadata.tsv.gz",
                    "eQTL",
                ),
                (
                    "/mnt/disks/data/eqtl_catalogue_r7/metadata/SomaLogic_Ensembl_96_phenotype_metadata.tsv.gz",
                    "pQTL",
                ),
                (
                    "/mnt/disks/data/eqtl_catalogue_r7/metadata/exon_counts_Ensembl_105_phenotype_metadata.tsv.gz",
                    "eQTL",
                ),
                (
                    "/mnt/disks/data/eqtl_catalogue_r7/metadata/gene_counts_Ensembl_105_phenotype_metadata.tsv.gz",
                    "eQTL",
                ),
                (
                    "/mnt/disks/data/eqtl_catalogue_r7/metadata/transcript_usage_Ensembl_105_phenotype_metadata.tsv.gz",
                    "eQTL",
                ),
                (
                    "/mnt/disks/data/eqtl_catalogue_r7/metadata/txrevise_Ensembl_105_phenotype_metadata.tsv.gz",
                    "eQTL",
                ),
            ]:
                c.executemany(
                    INSERT_TEMPLATE,
                    generate_entries_eqtl_cat(resource, file[0], file[1]),
                )
            print("eQTL Catalogue - Leafcutter")
            for line in open(
                "/mnt/disks/data/eqtl_catalogue_r7/leafcutter_studies", "rt"
            ).readlines():
                c.executemany(
                    INSERT_TEMPLATE,
                    generate_entries_eqtl_cat_with_dataset(
                        resource,
                        line.strip(),
                        "/mnt/disks/data/eqtl_catalogue_r7/metadata/leafcutter_[STUDY]_Ensembl_105_phenotype_metadata.tsv.gz",
                        "sQTL",
                    ),
                )
            n_datasets += 1

        if resource == "Open_Targets":
            c.executemany(
                INSERT_TEMPLATE,
                generate_entries_opentargets(
                    resource,
                    "/mnt/disks/data/opentargets/ot_studies_no_finngen_22.09.json",
                ),
            )
            n_datasets += 1

        if resource == "deCODE":
            c.executemany(
                INSERT_TEMPLATE,
                generate_entries_decode_pqtl(
                    resource,
                    "/mnt/disks/data/Soma_info_all_ensembl.tsv",
                    "/mnt/disks/data/decode_probes",
                    35559,
                    "2021-12-02",
                ),
            )
            n_datasets += 1

        if resource == "FinnGen":
            c.executemany(
                INSERT_TEMPLATE,
                generate_entries_finngen(
                    resource,
                    "/mnt/disks/data/R12_pheno.json",
                    "2023-10-25",
                ),
            )
            n_datasets += 1

        if resource == "FinnGen_UKBB_meta":
            c.executemany(
                INSERT_TEMPLATE,
                generate_entries_finngen_ukbb_meta(
                    resource,
                    "/mnt/disks/data/fg-ukb-meta-2022-11-pheno-list.json",
                    "2023-12-08",
                ),
            )
            n_datasets += 1

        if resource == "FinnGen_MVP_UKBB_meta":
            c.executemany(
                INSERT_TEMPLATE,
                generate_entries_finngen_mvp_ukbb_meta(
                    resource,
                    "/mnt/disks/data/fg-mvp-ukb-meta-2024-11-pheno-list.json",
                    "2024-11-09",
                ),
            )
            n_datasets += 1

        if resource == "FinnGen_pQTL":
            c.executemany(
                INSERT_TEMPLATE,
                generate_entries_soma(
                    "FinnGen_pQTL",
                    "FinnGen",
                    "/mnt/disks/data/Soma_info_all_ensembl.tsv",
                    828,
                    "2023-03-02",
                ),
            )
            c.executemany(
                INSERT_TEMPLATE,
                generate_entries_olink(
                    "FinnGen_pQTL",
                    "FinnGen",
                    "/mnt/disks/data/olink_probe_map_ensembl.tsv",
                    1732,
                    "2023-10-11",
                ),
            )
            n_datasets += 1

        if resource == "FinnGen_eQTL":
            c.executemany(
                INSERT_TEMPLATE,
                generate_entries_finngen_eqtl(
                    "FinnGen_eQTL",
                    "FinnGen",
                    "/mnt/disks/data/rnaseq_ensembl.tsv",
                    360,
                    "2023-10-05",
                ),
            )
            n_datasets += 1

        if resource == "UKBB_pQTL":
            c.executemany(
                INSERT_TEMPLATE,
                generate_entries_olink(
                    "UKBB_pQTL",
                    "UKBB",
                    "/mnt/disks/data/olink_probe_map_ensembl.tsv",
                    44755,
                    "2024-01-30",
                ),
            )
            n_datasets += 1

        if resource == "UKBB_BBJ":
            c.execute(DELETE_TEMPLATE, ("UKBB_119",))
            c.execute(DELETE_TEMPLATE, ("BBJ_79",))
            c.executemany(
                INSERT_TEMPLATE,
                generate_entries_ukbb_bbj("/mnt/disks/data/ukb_bbj_traits.tsv"),
            )
            n_datasets += 1

        if resource == "GTEx_v8_edQTL":
            c.executemany(
                INSERT_TEMPLATE,
                generate_entries_edqtl(
                    resource, "/mnt/disks/data/GTEx_v8_edQTL.traits", "2022-08-03"
                ),
            )
            n_datasets += 1

        if resource == "NMR":
            c.executemany(
                INSERT_TEMPLATE,
                generate_entries_nmr(
                    resource, "/mnt/disks/data/nmr_phenos.tsv", 28844, "2024-10-28"
                ),
            )
            n_datasets += 1

    conn.commit()
    conn.close()
    print(
        str(timeit.default_timer() - start_time)
        + " seconds populating traits ("
        + str(n_datasets)
        + " datasets)"
    )


if __name__ == "__main__":
    main()
