/**
 * Cohort tokens of a multi-cohort meta-analysis (FinnGen R14 + MVP + UKBB + AoU) as results-api
 * emits them: ancestry-split tokens in /resource_metadata's `contributing_cohorts` and in the
 * per-cohort summary-stat columns, cohort families in the leave-one-out columns. Which cohorts a
 * phenotype has varies, so the sumstats columns are discovered from each response rather than
 * declared: a new ancestry block shows up without a code change, labelled by the fallback.
 */

// the one display-name map for cohort tokens; insertion order is the display order
const COHORT_LABELS: Record<string, string> = {
  fg: "FG",
  aou_eur: "AoU-EUR",
  aou_afr: "AoU-AFR",
  aou_amr: "AoU-AMR",
  aou_eas: "AoU-EAS",
  aou_sas: "AoU-SAS",
  aou_mid: "AoU-MID",
  ukbb_eur: "UKBB-EUR",
  mvp_eur: "MVP-EUR",
  mvp_afr: "MVP-AFR",
  mvp_amr: "MVP-AMR",
  // cohort families, which key the leave-one-out blocks
  aou: "AoU",
  ukbb: "UKBB",
  mvp: "MVP",
};
const LABEL_ORDER = Object.keys(COHORT_LABELS);

export const cohortLabel = (token: string): string =>
  COHORT_LABELS[token] ?? token.toUpperCase().replace(/_/g, "-");

// unknown tokens sort after the known ones, alphabetically among themselves
const tokenRank = (token: string): number => {
  const i = LABEL_ORDER.indexOf(token);
  return i === -1 ? LABEL_ORDER.length : i;
};
export const sortCohortTokens = (tokens: string[]): string[] =>
  [...tokens].sort((a, b) => tokenRank(a) - tokenRank(b) || a.localeCompare(b));

/** per-cohort sample size from /resource_metadata's `n_by_cohort`; a quantitative trait has no n_controls. */
export interface CohortN {
  n_cases?: number | null;
  n_controls?: number | null;
}

export const formatCohortN = (n: CohortN | undefined): string | undefined => {
  if (!n || n.n_cases == null) return undefined;
  return n.n_controls != null
    ? `${n.n_cases.toLocaleString()} cases / ${n.n_controls.toLocaleString()} controls`
    : `${n.n_cases.toLocaleString()} samples`;
};

const COHORT_FIELDS = ["beta", "se", "pval", "af", "r2"] as const;
const LEAVE_FIELDS = ["beta", "se", "pval", "mlog10p", "n", "het_p"] as const;
const COHORT_COLUMN = new RegExp(`^(fg|aou_\\w+|mvp_\\w+|ukbb_eur)_(${COHORT_FIELDS.join("|")})$`);
// the four known families only: an R13 meta or a pQTL table has leave_<cohort>_* columns of its own,
// and only a resource whose metadata lists contributing_cohorts is read through this module at all
const LEAVE_COLUMN = new RegExp(`^leave_(fg|aou|mvp|ukbb)_(${LEAVE_FIELDS.join("|")})$`);

/** the discovered per-cohort and leave-one-out columns of one sumstats row, by API column name. */
export type CohortColumns = Record<string, number | null>;

export const pickCohortColumns = (row: Record<string, unknown>): CohortColumns => {
  const out: CohortColumns = {};
  for (const [key, value] of Object.entries(row)) {
    if (COHORT_COLUMN.test(key) || LEAVE_COLUMN.test(key)) {
      out[key] = typeof value === "number" && !Number.isNaN(value) ? value : null;
    }
  }
  return out;
};

type CohortField = (typeof COHORT_FIELDS)[number];
type LeaveField = (typeof LEAVE_FIELDS)[number];
export type CohortLine = { token: string; label: string } & Record<CohortField, number | null>;
export type LeaveOneOutLine = { family: string; label: string } & Record<LeaveField, number | null>;

// group discovered keys into blocks; a block whose every value is null did not contribute (a
// multi-phenotype response fills a non-contributing cohort's union-header columns with null)
const blocks = <F extends string>(
  cols: CohortColumns,
  pattern: RegExp,
  fields: readonly F[]
): Array<[string, Record<F, number | null>]> => {
  const byToken = new Map<string, Record<F, number | null>>();
  for (const [key, value] of Object.entries(cols)) {
    const m = key.match(pattern);
    if (!m) continue;
    if (!byToken.has(m[1])) {
      byToken.set(m[1], Object.fromEntries(fields.map((f) => [f, null])) as Record<F, number | null>);
    }
    byToken.get(m[1])![m[2] as F] = value;
  }
  return sortCohortTokens([...byToken.keys()])
    .map((t) => [t, byToken.get(t)!] as [string, Record<F, number | null>])
    .filter(([, vals]) => fields.some((f) => vals[f] != null));
};

export const cohortLines = (
  cols: CohortColumns
): { cohorts: CohortLine[]; leaveOneOut: LeaveOneOutLine[] } => ({
  cohorts: blocks(cols, COHORT_COLUMN, COHORT_FIELDS).map(([token, v]) => ({
    token,
    label: cohortLabel(token),
    ...v,
  })),
  leaveOneOut: blocks(cols, LEAVE_COLUMN, LEAVE_FIELDS).map(([family, v]) => ({
    family,
    label: cohortLabel(family),
    ...v,
  })),
});

/**
 * Export column order over a set of rows: the union of discovered columns that are non-null in at
 * least one row, per-cohort blocks first (in cohort order, then field order), leave-one-out after.
 */
export const cohortColumnOrder = (rows: CohortColumns[]): string[] => {
  const present = new Set<string>();
  for (const cols of rows) {
    for (const [key, value] of Object.entries(cols)) if (value != null) present.add(key);
  }
  const rank = (key: string): [number, number, string, number] => {
    const c = key.match(COHORT_COLUMN);
    if (c) return [0, tokenRank(c[1]), c[1], COHORT_FIELDS.indexOf(c[2] as CohortField)];
    const l = key.match(LEAVE_COLUMN)!;
    return [1, tokenRank(l[1]), l[1], LEAVE_FIELDS.indexOf(l[2] as LeaveField)];
  };
  return [...present].sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2]) || ra[3] - rb[3];
  });
};
