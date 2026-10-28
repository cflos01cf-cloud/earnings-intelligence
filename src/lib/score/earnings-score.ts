/**
 * Earnings Score 0–100 con componentes visibles.
 *
 * - Cada componente = percentil de la variable frente a TODOS los reportes previos (no de la misma empresa),
 *   orientado según el signo de su correlación histórica con el rendimiento POST a 5 sesiones.
 * - Pesos = |correlación| normalizada, estimada SOLO con eventos terminados antes del corte.
 * - Si hay menos de MIN_TRAIN_EVENTS eventos, los pesos son iguales y el score se marca "no calibrado".
 * - Componentes sin dato se excluyen y los pesos se renormalizan (se listan como faltantes).
 * - Guidance: no hay fuente gratuita estructurada; queda como faltante explícito, nunca inventado.
 * La validación fuera de muestra del score vive en `scoreWalkForward`.
 */
import type { EarningsScore, ScoreComponent } from '../types';
import type { EventRow, FeatureVector } from '../model/dataset';
import { MIN_TRAIN_EVENTS } from '../config';
import { mean, percentileRank } from '../util/stats';

interface ComponentDef {
  key: string;
  label: string;
  /** Variables (con signo a priori) que forman el componente. */
  parts: { feature: string; prior: 1 | -1 }[];
  postOnly?: boolean;
  unavailableReason?: string;
}

export const COMPONENTS: ComponentDef[] = [
  { key: 'revenue', label: 'Sorpresa de ingresos', parts: [{ feature: 'rev_surprise_pct', prior: 1 }], postOnly: true },
  { key: 'eps', label: 'Sorpresa de EPS', parts: [{ feature: 'eps_surprise_bps', prior: 1 }], postOnly: true },
  { key: 'guidance', label: 'Guidance', parts: [], unavailableReason: 'Sin fuente gratuita estructurada de guidance; requiere leer el comunicado (fase posterior).' },
  { key: 'margins', label: 'Márgenes y rentabilidad', parts: [{ feature: 'fund_opm_chg', prior: 1 }] },
  { key: 'cash', label: 'Flujo de caja y calidad de utilidades', parts: [{ feature: 'fund_fcf_margin', prior: 1 }, { feature: 'fund_accrual', prior: -1 }] },
  { key: 'history', label: 'Reacción histórica', parts: [{ feature: 'hist_mean_react', prior: 1 }] },
  { key: 'pricedIn', label: 'Expectativas ya incorporadas en el precio', parts: [{ feature: 'runup20_rel', prior: -1 }, { feature: 'mom60_rel', prior: -1 }] },
  { key: 'context', label: 'Sentimiento y contexto de mercado', parts: [{ feature: 'spy20', prior: 1 }, { feature: 'sector20_rel', prior: 1 }] },
];

export interface ScoreModel {
  calibrated: boolean;
  nTrain: number;
  /** Distribución de cada variable en el entrenamiento (para percentiles). */
  dist: Record<string, number[]>;
  /** Signo empírico por variable. */
  sign: Record<string, 1 | -1>;
  weights: Record<string, number>;
  corr: Record<string, number>;
}

function pearson(xs: number[], ys: number[]): number {
  if (xs.length < 3) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

export function fitScore(rows: EventRow[], cutoff: string): ScoreModel {
  const tr = rows.filter((r) => r.labels.POST[5] && r.labels.POST[5]!.endDate < cutoff);
  const dist: Record<string, number[]> = {};
  const sign: Record<string, 1 | -1> = {};
  const corr: Record<string, number> = {};
  for (const c of COMPONENTS) {
    for (const p of c.parts) {
      const pairs = tr.map((r) => [r.features.POST[p.feature], r.labels.POST[5]!.abnormal ?? r.labels.POST[5]!.ret] as const).filter((x): x is readonly [number, number] => typeof x[0] === 'number');
      dist[p.feature] = pairs.map((x) => x[0]).sort((a, b) => a - b);
      const rho = pearson(pairs.map((x) => x[0]), pairs.map((x) => x[1]));
      corr[p.feature] = rho;
      // Signo empírico solo si la evidencia no es trivial; si no, el a priori.
      sign[p.feature] = Math.abs(rho) >= 0.02 && pairs.length >= MIN_TRAIN_EVENTS ? (rho > 0 ? 1 : -1) : p.prior;
    }
  }
  const calibrated = tr.length >= MIN_TRAIN_EVENTS;
  const raw: Record<string, number> = {};
  for (const c of COMPONENTS) raw[c.key] = c.parts.length ? (calibrated ? mean(c.parts.map((p) => Math.abs(corr[p.feature] ?? 0))) + 1e-3 : 1) : 0;
  const tot = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
  const weights = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / tot]));
  return { calibrated, nTrain: tr.length, dist, sign, weights, corr };
}

export function scoreOf(m: ScoreModel, f: FeatureVector, mode: 'PRE' | 'POST'): EarningsScore {
  const comps: ScoreComponent[] = [];
  const missing: string[] = [];
  for (const c of COMPONENTS) {
    if (!c.parts.length) {
      comps.push({ key: c.key, label: c.label, score: null, weight: 0, detail: c.unavailableReason ?? 'Sin dato' });
      missing.push(c.label);
      continue;
    }
    if (c.postOnly && mode === 'PRE') {
      comps.push({ key: c.key, label: c.label, score: null, weight: 0, detail: 'Se conoce al publicarse el reporte.' });
      continue;
    }
    const subs: number[] = [];
    for (const p of c.parts) {
      const x = f[p.feature];
      const d = m.dist[p.feature] ?? [];
      if (typeof x !== 'number' || d.length < 10) continue;
      const pr = percentileRank(d, x);
      subs.push(m.sign[p.feature] === 1 ? pr : 100 - pr);
    }
    if (!subs.length) {
      comps.push({ key: c.key, label: c.label, score: null, weight: 0, detail: 'Dato no disponible para este reporte.' });
      missing.push(c.label);
      continue;
    }
    comps.push({ key: c.key, label: c.label, score: mean(subs), weight: m.weights[c.key], detail: c.parts.map((p) => `${p.feature}: correlación histórica ${(m.corr[p.feature] ?? 0).toFixed(3)}`).join(' · ') });
  }
  const live = comps.filter((c) => c.score !== null);
  const wsum = live.reduce((s, c) => s + c.weight, 0);
  for (const c of comps) c.weight = c.score !== null && wsum > 0 ? c.weight / wsum : 0;
  const total = live.length && wsum > 0 ? live.reduce((s, c) => s + (c.score as number) * c.weight, 0) : null;
  return {
    total,
    components: comps,
    calibrated: m.calibrated,
    method: m.calibrated
      ? `Percentiles frente a ${m.nTrain} reportes previos; pesos = |correlación| con el rendimiento anormal POST a 5 sesiones, estimados solo con eventos terminados.`
      : `Pesos iguales: solo ${m.nTrain} reportes con resultado (mínimo ${MIN_TRAIN_EVENTS}). NO calibrado.`,
    missing,
  };
}

/** Validación fuera de muestra: correlación de rango del score con el rendimiento POST a 5 sesiones y diferencia entre tercios. */
export function scoreWalkForward(rows: EventRow[], folds: { start: string; end: string }[]): { n: number; spearman: number | null; topMinusBottom: number | null } {
  const pts: { s: number; r: number }[] = [];
  for (const f of folds) {
    const m = fitScore(rows, f.start);
    if (!m.calibrated) continue;
    for (const r of rows) {
      if (r.day0Date < f.start || r.day0Date >= f.end || !r.labels.POST[5]) continue;
      const s = scoreOf(m, r.features.POST, 'POST').total;
      if (s !== null) pts.push({ s, r: r.labels.POST[5]!.abnormal ?? r.labels.POST[5]!.ret });
    }
  }
  if (pts.length < 30) return { n: pts.length, spearman: null, topMinusBottom: null };
  const rank = (xs: number[]) => {
    const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array(xs.length);
    idx.forEach(([, i], k) => (r[i] = k));
    return r as number[];
  };
  const rs = rank(pts.map((p) => p.s));
  const rr = rank(pts.map((p) => p.r));
  const sorted = [...pts].sort((a, b) => a.s - b.s);
  const t = Math.floor(sorted.length / 3);
  return { n: pts.length, spearman: pearson(rs, rr), topMinusBottom: mean(sorted.slice(-t).map((p) => p.r)) - mean(sorted.slice(0, t).map((p) => p.r)) };
}
