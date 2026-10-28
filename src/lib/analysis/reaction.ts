/**
 * Alineación de un reporte con las velas diarias y reacción del precio.
 *
 * Día 0 = primera sesión en la que el mercado ya conoce el reporte:
 *   pre-market / during-market → la sesión del día del anuncio
 *   post-market                → la sesión siguiente
 *   unknown                    → la sesión siguiente, con base el cierre ANTERIOR al día del anuncio
 *                                (ventana de dos sesiones; se marca).
 * Base = cierre de la sesión previa al día 0 (o anterior al anuncio si la hora es desconocida).
 *
 * Etiquetas (h = 1, 5, 20 sesiones):
 *   PRE  : cierre(día0+h−1) / cierre(base) − 1   — posición tomada ANTES del anuncio; h=1 es la reacción inicial.
 *   POST : cierre(día0+h)   / cierre(día0) − 1   — posición tomada al cierre del día 0, ya conocida la reacción
 *                                                  inicial (deriva posterior al reporte). Así lo puede ejecutar un
 *                                                  proceso diario después del cierre, sin depender de la apertura.
 */
import type { Bar, Horizon, Mode, ReportTime } from '../types';
import { std } from '../util/stats';

export interface Alignment {
  base: number; // índice de la vela base
  day0: number; // índice del día 0
  twoSessionWindow: boolean;
}

/** Primer índice con time ≥ fecha (búsqueda binaria). */
export function lowerBound(bars: Bar[], date: string): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time < date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function align(bars: Bar[], reportDate: string, time: ReportTime): Alignment | null {
  const i = lowerBound(bars, reportDate); // primera sesión ≥ día del anuncio
  if (time === 'pre-market' || time === 'during-market') {
    if (i >= bars.length || i < 1) return null;
    return { base: i - 1, day0: i, twoSessionWindow: false };
  }
  // post-market o desconocido: el día 0 es la primera sesión estrictamente posterior al anuncio.
  const j = i < bars.length && bars[i].time === reportDate ? i + 1 : i;
  if (j >= bars.length) return null;
  if (time === 'post-market') {
    if (j < 1) return null;
    return { base: j - 1, day0: j, twoSessionWindow: false };
  }
  if (i < 1) return null;
  return { base: i - 1, day0: j, twoSessionWindow: j - (i - 1) > 1 };
}

/** Índice de la vela inicial (entrada) y final (salida) de la etiqueta. */
export function labelSpan(a: Alignment, h: Horizon, mode: Mode): { from: number; to: number } {
  return mode === 'PRE' ? { from: a.base, to: a.day0 + h - 1 } : { from: a.day0, to: a.day0 + h };
}

export function labelReturn(bars: Bar[], a: Alignment, h: Horizon, mode: Mode): number | null {
  const { from, to } = labelSpan(a, h, mode);
  if (to >= bars.length) return null;
  const start = bars[from].close;
  if (!(start > 0)) return null;
  return bars[to].close / start - 1;
}

/** Rendimiento del benchmark en las MISMAS fechas (por fecha, no por índice). */
export function benchmarkReturn(bench: Bar[], bars: Bar[], a: Alignment, h: Horizon, mode: Mode): number | null {
  const { from, to } = labelSpan(a, h, mode);
  if (to >= bars.length) return null;
  const startDate = bars[from].time;
  const endDate = bars[to].time;
  const si = lowerBound(bench, startDate);
  const ei = lowerBound(bench, endDate);
  if (si >= bench.length || ei >= bench.length || bench[si].time !== startDate || bench[ei].time !== endDate) return null;
  return bench[si].close > 0 ? bench[ei].close / bench[si].close - 1 : null;
}

/** Volatilidad diaria (desv. est. de rendimientos cierre a cierre) en las `n` sesiones que terminan en `end` (inclusive). */
export function dailyVol(bars: Bar[], end: number, n = 60): number | null {
  const start = Math.max(1, end - n + 1);
  const rets: number[] = [];
  for (let i = start; i <= end; i++) if (bars[i - 1].close > 0) rets.push(bars[i].close / bars[i - 1].close - 1);
  if (rets.length < Math.min(40, n * 0.66)) return null;
  const s = std(rets);
  return Number.isFinite(s) ? s : null;
}

export function trailingReturn(bars: Bar[], end: number, n: number): number | null {
  if (end - n < 0) return null;
  const a = bars[end - n].close;
  return a > 0 ? bars[end].close / a - 1 : null;
}

export function abnormalVolume(bars: Bar[], day0: number, n = 20): number | null {
  const v0 = bars[day0]?.volume;
  if (v0 == null || day0 < n) return null;
  const xs = bars.slice(day0 - n, day0).map((b) => b.volume).filter((v): v is number => v != null && v > 0);
  if (xs.length < n * 0.8) return null;
  const avg = xs.reduce((s, x) => s + x, 0) / xs.length;
  return avg > 0 ? v0 / avg : null;
}

/** Saltos de precio de un día con magnitud típica de split (≈ −50%, −66%, +100%…): posible serie mal ajustada. */
export function suspiciousSplits(bars: Bar[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < bars.length; i++) {
    const r = bars[i].close / bars[i - 1].close;
    if (r < 0.45 || r > 1.9) out.push(`${bars[i].time}: cambio de ${((r - 1) * 100).toFixed(0)}% en una sesión`);
  }
  return out;
}

/**
 * Banda de movimiento "lateral", definida ANTES de ver el resultado:
 *   max(costo ida y vuelta, 0.5 × σ_diaria × √h)
 * σ se mide en las 60 sesiones que terminan en la base (no incluye la reacción).
 */
export function flatBand(sigma: number | null, h: Horizon, roundTripCost: number): number | null {
  if (sigma === null) return null;
  return Math.max(roundTripCost, 0.5 * sigma * Math.sqrt(h));
}

export function classify(r: number, band: number): 'UP' | 'DOWN' | 'FLAT' {
  if (r > band) return 'UP';
  if (r < -band) return 'DOWN';
  return 'FLAT';
}
