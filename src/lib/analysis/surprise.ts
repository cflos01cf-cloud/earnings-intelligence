/**
 * Sorpresas sin porcentajes engañosos.
 * - Sorpresa % solo cuando la base es positiva y suficientemente lejos de cero.
 * - Siempre se da la diferencia absoluta y, para EPS, la sorpresa escalada por precio
 *   (Δ EPS / precio previo, en puntos básicos): comparable entre empresas y estable con EPS negativos o cercanos a cero.
 */

export interface Surprise {
  actual: number | null;
  estimate: number | null;
  diff: number | null;
  /** (real / estimado) − 1, solo si es matemáticamente interpretable. */
  pct: number | null;
  /** Δ / precio × 10 000 (pb). Solo EPS. */
  priceScaledBps: number | null;
  verdict: 'BEAT' | 'MISS' | 'IN_LINE' | 'UNAVAILABLE';
  note: string | null;
}

/** Banda "en línea": ±0.5% para ingresos; para EPS, ±1 centavo o ±1% de |estimado| (lo mayor). */
export function epsSurprise(actual: number | null, estimate: number | null, priceBefore: number | null): Surprise {
  if (actual === null || estimate === null) return { actual, estimate, diff: null, pct: null, priceScaledBps: null, verdict: 'UNAVAILABLE', note: 'Falta EPS real o consenso.' };
  const diff = actual - estimate;
  const band = Math.max(0.01, Math.abs(estimate) * 0.01);
  const verdict = Math.abs(diff) <= band ? 'IN_LINE' : diff > 0 ? 'BEAT' : 'MISS';
  let pct: number | null = null;
  let note: string | null = null;
  if (estimate >= 0.05 && actual > 0) pct = actual / estimate - 1;
  else note = estimate < 0.05 && estimate > -0.05 ? 'Consenso cercano a cero: se usa la diferencia absoluta.' : 'Signos distintos o base negativa: el % no es interpretable; se usa la diferencia absoluta.';
  const priceScaledBps = priceBefore && priceBefore > 0 ? (diff / priceBefore) * 10_000 : null;
  return { actual, estimate, diff, pct, priceScaledBps, verdict, note };
}

export function revenueSurprise(actual: number | null, estimate: number | null): Surprise {
  if (actual === null || estimate === null) return { actual, estimate, diff: null, pct: null, priceScaledBps: null, verdict: 'UNAVAILABLE', note: actual === null ? 'Ingreso real no disponible todavía.' : 'Sin consenso de ingresos verificable.' };
  const diff = actual - estimate;
  if (estimate <= 0) return { actual, estimate, diff, pct: null, priceScaledBps: null, verdict: diff > 0 ? 'BEAT' : diff < 0 ? 'MISS' : 'IN_LINE', note: 'Consenso no positivo: el % no es interpretable.' };
  const pct = actual / estimate - 1;
  return { actual, estimate, diff, pct, priceScaledBps: null, verdict: Math.abs(pct) <= 0.005 ? 'IN_LINE' : pct > 0 ? 'BEAT' : 'MISS', note: null };
}

/** Variación interanual segura (null si la base no es positiva). */
export function yoy(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null || prev <= 0) return null;
  return curr / prev - 1;
}
