# adapted from
# https://github.com/FINNGEN/commons/blob/master/variant_annotation/scripts/hail_functions.py

# exports population AFs and VEP consequences and genes from the gnomAD sites tables, one
# locus-ordered TSV per data type; genetics-results-munge scripts/build_gnomad_annotation.py
# merges the genome and exome exports and keeps one row per variant
#
# gnomAD's shipped VEP is used as is, no re-VEP. 4.1.1 ships two annotations per variant:
# `vep` (the 4.1 annotation) and `vep115`; --vep-field picks one, and the choice decides the
# consequence terms and gene symbols every stamped credible set carries
#
# to start a cluster (only use a high number of workers if sure that this works):
# hailctl dataproc start gnomad --region us-central1 --zone us-central1-a --num-workers 2 \
#   --num-secondary-workers 16 --max-idle 30m
#
# to run the job, first on one contig, then whole:
# hailctl dataproc submit gnomad --region us-central1 gnomad_tsv.py --data-type genomes \
#   --vep-field vep115 --out-prefix gs://BUCKET/PREFIX --tmp-dir gs://BUCKET/TMP --contig chr21
#
# to stop the cluster (don't rely on the automatic idle shutdown):
# hailctl dataproc stop gnomad --region us-central1

import argparse

import hail as hl

VERSION = "4.1.1"

parser = argparse.ArgumentParser()
parser.add_argument("--data-type", choices=["genomes", "exomes"], required=True)
parser.add_argument("--vep-field", choices=["vep", "vep115"], required=True)
parser.add_argument("--out-prefix", required=True, help="gs:// prefix, no trailing slash")
parser.add_argument("--contig", help="export one contig only, e.g. chr21, to try the job cheaply")
parser.add_argument(
    "--tmp-dir",
    required=True,
    # the export stages every partition under the temp dir before concatenating; the default is
    # cluster HDFS, which only the primary workers hold and the genomes export fills
    help="gs:// directory for Hail's temporary files",
)
args = parser.parse_args()

hl.init(tmp_dir=args.tmp_dir)


def filter_table(table):
    if args.contig:
        return hl.filter_intervals(
            table, [hl.parse_locus_interval(args.contig, reference_genome="GRCh38")]
        )
    return table


def annotate_table(table):
    vep = table[args.vep_field]

    # not consequence_terms.contains(): on Hail 0.2.139 each call keeps a memory region until the
    # partition ends, and a task dies at the off-heap limit a few hundred variants in
    def has_most_severe(x):
        return (
            hl.len(x.consequence_terms.filter(lambda term: term == vep.most_severe_consequence)) > 0
        )

    # the predicates are coalesced because canonical and gene_symbol_source are missing on many
    # transcripts, and on Hail 0.2.139 filter(...).first() comes back missing when a missing
    # predicate precedes the first match
    canon_pc = vep.transcript_consequences.filter(
        lambda x: hl.coalesce(
            (x.canonical == 1)
            & (x.biotype == "protein_coding")
            & (x.gene_symbol_source != "Clone_based_ensembl_gene")
            & has_most_severe(x),
            False,
        )
    )

    most_severe = vep.transcript_consequences.filter(
        lambda x: hl.coalesce(
            (x.biotype == "protein_coding")
            & (x.gene_symbol_source != "Clone_based_ensembl_gene")
            & has_most_severe(x),
            False,
        )
    )

    most_severe_others = vep.transcript_consequences.filter(
        lambda x: (has_most_severe(x))
    )

    return table.annotate(
        chr=table.locus.contig.replace("^chr", ""),
        pos=hl.int32(table.locus.position),
        ref=table.alleles[0],
        alt=table.alleles[1],
        rsids=hl.str(",").join(table.rsid),
        filters=hl.str(",").join(table.filters),
        AN=table.freq[table.freq_index_dict["adj"]].AN,
        AF=table.freq[table.freq_index_dict["adj"]].AF,
        AF_afr=table.freq[table.freq_index_dict["afr_adj"]].AF,
        AF_amr=table.freq[table.freq_index_dict["amr_adj"]].AF,
        AF_asj=table.freq[table.freq_index_dict["asj_adj"]].AF,
        AF_eas=table.freq[table.freq_index_dict["eas_adj"]].AF,
        AF_fin=table.freq[table.freq_index_dict["fin_adj"]].AF,
        AF_mid=table.freq[table.freq_index_dict["mid_adj"]].AF,
        AF_nfe=table.freq[table.freq_index_dict["nfe_adj"]].AF,
        AF_remaining=table.freq[table.freq_index_dict["remaining_adj"]].AF,
        AF_sas=table.freq[table.freq_index_dict["sas_adj"]].AF,
        consequences=hl.array(
            hl.set(
                vep.transcript_consequences.map(
                    lambda x: hl.struct(
                        gene_symbol=x.gene_symbol,
                        gene_id=x.gene_id,
                        consequences=x.consequence_terms,
                        gene_symbol_source=x.gene_symbol_source,
                        canonical=x.canonical,
                        biotype=x.biotype,
                    )
                )
            )
        ),
        most_severe=vep.most_severe_consequence,
        gene_most_severe=hl.if_else(
            hl.len(canon_pc) > 0,
            canon_pc.first().gene_symbol,
            hl.if_else(
                hl.len(most_severe) > 0,
                most_severe.first().gene_symbol,
                most_severe_others.first().gene_symbol,
                missing_false=True,
            ),
            missing_false=True,
        ),
    )


def export(table, outfile):
    # the table stays keyed by locus until here, so the rows leave in reference order
    # (chr1..22, X, Y, M); re-keying on the string chr would shuffle all of gnomAD
    table.key_by().select(
        "#chr",
        "pos",
        "ref",
        "alt",
        "rsids",
        "filters",
        "AN",
        "AF",
        "AF_afr",
        "AF_amr",
        "AF_asj",
        "AF_eas",
        "AF_fin",
        "AF_mid",
        "AF_nfe",
        "AF_remaining",
        "AF_sas",
        "most_severe",
        "gene_most_severe",
        "consequences",
    ).export(outfile)


table = hl.read_table(
    f"gs://gcp-public-data--gnomad/release/{VERSION}/ht/{args.data_type}/"
    f"gnomad.{args.data_type}.v{VERSION}.sites.ht"
)

# the release of VEP, GENCODE and MANE behind the chosen annotation goes to the job log
print(hl.eval(table[f"{args.vep_field}_globals"].drop("vep_help", "vep_config")))

table = annotate_table(filter_table(table)).rename({"chr": "#chr"})
suffix = f".{args.contig}" if args.contig else ""
export(
    table,
    f"{args.out_prefix}/gnomad.{args.data_type}.v{VERSION}.sites.{args.vep_field}{suffix}.tsv.bgz",
)
