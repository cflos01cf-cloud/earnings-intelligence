/** Estadística básica, determinista y sin dependencias. */

export const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function mean(xs: number[]): number {
  if (!xs.length) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Desviación estándar muestral (n−1). */
export function std(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

/** Cuantil con interpolación lineal (tipo 7). */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  const pos = (a.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

/** Rango percentil de x dentro de xs (0–100). */
export function percentileRank(xs: number[], x: number): number {
  if (!xs.length) return NaN;
  let below = 0;
  let equal = 0;
  for (const v of xs) {
    if (v < x) below++;
    else if (v === x) equal++;
  }
  return ((below + 0.5 * equal) / xs.length) * 100;
}

export function round(x: number, d = 4): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

/** Intervalo de Wilson al 95% para una proporción. */
export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - r) / d), Math.min(1, (c + r) / d)];
}

/** Bootstrap de la media (intervalo 95%) con semilla fija para reproducibilidad. */
export function bootstrapMeanCI(xs: number[], iterations = 1000, seed = 7): [number, number] {
  if (xs.length < 2) return [NaN, NaN];
  const rnd = mulberry32(seed);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let s = 0;
    for (let j = 0; j < xs.length; j++) s += xs[Math.floor(rnd() * xs.length)];
    means.push(s / xs.length);
  }
  return [quantile(means, 0.025), quantile(means, 0.975)];
}

/** PRNG determinista. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}
