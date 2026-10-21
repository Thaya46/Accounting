/** Adapter registry. Pure — safe to import from client components for metadata. */
import { ADAPTER_CATALOG, type AdapterKey } from "./adapter-keys";
import type { AdapterSpecDTO, ExportAdapter } from "./types";
import { canonicalJsonAdapter } from "./adapters/canonical-json";
import { genericCsvAdapter } from "./adapters/generic-csv";
import { tallyPrimeAdapter } from "./adapters/tallyprime";
import { zohoBooksAdapter } from "./adapters/zoho-books";
import { quickBooksOnlineAdapter } from "./adapters/quickbooks-online";
import { xeroAdapter } from "./adapters/xero";
import { busyAdapter } from "./adapters/busy";
import { sapAdapter } from "./adapters/sap";
import { dynamics365Adapter } from "./adapters/dynamics-365";
import { customAdapter } from "./adapters/custom";

const ADAPTERS: Record<AdapterKey, ExportAdapter> = {
  "canonical-json": canonicalJsonAdapter,
  "generic-csv": genericCsvAdapter,
  tallyprime: tallyPrimeAdapter,
  "zoho-books": zohoBooksAdapter,
  "quickbooks-online": quickBooksOnlineAdapter,
  xero: xeroAdapter,
  busy: busyAdapter,
  sap: sapAdapter,
  "dynamics-365": dynamics365Adapter,
  custom: customAdapter,
};

export const ADAPTER_KEYS = ADAPTER_CATALOG.map((a) => a.key) as [AdapterKey, ...AdapterKey[]];

export function isAdapterKey(key: string): key is AdapterKey {
  return key in ADAPTERS;
}

export function getAdapter(key: string): ExportAdapter | null {
  return isAdapterKey(key) ? ADAPTERS[key] : null;
}

/** Adapters in catalog order. */
export function listAdapters(): ExportAdapter[] {
  return ADAPTER_CATALOG.map((a) => ADAPTERS[a.key]);
}

/** Serializable description (no functions) for client components. */
export function adapterSpec(a: ExportAdapter): AdapterSpecDTO {
  const { validate: _v, generate: _g, ...spec } = a;
  return JSON.parse(JSON.stringify(spec)) as AdapterSpecDTO;
}
