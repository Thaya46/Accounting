/** Adapter contracts for the accounting export system. Pure types — safe on client and server. */
import type { AdapterKey } from "./adapter-keys";
import type { CanonicalExport, ExportType } from "./canonical-schema";

export type IssueLevel = "error" | "warning";

export type ValidationIssue = {
  level: IssueLevel;
  /** Stable machine code, e.g. UNBALANCED_ENTRY, MISSING_MAPPING. */
  code: string;
  message: string;
  transactionId?: string;
  accountCode?: string;
};

export type AccountMapping = { externalCode: string; externalName?: string | null };

/** One column of the configurable "custom" CSV layout. */
export type CustomColumn = { field: string; header: string };

export type AdapterConfigValue = string | boolean | CustomColumn[];
export type AdapterConfig = Record<string, AdapterConfigValue>;

export type ConfigField = {
  key: string;
  label: string;
  type: "text" | "select" | "boolean" | "columns";
  required?: boolean;
  default?: string | boolean;
  options?: { value: string; label: string }[];
  help?: string;
  maxLength?: number;
  placeholder?: string;
};

export type ProvenanceMode = "native" | "narration" | "memo" | "custom-field" | "none";

export type AdapterSpec = {
  key: AdapterKey;
  name: string;
  vendor: string;
  product: string;
  supportedVersions: string[];
  /** native = documented third-party format, generic = open VLedger format, planned = architecture only. */
  category: "native" | "generic" | "planned";
  importMechanism: string;
  fileType: string;
  fileExtension: string;
  contentType: string;
  implemented: boolean;
  /** Honest statement of how the output was grounded and what the user must check. */
  verificationNote: string;
  specReferences: { label: string; url: string }[];
  requiredFields: string[];
  accountMappingRules: string;
  taxMappingRules: string;
  currencyMapping: string;
  contactMapping: string;
  referenceRules: string;
  limitations: string[];
  provenance: { createdByTransfer: ProvenanceMode; description: string; fullAuditTransfer: boolean };
  configFields: ConfigField[];
  requiresAccountMapping: boolean;
  /** How the external account identifier is labelled and validated in mapping editors. */
  mapping?: { codeLabel: string; codeHint: string; nameLabel?: string; codePattern?: string; codePatternMessage?: string; codeMaxLength?: number };
  supportedExportTypes: ExportType[];
  /** Only the canonical JSON may carry unposted drafts (with proposed lines). */
  allowsDrafts: boolean;
  /** Default for "exclude transactions already exported to this target". */
  defaultExcludeExported: boolean;
  apiTransfer: { status: "not_applicable" | "not_implemented"; note: string };
};

export type AdapterInput = {
  canonical: CanonicalExport;
  /** accountCode → external identifier. */
  mappings: Record<string, AccountMapping>;
  /** Workspace configuration with defaults applied. */
  config: AdapterConfig;
  /** File name without extension, e.g. "ABC_2026-04-01_2027-03-31_tallyprime". */
  fileBaseName: string;
};

export type GeneratedFile = { fileName: string; contentType: string; content: string };
export type AdapterOutput = { files: GeneratedFile[]; warnings: string[] };

export interface ExportAdapter extends AdapterSpec {
  validate(input: AdapterInput): ValidationIssue[];
  generate(input: AdapterInput): AdapterOutput;
}

/** Plain-JSON adapter description sent to client components. */
export type AdapterSpecDTO = AdapterSpec;
