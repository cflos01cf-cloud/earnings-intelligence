/**
 * Regresión logística multinomial (softmax) con regularización L2, entrenada por descenso de
 * gradiente con Adam. Determinista (pesos iniciales en cero). Sin dependencias.
 *
 * Clases en orden fijo: 0 = UP, 1 = DOWN, 2 = FLAT.
 */
import type { FeatureVector } from './dataset';
import type { Outcome, Probabilities } from '../types';
import { mean, std } from '../util/stats';

export const CLASSES: Outcome[] = ['UP', 'DOWN', 'FLAT'];

export interface Scaler {
  features: string[];
  mean: number[];
  sd: number[];
}

export function fitScaler(rows: FeatureVector[], features: string[]): Scaler {
  const m: number[] = [];
  const s: number[] = [];
  for (const f of features) {
    const xs = rows.map((r) => r[f]).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    const mu = xs.length ? mean(xs) : 0;
    const sd = xs.length > 1 ? std(xs) : 1;
    m.push(mu);
    s.push(sd > 1e-12 ? sd : 1);
  }
  return { features, mean: m, sd: s };
}

/** Estandariza; los faltantes quedan en 0 (= media del entrenamiento). Las banderas has_* conservan la información de faltante. */
export function transform(sc: Scaler, r: FeatureVector): number[] {
  return sc.features.map((f, j) => {
    const x = r[f];
    return typeof x === 'number' && Number.isFinite(x) ? (x - sc.mean[j]) / sc.sd[j] : 0;
  });
}

export interface LogisticModel {
  kind: 'logistic';
  scaler: Scaler;
  /** W[c][0] = intercepto; W[c][j+1] = coeficiente de la variable j. */
  W: number[][];
  nTrain: number;
  l2: number;
}

function softmax(z: number[]): number[] {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

export function fitLogistic(X: FeatureVector[], y: Outcome[], features: string[], o: { l2?: number; iters?: number; lr?: number } = {}): LogisticModel {
  const scaler = fitScaler(X, features);
  const Z = X.map((r) => transform(scaler, r));
  const n = Z.length;
  const p = features.length;
  const K = CLASSES.length;
  const yi = y.map((c) => CLASSES.indexOf(c));
  const l2 = o.l2 ?? 1;
  const lr = o.lr ?? 0.05;
  const iters = o.iters ?? 600;
  const W = Array.from({ length: K }, () => new Array(p + 1).fill(0));
  const mW = W.map((r) => r.map(() => 0));
  const vW = W.map((r) => r.map(() => 0));
  const b1 = 0.9;
  const b2 = 0.999;
  const G = W.map((r) => r.map(() => 0));
  const z = new Array(K).fill(0);
  for (let t = 1; t <= iters; t++) {
    for (const row of G) row.fill(0);
    for (let i = 0; i < n; i++) {
      const zi = Z[i];
      let mx = -Infinity;
      for (let c = 0; c < K; c++) {
        const w = W[c];
        let s = w[0];
        for (let j = 0; j < p; j++) s += w[j + 1] * zi[j];
        z[c] = s;
        if (s > mx) mx = s;
      }
      let tot = 0;
      for (let c = 0; c < K; c++) {
        z[c] = Math.exp(z[c] - mx);
        tot += z[c];
      }
      for (let c = 0; c < K; c++) {
        const g = z[c] / tot - (yi[i] === c ? 1 : 0);
        const gc = G[c];
        gc[0] += g;
        for (let j = 0; j < p; j++) gc[j + 1] += g * zi[j];
      }
    }
    for (let c = 0; c < K; c++) {
      for (let j = 0; j <= p; j++) {
        const g = G[c][j] / n + (j > 0 ? (l2 / n) * W[c][j] : 0);
        mW[c][j] = b1 * mW[c][j] + (1 - b1) * g;
        vW[c][j] = b2 * vW[c][j] + (1 - b2) * g * g;
        const mh = mW[c][j] / (1 - b1 ** t);
        const vh = vW[c][j] / (1 - b2 ** t);
        W[c][j] -= (lr * mh) / (Math.sqrt(vh) + 1e-8);
      }
    }
  }
  return { kind: 'logistic', scaler, W, nTrain: n, l2 };
}

export function predictLogistic(m: LogisticModel, r: FeatureVector): Probabilities {
  const z = transform(m.scaler, r);
  const logits = m.W.map((w) => w[0] + w.slice(1).reduce((s, wj, j) => s + wj * z[j], 0));
  const [up, down, flat] = softmax(logits);
  return { up, down, flat };
}

/** Contribución de cada variable al logit(UP) − logit(DOWN). */
export function contributions(m: LogisticModel, r: FeatureVector): { feature: string; value: number | null; contribution: number }[] {
  const z = transform(m.scaler, r);
  return m.scaler.features.map((f, j) => ({ feature: f, value: r[f] ?? null, contribution: (m.W[0][j + 1] - m.W[1][j + 1]) * z[j] }));
}

/** Importancia global: |coef UP − coef DOWN| (sobre variables estandarizadas). */
export function importance(m: LogisticModel): Record<string, number> {
  return Object.fromEntries(m.scaler.features.map((f, j) => [f, m.W[0][j + 1] - m.W[1][j + 1]]));
}

export interface BaselineModel {
  kind: 'baseline';
  probs: Probabilities;
  nTrain: number;
}

/** Frecuencias de entrenamiento con suavizado de Laplace. */
export function fitBaseline(y: Outcome[]): BaselineModel {
  const c = { UP: 1, DOWN: 1, FLAT: 1 };
  for (const o of y) c[o]++;
  const t = c.UP + c.DOWN + c.FLAT;
  return { kind: 'baseline', probs: { up: c.UP / t, down: c.DOWN / t, flat: c.FLAT / t }, nTrain: y.length };
}

// ───────────── Métricas de probabilidad ─────────────

export function brier(p: Probabilities, y: Outcome): number {
  return (p.up - (y === 'UP' ? 1 : 0)) ** 2 + (p.down - (y === 'DOWN' ? 1 : 0)) ** 2 + (p.flat - (y === 'FLAT' ? 1 : 0)) ** 2;
}

export function logLoss(p: Probabilities, y: Outcome): number {
  const q = y === 'UP' ? p.up : y === 'DOWN' ? p.down : p.flat;
  return -Math.log(Math.max(1e-12, q));
}
