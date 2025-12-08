/**
 * Type definitions for phenotype chat feature
 */

export interface PhenotypeMarkdown {
  phenocode: string;
  content: string;
}

export interface ChatProvider {
  id: string;
  name: string;
  models: string[];
}

export interface ChatStatus {
  available_providers: string[];
  default_provider: string;
  mcp_enabled: boolean;
  available_tools: string[];
}
