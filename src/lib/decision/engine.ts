/**
 * Motor de decisión. Convierte una predicción en ALCISTA / BAJISTA / NEUTRAL / ESPERAR / NO_OPERAR.
 * Nunca decide solo porque el reporte superó o incumplió el consenso: decide por probabilidades
 * validadas fuera de muestra, riesgo y costos.
 *
 * En GBM no hay venta en corto de acciones de EE.UU.: BAJISTA significa "evitar compras / reducir posición".
 */
import type { Company, Horizon, Mode, Prediction, ReportTime, TradeSignal, Verdict } from '../types';

export interface DecisionInput {
  company: Company;
  prediction: Prediction;
  reportTime: ReportTime;
  basePrice: number | null;
  baseTime: string | null;
  sigma: number | null;
  avgDollarVolume20: number | null;
  typicalMove: number | null; // |reacción| media histórica a 1 sesión
  roundTrip: number;
  oosSkill: number | null;
  held?: boolean;
}

export const MIN_DOLLAR_VOLUME = 5_000_000;
export const MIN_EDGE = 0.1;
export const MIN_RR = 1.5;

export function decide(i: DecisionInput): TradeSignal {
  const p = i.prediction;
  const h = p.horizon as Horizon;
  const mode = p.mode as Mode;
  const reasons: string[] = [];
  const catalysts: string[] = [];
  const risks: string[] = [];
  const cancelIf: string[] = [...p.invalidation];
  let verdict: Verdict = 'NEUTRAL';
  let entry: number | null = null;
  let stop: number | null = null;
  let target: number | null = null;
  let rr: number | null = null;

  for (const f of p.factors.slice(0, 6)) (f.contribution > 0 ? catalysts : risks).push(f.label);

  const finish = (): TradeSignal => ({
    symbol: i.company.symbol,
    name: i.company.name,
    verdict,
    mode,
    horizon: h,
    reportDate: p.reportDate,
    reportTime: i.reportTime,
    referencePrice: i.basePrice,
    referenceTime: i.baseTime,
    probs: p.probs,
    catalysts,
    risks,
    entry,
    invalidation: stop,
    stop,
    target,
    rewardRisk: rr,
    costsPct: i.roundTrip,
    cancelIf,
    quality: quality(i, rr),
    reasons,
  });

  if (!p.probs || p.confidence === 'EVIDENCIA_INSUFICIENTE') {
    verdict = 'ESPERAR';
    reasons.push(p.insufficientReason ?? 'Evidencia insuficiente.');
    return finish();
  }
  if (i.avgDollarVolume20 !== null && i.avgDollarVolume20 < MIN_DOLLAR_VOLUME) {
    verdict = 'NO_OPERAR';
    reasons.push(`Liquidez baja: volumen medio de ${(i.avgDollarVolume20 / 1e6).toFixed(1)} M USD diarios.`);
    return finish();
  }
  const edge = p.probs.up - p.probs.down;
  if (mode === 'PRE') {
    risks.push('Riesgo binario: la posición atraviesa el anuncio.');
    if (p.confidence !== 'ALTA') {
      verdict = 'NO_OPERAR';
      reasons.push(`Operar antes del reporte no está justificado: confianza ${p.confidence.toLowerCase()}${i.typicalMove !== null ? ` frente a un movimiento típico de ±${(i.typicalMove * 100).toFixed(1)}% en la reacción` : ''}.`);
      return finish();
    }
  }
  if (p.confidence === 'BAJA') {
    verdict = 'NEUTRAL';
    reasons.push(i.oosSkill !== null && i.oosSkill <= 0 ? 'El modelo no superó al baseline fuera de muestra en este horizonte: no hay ventaja demostrada.' : 'Ventaja pequeña o señales contradictorias.');
    return finish();
  }
  const er = p.expectedReturn ?? 0;
  const bull = edge >= MIN_EDGE && er > i.roundTrip;
  const bear = edge <= -MIN_EDGE && er < -i.roundTrip;
  if (!bull && !bear) {
    verdict = 'NEUTRAL';
    reasons.push(`Diferencia entre subida y bajada de ${(edge * 100).toFixed(0)} pp y rendimiento esperado ${(er * 100).toFixed(2)}% frente a costos de ${(i.roundTrip * 100).toFixed(2)}%.`);
    return finish();
  }
  if (bear) {
    verdict = 'BAJISTA';
    reasons.push(i.held ? 'Tienes posición: considera reducir o subir el stop.' : 'Evitar compras. En GBM no hay cortos en acciones de EE.UU.');
    return finish();
  }
  if (!i.basePrice || !i.sigma || !p.interval) {
    verdict = 'ESPERAR';
    reasons.push('Falta precio, volatilidad o intervalo para fijar stop y objetivo.');
    return finish();
  }
  entry = i.basePrice;
  stop = entry * (1 - 1.5 * i.sigma * Math.sqrt(h));
  target = entry * (1 + Math.max(p.interval[1], er));
  rr = (target - entry) / (entry - stop);
  if (rr < MIN_RR) {
    verdict = 'ESPERAR';
    reasons.push(`Relación beneficio/riesgo de ${rr.toFixed(2)} (mínimo ${MIN_RR}).`);
    return finish();
  }
  verdict = 'ALCISTA';
  reasons.push(`P(subida) ${(p.probs.up * 100).toFixed(0)}% vs. P(bajada) ${(p.probs.down * 100).toFixed(0)}%, rendimiento esperado bruto ${(er * 100).toFixed(2)}%; costos ida y vuelta ${(i.roundTrip * 100).toFixed(2)}%.`);
  cancelIf.push(`Precio de entrada mayor a ${(entry * (1 + 0.5 * i.sigma)).toFixed(2)} (persecución).`);
  return finish();
}

/** Calidad estadística para ordenar el scanner: habilidad fuera de muestra × ventaja × beneficio/riesgo. */
export function quality(i: DecisionInput, rr: number | null): number {
  const p = i.prediction;
  if (!p.probs) return 0;
  const skill = Math.max(0, Math.min(1, (i.oosSkill ?? 0) / 0.05));
  const edge = Math.abs(p.probs.up - p.probs.down);
  const rrf = rr === null ? 0.5 : Math.max(0, Math.min(1, rr / 3));
  return Math.round(100 * skill * edge * rrf * 100) / 100;
}

export function avgDollarVolume(bars: { close: number; volume: number | null }[], n = 20): number | null {
  const xs = bars.slice(-n).filter((b) => b.volume != null).map((b) => b.close * (b.volume as number));
  return xs.length >= n * 0.8 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
