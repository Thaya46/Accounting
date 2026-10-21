/**
 * Print styles, rendered only on report / ledger pages (so they are scoped to
 * them): hide the app shell chrome, drop page padding, and force the light
 * palette inside `.vl-report` so dark-mode users still print dark-on-white.
 */
const CSS = `
@media print {
  @page { margin: 12mm; }
  html, body { background: #fff !important; }
  body aside, body header { display: none !important; }
  body main { max-width: none !important; margin: 0 !important; padding: 0 !important; }
  .vl-report {
    --background: #ffffff; --foreground: #0f172a; --card: #ffffff; --card-foreground: #0f172a;
    --muted: #f1f5f9; --muted-foreground: #475569; --border: #cbd5e1; --primary: #3730a3;
    --income: #15803d; --income-soft: #dcfce7; --expense: #b91c1c; --expense-soft: #fee2e2;
    --warning: #92400e; --warning-soft: #fef3c7; --info: #1d4ed8; --info-soft: #dbeafe;
    --accent: #eef2ff; --accent-foreground: #3730a3; --secondary: #eef0f6; --secondary-foreground: #1e293b;
    color: #0f172a;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .vl-report .overflow-x-auto, .vl-report .overflow-auto { overflow: visible !important; max-height: none !important; }
  .vl-report table { font-size: 10.5pt; }
  .vl-report tr, .vl-report .print-avoid-break { break-inside: avoid; }
  .vl-report a { color: inherit !important; text-decoration: none !important; }
}
`;

/** Rendered in place (not hoisted), so it disappears when the page unmounts. */
export function PrintStyles() {
  return <style>{CSS}</style>;
}
