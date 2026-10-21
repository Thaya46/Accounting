/** Low-level serializers shared by adapters. Pure. */

/** RFC 4180 field: quoted when it contains the delimiter, a quote, CR or LF; quotes are doubled. */
export function csvField(value: string | number | null | undefined, delimiter = ","): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (s.includes(delimiter) || s.includes('"') || s.includes("\n") || s.includes("\r") || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** RFC 4180 document: CRLF record separators, header first, trailing CRLF. */
export function toCsv(header: string[] | null, rows: (string | number | null | undefined)[][], delimiter = ","): string {
  const lines: string[] = [];
  if (header) lines.push(header.map((h) => csvField(h, delimiter)).join(delimiter));
  for (const r of rows) lines.push(r.map((c) => csvField(c, delimiter)).join(delimiter));
  return lines.join("\r\n") + "\r\n";
}

/**
 * Neutralises spreadsheet formula injection in free-text cells (OWASP CSV
 * injection): text starting with = + @ or a control character gets a leading
 * apostrophe. Numeric and code columns are never passed through this.
 */
export function csvSafeText(value: string | null | undefined): string {
  const s = value ?? "";
  return /^[=+@\t\r]/.test(s) ? `'${s}` : s;
}

/** Escapes text for XML element content and attribute values; strips characters XML 1.0 forbids. */
export function xmlEscape(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s
    .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Formats YYYY-MM-DD into another calendar layout. */
export function formatDay(iso: string, layout: "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYYMMDD"): string {
  const [y, m, d] = iso.split("-");
  switch (layout) {
    case "DD/MM/YYYY":
      return `${d}/${m}/${y}`;
    case "MM/DD/YYYY":
      return `${m}/${d}/${y}`;
    case "YYYYMMDD":
      return `${y}${m}${d}`;
    default:
      return iso;
  }
}

/** Collapses whitespace and trims to `max` characters (adds an ellipsis when cut). */
export function clip(value: string | null | undefined, max: number): string {
  const s = (value ?? "").replace(/\s+/g, " ").trim();
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** "2026-10-15T05:00:00.000Z" → "2026-10-15 05:00 UTC" */
export function shortTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

/** Replaces typographic punctuation with ASCII equivalents (for targets with uncertain Unicode handling). */
export function asciiPunctuation(value: string): string {
  return value
    .replace(/[·•]/g, "-")
    .replace(/…/g, "...")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-");
}
