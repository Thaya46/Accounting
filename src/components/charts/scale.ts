/**
 * "Nice" axis ticks: round steps (1/2/2.5/5 × 10ⁿ) that always include zero,
 * so money axes read 0 / 1L / 2L / 3L instead of 0 / 85K / 1.7L.
 */
export function niceTicks(values: number[], count = 5): number[] {
  const finite = values.filter((v) => Number.isFinite(v));
  const lo = Math.min(0, ...finite);
  const hi = Math.max(0, ...finite);
  if (lo === hi) return [0, 1];
  const rawStep = (hi - lo) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}
