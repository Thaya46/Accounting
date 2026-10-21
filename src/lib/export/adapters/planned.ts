import type { AdapterSpec, ExportAdapter } from "../types";

type PlannedSpec = Omit<
  AdapterSpec,
  "implemented" | "category" | "configFields" | "requiresAccountMapping" | "supportedExportTypes" | "allowsDrafts" | "defaultExcludeExported" | "apiTransfer" | "provenance" | "fileExtension" | "contentType"
> & { provenanceNote: string };

/**
 * Architecture-only adapter: documents the target's import mechanism and field
 * requirements, reports "Not Implemented" and refuses to generate files, so no
 * unverified output is ever offered for download.
 */
export function plannedAdapter(s: PlannedSpec): ExportAdapter {
  const { provenanceNote, ...rest } = s;
  return {
    ...rest,
    category: "planned",
    implemented: false,
    fileExtension: "",
    contentType: "",
    provenance: { createdByTransfer: "none", description: provenanceNote, fullAuditTransfer: false },
    configFields: [],
    requiresAccountMapping: true,
    supportedExportTypes: [],
    allowsDrafts: false,
    defaultExcludeExported: true,
    apiTransfer: { status: "not_implemented", note: "Not implemented." },
    validate() {
      return [{ level: "error", code: "NOT_IMPLEMENTED", message: `${s.name} export is not implemented yet. Use the canonical JSON or generic CSV export, or a configured custom layout.` }];
    },
    generate() {
      throw new Error(`${s.name} export is not implemented`);
    },
  };
}
