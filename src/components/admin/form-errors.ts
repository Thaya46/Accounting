"use client";

import type { ZodError } from "zod";
import { ClientApiError } from "@/lib/client/api";

export type FieldErrors = Record<string, string | undefined>;

/** First message per field from a Zod error. */
export function zodFieldErrors(err: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "_form");
    out[key] ??= issue.message;
  }
  return out;
}

/** Maps a server error (Zod `flatten()` details or `{ field }` hints) onto form fields. */
export function apiFieldErrors(err: unknown): FieldErrors {
  if (!(err instanceof ClientApiError) || !err.details || typeof err.details !== "object") return {};
  const details = err.details as { fieldErrors?: Record<string, string[] | undefined>; field?: string };
  const out: FieldErrors = {};
  if (details.fieldErrors) {
    for (const [k, v] of Object.entries(details.fieldErrors)) if (v?.[0]) out[k] = v[0];
  }
  if (typeof details.field === "string") out[details.field] = err.message;
  return out;
}

export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again.") {
  return err instanceof Error && err.message ? err.message : fallback;
}
