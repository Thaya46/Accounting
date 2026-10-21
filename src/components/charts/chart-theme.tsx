/**
 * Chart palette, scoped to `.vl-viz` so it never leaks into the rest of the UI.
 *
 * Income = green, expense = red, net = indigo (product semantics). The steps
 * were chosen and validated with the dataviz palette validator against the card
 * surfaces (light #ffffff, dark #111827), all-pairs:
 *   light  #166534 / #ec6a6a / #4f46e5 — CVD ΔE 13.6, normal ΔE 31.2, contrast ≥ 3:1
 *   dark   #2fae63 / #c23b3b / #7c83f0 — CVD ΔE 10.4, normal ΔE 28.1, contrast ≥ 3:1
 * The stock --income/--expense tokens (#16a34a/#dc2626) collapse to ΔE 5.0 under
 * deuteranopia, so charts use these re-stepped values instead. Chrome (grid,
 * axis text, surface) reuses the app's semantic tokens.
 */
const CSS = `
.vl-viz{--viz-income:#166534;--viz-expense:#ec6a6a;--viz-net:#4f46e5;--viz-grid:var(--border);--viz-axis:var(--muted-foreground);--viz-surface:var(--card);--viz-cursor:var(--muted)}
.dark .vl-viz{--viz-income:#2fae63;--viz-expense:#c23b3b;--viz-net:#7c83f0}
`;

/** Rendered once per page (React hoists and de-duplicates it by href). */
export function ChartStyles() {
  return (
    <style href="vl-viz-palette" precedence="default">
      {CSS}
    </style>
  );
}

export const VIZ = {
  income: "var(--viz-income)",
  expense: "var(--viz-expense)",
  net: "var(--viz-net)",
  grid: "var(--viz-grid)",
  axis: "var(--viz-axis)",
  surface: "var(--viz-surface)",
  cursor: "var(--viz-cursor)",
} as const;

export const AXIS_TICK = { fill: VIZ.axis, fontSize: 12 } as const;

/** Short, recharts-friendly animation (respecting reduced motion is done per chart). */
export const ANIMATION_MS = 600;

/** Legend key that mirrors the mark: a rounded rect for bars, a short stroke for lines. */
export function LegendKey({ color, kind = "bar", label }: { color: string; kind?: "bar" | "line"; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {kind === "bar" ? (
        <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
      ) : (
        <span aria-hidden className="inline-block h-[2px] w-3.5 rounded-full" style={{ background: color }} />
      )}
      {label}
    </span>
  );
}
