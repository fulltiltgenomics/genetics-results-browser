/**
 * GTEx tissue palette and display labels, used by the gene view's expression plot and its GTEx table
 * so a tissue reads and colours identically in both.
 *
 * Colours and labels are the official ones from the GTEx portal
 * (https://gtexportal.org/api/v2/dataset/tissueSiteDetail, `colorHex` / `tissueSiteDetail`), keyed by
 * `tissueSiteDetailId` lowercased — which is exactly the `tissue_cell` id the results API emits.
 * GTEx's own label for BA24 has a typo ("Anterior qcingulate cortex"), corrected here.
 */

// [colour, display label] per official GTEx tissue (54 in v8/v10 tissueSiteDetail).
const GTEX_TISSUES: Record<string, [string, string]> = {
  "adipose_subcutaneous": ["#FF6600", "Adipose - Subcutaneous"],
  "adipose_visceral_omentum": ["#FFAA00", "Adipose - Visceral (Omentum)"],
  "adrenal_gland": ["#33DD33", "Adrenal Gland"],
  "artery_aorta": ["#FF5555", "Artery - Aorta"],
  "artery_coronary": ["#FFAA99", "Artery - Coronary"],
  "artery_tibial": ["#FF0000", "Artery - Tibial"],
  "bladder": ["#AA0000", "Bladder"],
  "brain_amygdala": ["#EEEE00", "Brain - Amygdala"],
  "brain_anterior_cingulate_cortex_ba24": ["#EEEE00", "Brain - Anterior cingulate cortex (BA24)"],
  "brain_caudate_basal_ganglia": ["#EEEE00", "Brain - Caudate (basal ganglia)"],
  "brain_cerebellar_hemisphere": ["#EEEE00", "Brain - Cerebellar Hemisphere"],
  "brain_cerebellum": ["#EEEE00", "Brain - Cerebellum"],
  "brain_cortex": ["#EEEE00", "Brain - Cortex"],
  "brain_frontal_cortex_ba9": ["#EEEE00", "Brain - Frontal Cortex (BA9)"],
  "brain_hippocampus": ["#EEEE00", "Brain - Hippocampus"],
  "brain_hypothalamus": ["#EEEE00", "Brain - Hypothalamus"],
  "brain_nucleus_accumbens_basal_ganglia": ["#EEEE00", "Brain - Nucleus accumbens (basal ganglia)"],
  "brain_putamen_basal_ganglia": ["#EEEE00", "Brain - Putamen (basal ganglia)"],
  "brain_spinal_cord_cervical_c-1": ["#EEEE00", "Brain - Spinal cord (cervical c-1)"],
  "brain_substantia_nigra": ["#EEEE00", "Brain - Substantia nigra"],
  "breast_mammary_tissue": ["#33CCCC", "Breast - Mammary Tissue"],
  "cells_cultured_fibroblasts": ["#AAEEFF", "Cells - Cultured fibroblasts"],
  "cells_ebv-transformed_lymphocytes": ["#CC66FF", "Cells - EBV-transformed lymphocytes"],
  "cervix_ectocervix": ["#FFCCCC", "Cervix - Ectocervix"],
  "cervix_endocervix": ["#CCAADD", "Cervix - Endocervix"],
  "colon_sigmoid": ["#EEBB77", "Colon - Sigmoid"],
  "colon_transverse": ["#CC9955", "Colon - Transverse"],
  "esophagus_gastroesophageal_junction": ["#8B7355", "Esophagus - Gastroesophageal Junction"],
  "esophagus_mucosa": ["#552200", "Esophagus - Mucosa"],
  "esophagus_muscularis": ["#BB9988", "Esophagus - Muscularis"],
  "fallopian_tube": ["#FFCCCC", "Fallopian Tube"],
  "heart_atrial_appendage": ["#9900FF", "Heart - Atrial Appendage"],
  "heart_left_ventricle": ["#660099", "Heart - Left Ventricle"],
  "kidney_cortex": ["#22FFDD", "Kidney - Cortex"],
  "kidney_medulla": ["#33FFC2", "Kidney - Medulla"],
  "liver": ["#AABB66", "Liver"],
  "lung": ["#99FF00", "Lung"],
  "minor_salivary_gland": ["#99BB88", "Minor Salivary Gland"],
  "muscle_skeletal": ["#AAAAFF", "Muscle - Skeletal"],
  "nerve_tibial": ["#FFD700", "Nerve - Tibial"],
  "ovary": ["#FFAAFF", "Ovary"],
  "pancreas": ["#995522", "Pancreas"],
  "pituitary": ["#AAFF99", "Pituitary"],
  "prostate": ["#DDDDDD", "Prostate"],
  "skin_not_sun_exposed_suprapubic": ["#0000FF", "Skin - Not Sun Exposed (Suprapubic)"],
  "skin_sun_exposed_lower_leg": ["#7777FF", "Skin - Sun Exposed (Lower leg)"],
  "small_intestine_terminal_ileum": ["#555522", "Small Intestine - Terminal Ileum"],
  "spleen": ["#778855", "Spleen"],
  "stomach": ["#FFDD99", "Stomach"],
  "testis": ["#AAAAAA", "Testis"],
  "thyroid": ["#006600", "Thyroid"],
  "uterus": ["#FF66FF", "Uterus"],
  "vagina": ["#FF5599", "Vagina"],
  "whole_blood": ["#FF00BB", "Whole Blood"],
};

// v10 splits several tissues into sub-regions / cell fractions (liver_hepatocyte, pancreas_islets,
// stomach_mucosa, …) that have no entry of their own in the portal palette. They take the parent
// tissue's colour — the palette already colours sub-regions alike, e.g. all 13 brain regions share
// #EEEE00 — and its label with the suffix appended, which is what tells them apart.
const PARENT_IDS = Object.keys(GTEX_TISSUES).sort((a, b) => b.length - a.length);
const resolved = new Map<string, [string, string]>();

// colour + label for a tissue id, falling back to the longest parent-tissue prefix and finally to a
// neutral grey with the raw id spaced out
const resolve = (tissue: string): [string, string] => {
  const known = GTEX_TISSUES[tissue];
  if (known) return known;
  const cached = resolved.get(tissue);
  if (cached) return cached;
  const parent = PARENT_IDS.find((id) => tissue.startsWith(`${id}_`));
  const entry: [string, string] = parent
    ? [
        GTEX_TISSUES[parent][0],
        `${GTEX_TISSUES[parent][1]} (${tissue.slice(parent.length + 1).replace(/_/g, " ")})`,
      ]
    : ["#AAAAAA", tissue.replace(/_/g, " ")];
  resolved.set(tissue, entry);
  return entry;
};

export const gtexTissueColor = (tissue: string): string => resolve(tissue)[0];

export const gtexTissueLabel = (tissue: string): string => resolve(tissue)[1];
