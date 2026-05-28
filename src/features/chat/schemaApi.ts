import { useQuery, UseQueryResult } from "@tanstack/react-query";

const chatUrl = import.meta.env.VITE_CHAT_URL;

// resource metadata as defined in genetics-results-db configs/datasets.yaml.
// served verbatim under SchemaResponse.resources keyed by resource id (e.g. "finngen").
export interface ResourceMeta {
  label: string;
  description: string;
  aliases?: string[];
  // collection resources (e.g. eqtl_catalogue) carry extra fields
  collection?: boolean;
  collection_id_prefix?: string;
  collection_data_types?: string[];
  [key: string]: unknown;
}

// per-column metadata. allowed_values is a flat list for simple categorical columns;
// allowed_values_by_<dep> keys (e.g. allowed_values_by_resource) appear for columns
// whose valid values depend on another column's value.
export interface ColumnMeta {
  name: string;
  type: string;
  mode: string;
  description?: string;
  allowed_values?: string[];
  // grouped allowed values keyed by dependency column value; some entries (e.g.
  // _eqtl_catalogue_resources) are collapsed by the API into a summary string
  [key: `allowed_values_by_${string}`]: Record<string, string[] | string> | undefined;
}

// db /schema serializes table examples with `description` + `sql` (see yaml_loader.load_table_examples)
export interface ExampleQuery {
  description: string;
  sql: string;
}

// summary entry the API emits for each collection-resource family (e.g. eQTL Catalogue);
// see _compact_categorical_values in genetics-results-db/api/main.py
export interface CollectionResourceSummary {
  count: number;
  pattern: string;
  description: string;
  data_types: string;
}

export interface TableMeta {
  name: string;
  description: string;
  row_count: number;
  columns: ColumnMeta[];
  examples: ExampleQuery[];
  // present when the table participates in collection resources (e.g. eQTL Catalogue summaries),
  // keyed by the human-readable collection label
  collection_resources?: Record<string, CollectionResourceSummary>;
}

export interface SchemaResponse {
  resources: Record<string, ResourceMeta>;
  tables: TableMeta[];
}

export async function fetchSchema(): Promise<SchemaResponse> {
  const response = await fetch(`${chatUrl}/v1/schema`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as SchemaResponse;
}

// schema rarely changes — cache aggressively so the drawer mounts instantly after first load
const SCHEMA_STALE_TIME_MS = 10 * 60 * 1000;

export function useSchema(): UseQueryResult<SchemaResponse, Error> {
  return useQuery<SchemaResponse, Error>({
    queryKey: ["chat", "schema"],
    queryFn: fetchSchema,
    staleTime: SCHEMA_STALE_TIME_MS,
  });
}
