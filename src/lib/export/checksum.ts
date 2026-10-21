/** SHA-256 helpers for export integrity. Node-only (node:crypto), no database access. */
import { createHash } from "node:crypto";
import type { CanonicalTransaction } from "./canonical-schema";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Integrity checksum: sha256 of the serialized transactions array. */
export function transactionsChecksum(transactions: CanonicalTransaction[]): string {
  return sha256Hex(JSON.stringify(transactions));
}
