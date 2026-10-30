/**
 * Motor de predicción: entrena, por modo (PRE/POST) y horizonte (1/5/20), un baseline de frecuencias
 * y una regresión logística multinomial, y produce `Prediction` con probabilidades que suman 100%,
 * rendimiento esperado, intervalo plausible, factores y confianza.
 *
 * La confianza NO sale de la probabilidad sola: depende de si el modelo superó al baseline
 * FUERA DE MUESTRA (walk-forward). Si no lo superó, se dice.
 */
import type { FactorContribution, Horizon, Mode, ModelName, Outcome, Prediction, Probabilities } from '../types';
import { MIN_TRAIN_EVENTS, MODEL_VERSION, L2 } from '../config';
import { FEATURE_LABELS, POST_FEATURES, PRE_FEATURES, type EventRow, type FeatureVector } from './dataset';
import { contributions, fitBaseline, fitLogistic, logLoss, predictLogistic, type BaselineModel, type LogisticModel } from './logistic';
import { mean, quantile } from '../util/stats';

export const decisionDate = (r: EventRow, mode: Mode) => (mode === 'PRE' ? r.baseDate : r.day0Date);

export interface TrainedSet {
  mode: Mode;
  horizon: Horizon;
  baseline: BaselineModel;
  logistic: LogisticModel | null;
  /** Rendimientos normalizados z = r / (σ·√h) por clase, para esperado e intervalo. */
  zByClass: Record<Outcome, number[]>;
  nTrain: number;
  trainedThrough: string;
  /** Habilidad fuera de muestra (1 − logloss_modelo / logloss_baseline), si ya se corrió el walk-forward. */
  oosSkill: number | null;
  oosN: number;
}

export function trainingRows(rows: EventRow[], mode: Mode, h: Horizon, cutoff: string): EventRow[] {
  return rows.filter((r) => {
    const l = r.labels[mode][h];
    return l && l.endDate < cutoff && r.sigma;
  });
}

/**
 * Caché de modelos por (filas, modo, horizonte, corte). El corte se redondea hacia ATRÁS al inicio de su
 * semestre (1-ene o 1-jul): el modelo nunca ve más datos que los disponibles en la fecha pedida, solo
 * posiblemente menos. Así el walk-forward y las predicciones por empresa comparten entrenamientos.
 */
const CACHE = new WeakMap<EventRow[], Map<string, TrainedSet>>();
export function refitDate(d: string): string {
  if (d >= '9999') return d;
  return `${d.slice(0, 4)}-${d.slice(5, 7) < '07' ? '01' : '07'}-01`;
}
export function trainCached(rows: EventRow[], mode: Mode, h: Horizon, cutoff: string): TrainedSet {
  const c = refitDate(cutoff);
  let m = CACHE.get(rows);
  if (!m) CACHE.set(rows, (m = new Map()));
  const k = `${mode}:${h}:${c}`;
  let set = m.get(k);
  if (!set) m.set(k, (set = train(rows, mode, h, c)));
  return set;
}

export function train(rows: EventRow[], mode: Mode, h: Horizon, cutoff: string): TrainedSet {
  const tr = trainingRows(rows, mode, h, cutoff);
  const y = tr.map((r) => r.labels[mode][h]!.outcome);
  const zByClass: Record<Outcome, number[]> = { UP: [], DOWN: [], FLAT: [] };
  for (const r of tr) {
    const l = r.labels[mode][h]!;
    zByClass[l.outcome].push(l.ret / (r.sigma! * Math.sqrt(h)));
  }
  const features = mode === 'PRE' ? PRE_FEATURES : POST_FEATURES;
  const logistic = tr.length >= MIN_TRAIN_EVENTS ? fitWithSelectedL2(tr, y, mode, features) : null;
  const last = tr.map((r) => r.labels[mode][h]!.endDate).sort().at(-1) ?? '';
  return { mode, horizon: h, baseline: fitBaseline(y), logistic, zByClass, nTrain: tr.length, trainedThrough: last, oosSkill: null, oosN: 0 };
}

/**
 * Regularización elegida con validación temporal INTERNA al entrenamiento: se ajusta con el 75% más antiguo
 * y se evalúa en el 25% más reciente; gana la λ con menor log loss. Luego se reentrena con todo.
 * Si ninguna λ supera al baseline en esa validación, se devuelve el modelo con la λ más fuerte (casi baseline).
 */
export const L2_GRID = [L2, 30, 300];
function fitWithSelectedL2(tr: EventRow[], y: Outcome[], mode: Mode, features: string[]): LogisticModel {
  const order = tr.map((r, i) => ({ d: decisionDate(r, mode), i })).sort((a, b) => a.d.localeCompare(b.d)).map((x) => x.i);
  const cut = Math.floor(order.length * 0.75);
  const fitIdx = order.slice(0, cut);
  const valIdx = order.slice(cut);
  let best = L2_GRID.at(-1)!;
  if (valIdx.length >= 20 && fitIdx.length >= 40) {
    let bestLL = Infinity;
    for (const l2 of L2_GRID) {
      const m = fitLogistic(fitIdx.map((i) => tr[i].features[mode]), fitIdx.map((i) => y[i]), features, { l2, iters: 80 });
      const ll = mean(valIdx.map((i) => logLoss(predictLogistic(m, tr[i].features[mode]), y[i])));
      if (ll < bestLL) {
        bestLL = ll;
        best = l2;
      }
    }
  }
  return fitLogistic(tr.map((r) => r.features[mode]), y, features, { l2: best, iters: 150 });
}

export function probsFor(set: TrainedSet, f: FeatureVector): { probs: Probabilities; model: ModelName } {
  if (set.logistic) return { probs: predictLogistic(set.logistic, f), model: 'logistic' };
  return { probs: set.baseline.probs, model: 'baseline' };
}

/** Cuantil de una mezcla de muestras ponderadas por la probabilidad de cada clase. */
function mixtureQuantile(set: TrainedSet, p: Probabilities, q: number): number | null {
  const pts: { z: number; w: number }[] = [];
  const add = (c: Outcome, pc: number) => {
    const zs = set.zByClass[c];
    for (const z of zs) pts.push({ z, w: pc / zs.length });
  };
  if (!set.zByClass.UP.length || !set.zByClass.DOWN.length || !set.zByClass.FLAT.length) return null;
  add('UP', p.up);
  add('DOWN', p.down);
  add('FLAT', p.flat);
  pts.sort((a, b) => a.z - b.z);
  let acc = 0;
  for (const x of pts) {
    acc += x.w;
    if (acc >= q) return x.z;
  }
  return pts.at(-1)!.z;
}

export function invalidationFor(mode: Mode, p: Probabilities, basePrice: number | null, sigma: number | null, h: Horizon): string[] {
  const out: string[] = [];
  const bull = p.up > p.down;
  if (mode === 'PRE') {
    out.push('Se publica el reporte: la predicción PRE deja de aplicar y se reemplaza por la POST.');
    out.push('Cambio de fecha u hora del reporte.');
  } else {
    out.push(bull ? 'La siguiente sesión cierra por debajo del mínimo del día 0 (el mercado no confirma).' : 'La siguiente sesión cierra por encima del máximo del día 0 (el mercado no confirma).');
  }
  if (basePrice && sigma) {
    const move = sigma * Math.sqrt(h) * 1.5;
    out.push(bull ? `Cierre por debajo de ${(basePrice * (1 - move)).toFixed(2)} (−1.5σ del horizonte).` : `Cierre por encima de ${(basePrice * (1 + move)).toFixed(2)} (+1.5σ del horizonte).`);
  }
  out.push('Movimiento del S&P 500 mayor a ±3% en una sesión (riesgo de mercado domina).');
  return out;
}

export function confidenceFor(set: TrainedSet, model: ModelName, p: Probabilities, missingCritical: boolean): Prediction['confidence'] {
  if (set.nTrain < MIN_TRAIN_EVENTS) return 'EVIDENCIA_INSUFICIENTE';
  // Misma compuerta que el backtest: sin habilidad fuera de muestra demostrada (n ≥ 100, skill > 0.005) no hay confianza.
  if (model === 'baseline' || set.oosSkill === null || set.oosSkill <= 0.005 || set.oosN < 100) return 'BAJA';
  const edge = Math.abs(p.up - p.down);
  if (set.oosSkill > 0.03 && edge >= 0.2 && !missingCritical && set.oosN >= 100) return 'ALTA';
  if (set.oosSkill > 0.01 && edge >= 0.1) return 'MEDIA';
  return 'BAJA';
}

export function predict(set: TrainedSet, args: { symbol: string; reportDate: string; decisionDate: string; features: FeatureVector; basePrice: number | null; sigma: number | null; roundTrip: number; missingCritical?: boolean; createdAt?: string }): Prediction {
  const { mode, horizon: h } = set;
  const id = `${args.symbol}:${args.reportDate}:${mode}:${h}`;
  const createdAt = args.createdAt ?? new Date().toISOString();
  const base = { id, symbol: args.symbol, reportDate: args.reportDate, mode, horizon: h, createdAt, decisionDate: args.decisionDate, referencePrice: args.basePrice, modelVersion: MODEL_VERSION };
  if (set.nTrain < MIN_TRAIN_EVENTS || args.sigma === null) {
    return {
      ...base, model: 'baseline', probs: null, flatBand: null, expectedReturn: null, interval: null, confidence: 'EVIDENCIA_INSUFICIENTE', factors: [], invalidation: [],
      insufficientReason: args.sigma === null ? 'Sin historia de precios suficiente para medir la volatilidad previa.' : `Solo ${set.nTrain} eventos con resultado conocido (mínimo ${MIN_TRAIN_EVENTS}).`,
    };
  }
  const { probs, model } = probsFor(set, args.features);
  const scale = args.sigma * Math.sqrt(h);
  // Esperanza de la mezcla: Σ_c p_c · media(z | clase c).
  const cm = (c: Outcome) => (set.zByClass[c].length ? mean(set.zByClass[c]) : 0);
  const expectedZ = probs.up * cm('UP') + probs.down * cm('DOWN') + probs.flat * cm('FLAT');
  const lo = mixtureQuantile(set, probs, 0.1);
  const hi = mixtureQuantile(set, probs, 0.9);
  const factors: FactorContribution[] = set.logistic
    ? contributions(set.logistic, args.features)
        .filter((c) => Math.abs(c.contribution) > 1e-6)
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
        .slice(0, 8)
        .map((c) => ({ ...c, label: FEATURE_LABELS[c.feature] ?? c.feature }))
    : [];
  return {
    ...base,
    model,
    probs,
    flatBand: Math.max(args.roundTrip, 0.5 * scale),
    expectedReturn: expectedZ * scale,
    interval: lo !== null && hi !== null ? [lo * scale, hi * scale] : null,
    confidence: confidenceFor(set, model, probs, !!args.missingCritical),
    factors,
    invalidation: invalidationFor(mode, probs, args.basePrice, args.sigma, h),
  };
}

export { quantile };
