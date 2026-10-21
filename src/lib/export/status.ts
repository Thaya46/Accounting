/** Integration status rules (requirement §9 states). Pure. */

export type AdapterStatusCode = "available" | "configuration_required" | "validation_failed" | "not_implemented" | "disabled";

export const ADAPTER_STATUS_LABEL: Record<AdapterStatusCode, string> = {
  available: "Available",
  configuration_required: "Configuration Required",
  validation_failed: "Validation Failed",
  not_implemented: "Not Implemented",
  disabled: "Disabled by Super Admin",
};

export type AdapterStatus = { status: AdapterStatusCode; label: string; reasons: string[] };

/**
 * Precedence: disabled by the platform → not implemented → configuration
 * required (missing settings or account mappings for accounts in use) →
 * validation failed (errors on the selected data) → available.
 */
export function computeAdapterStatus(i: {
  platformEnabled: boolean;
  implemented: boolean;
  missingConfig: string[];
  unmappedAccounts: string[];
  /** Invalid settings or mapping values (messages). */
  invalidConfig?: string[];
  validationErrors?: number;
}): AdapterStatus {
  const make = (status: AdapterStatusCode, reasons: string[] = []): AdapterStatus => ({ status, label: ADAPTER_STATUS_LABEL[status], reasons });
  if (!i.platformEnabled) return make("disabled", ["A Super Admin has disabled this integration for the platform."]);
  if (!i.implemented) return make("not_implemented", ["This adapter documents the integration architecture only; no file is generated."]);
  const invalid = i.invalidConfig ?? [];
  if (i.missingConfig.length || i.unmappedAccounts.length || invalid.length) {
    const reasons: string[] = [];
    if (i.missingConfig.length) reasons.push(`Missing settings: ${i.missingConfig.join(", ")}.`);
    reasons.push(...invalid.slice(0, 3));
    if (i.unmappedAccounts.length) {
      const shown = i.unmappedAccounts.slice(0, 6).join(", ");
      reasons.push(`Unmapped accounts: ${shown}${i.unmappedAccounts.length > 6 ? ` and ${i.unmappedAccounts.length - 6} more` : ""}.`);
    }
    return make("configuration_required", reasons);
  }
  if ((i.validationErrors ?? 0) > 0) return make("validation_failed", [`${i.validationErrors} validation error(s) on the selected data.`]);
  return make("available");
}

/** Badge variant for a status (UI helper). */
export function statusVariant(s: AdapterStatusCode): "success" | "warning" | "danger" | "muted" | "secondary" {
  switch (s) {
    case "available":
      return "success";
    case "configuration_required":
      return "warning";
    case "validation_failed":
      return "danger";
    case "disabled":
      return "secondary";
    default:
      return "muted";
  }
}
