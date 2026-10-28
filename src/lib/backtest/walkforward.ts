/**
 * Backtest walk-forward sin información futura.
 *
 *  - Bloques de prueba consecutivos (por defecto trimestrales).
 *  - Para cada bloque, el modelo se entrena SOLO con eventos cuya etiqueta terminó antes de que empiece el bloque
 *    (purga: un evento de 20 sesiones que aún no termina no entra al entrenamiento).
 *  - Las probabilidades fuera de muestra se evalúan con Brier, log loss y calibración, contra el baseline.
 *  - Las estrategias se simulan día a día con costos, posiciones simultáneas limitadas y se comparan con
 *    no operar, comprar después de todo reporte, la regla de solo sorpresa de EPS y comprar y mantener el S&P 500.
 */
import type { Bar, Horizon, Mode, Outcome, Probabilities } from '../types';
import type { EventRow } from '../model/dataset';
import { decisionDate, probsFor, train, type TrainedSet } from '../model/engine';
import { brier, logLoss } from '../model/logistic';
import { MIN_TRAIN_EVENTS } from '../config';
import { lowerBound } from '../analysis/reaction';
export const GATE_MIN_N = 100;
export const GATE_MIN_SKILL = 0.005;
import { bootstrapMeanCI, mean, quantile, std, wilson } from '../util/stats';

export interface OosPrediction {
  id: string;
  symbol: string;
  sector: string;
  decisionDate: string;
  endDate: string;
  model: Probabilities;
  baseline: Probabilities;
  usedModel: 'logistic' | 'baseline';
  outcome: Outcome;
  ret: number;
  epsVerdict: string;
  capApprox: number | null;
  marketVol20: number | null;
  trainN: number;
  /** ¿El modelo ya había demostrado habilidad en bloques ANTERIORES? (misma regla que la app en vivo). */
  gateOpen: boolean;
}

export interface ProbMetrics {
  n: number;
  brierModel: number;
  brierBaseline: number;
  logLossModel: number;
  logLossBaseline: number;
  /** 1 − logloss_modelo / logloss_baseline. > 0 = el modelo agrega información. */
  skill: number;
  accuracyModel: number;
  accuracyBaseline: number;
  calibration: { bin: string; predicted: number; observed: number; n: number }[];
}

export interface StrategyMetrics {
  name: string;
  description: string;
  trades: number;
  winRate: number | null;
  winRateCI: [number, number] | null;
  avgWin: number | null;
  avgLoss: number | null;
  expectancy: number | null; // rendimiento neto medio por operación
  expectancyCI: [number, number] | null;
  netReturn: number; // de la cartera simulada
  cagr: number | null;
  maxDrawdown: number;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  equity: { date: string; value: number }[];
}

export interface Breakdown {
  group: string;
  trades: number;
  expectancy: number | null;
  winRate: number | null;
}

export interface WalkForwardResult {
  mode: Mode;
  horizon: Horizon;
  generatedAt: string;
  roundTrip: number;
  edge: number;
  maxConcurrent: number;
  testStart: string | null;
  testEnd: string | null;
  folds: { start: string; end: string; trainN: number; testN: number }[];
  prob: ProbMetrics | null;
  strategies: StrategyMetrics[];
  bySector: Breakdown[];
  byCap: Breakdown[];
  byVolRegime: Breakdown[];
  predictions: OosPrediction[];
  warnings: string[];
  /** Último modelo con habilidad fuera de muestra anotada (lo usa la app en vivo). */
  liveSet?: TrainedSet;
}

function addMonths(d: string, m: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + m);
  return x.toISOString().slice(0, 10);
}

export function probMetrics(preds: OosPrediction[]): ProbMetrics | null {
  if (!preds.length) return null;
  const argmax = (p: Probabilities): Outcome => (p.up >= p.down && p.up >= p.flat ? 'UP' : p.down >= p.flat ? 'DOWN' : 'FLAT');
  const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, ps: [] as number[], ys: [] as number[] }));
  for (const p of preds) {
    const b = bins[Math.min(9, Math.floor(p.model.up * 10))];
    b.ps.push(p.model.up);
    b.ys.push(p.outcome === 'UP' ? 1 : 0);
  }
  const llM = mean(preds.map((p) => logLoss(p.model, p.outcome)));
  const llB = mean(preds.map((p) => logLoss(p.baseline, p.outcome)));
  return {
    n: preds.length,
    brierModel: mean(preds.map((p) => brier(p.model, p.outcome))),
    brierBaseline: mean(preds.map((p) => brier(p.baseline, p.outcome))),
    logLossModel: llM,
    logLossBaseline: llB,
    skill: 1 - llM / llB,
    accuracyModel: preds.filter((p) => argmax(p.model) === p.outcome).length / preds.length,
    accuracyBaseline: preds.filter((p) => argmax(p.baseline) === p.outcome).length / preds.length,
    calibration: bins.filter((b) => b.ps.length).map((b) => ({ bin: `${(b.lo * 100).toFixed(0)}–${(b.hi * 100).toFixed(0)}%`, predicted: mean(b.ps), observed: mean(b.ys), n: b.ps.length })),
  };
}

interface Trade { symbol: string; entryDate: string; exitDate: string; ret: number; entryAt: 'open' | 'close' }

/**
 * Cartera simulada: K posiciones simultáneas como máximo, cada una con 1/K del capital, valuadas a diario
 * con las velas reales. El costo ida y vuelta se descuenta mitad a la entrada y mitad a la salida.
 * Si ya hay K posiciones abiertas, la señal se omite (y se cuenta).
 */
export function simulatePortfolio(trades: Trade[], barsBy: Map<string, Bar[]>, calendar: Bar[], roundTrip: number, K: number): { equity: { date: string; value: number }[]; skipped: number; taken: Trade[] } {
  const sorted = [...trades].sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.symbol.localeCompare(b.symbol));
  const open: { t: Trade; bars: Bar[]; idx: number; exitIdx: number }[] = [];
  const taken: Trade[] = [];
  let skipped = 0;
  let k = 0;
  if (!sorted.length) return { equity: [], skipped: 0, taken };
  const startI = lowerBound(calendar, sorted[0].entryDate);
  let value = 1;
  const equity: { date: string; value: number }[] = [];
  for (let ci = startI; ci < calendar.length; ci++) {
    const date = calendar[ci].time;
    while (k < sorted.length && sorted[k].entryDate <= date) {
      const t = sorted[k++];
      if (t.entryDate !== date) continue; // entrada en día sin sesión del calendario: se omite
      const bars = barsBy.get(t.symbol);
      if (!bars) continue;
      const idx = lowerBound(bars, date);
      const exitIdx = lowerBound(bars, t.exitDate);
      if (idx >= bars.length || bars[idx].time !== date || exitIdx >= bars.length) continue;
      if (open.length >= K) {
        skipped++;
        continue;
      }
      open.push({ t, bars, idx, exitIdx });
      taken.push(t);
    }
    let day = 0;
    for (let i = open.length - 1; i >= 0; i--) {
      const p = open[i];
      const bi = lowerBound(p.bars, date);
      if (bi >= p.bars.length || p.bars[bi].time !== date) continue;
      let r: number;
      if (bi === p.idx) {
        // Día de entrada: desde la apertura (POST) o sin cambio (PRE entra al cierre).
        r = p.t.entryAt === 'open' ? p.bars[bi].close / p.bars[bi].open - 1 : 0;
        r -= roundTrip / 2;
      } else {
        r = p.bars[bi].close / p.bars[bi - 1].close - 1;
      }
      if (bi >= p.exitIdx) r -= roundTrip / 2;
      day += r / K;
      if (bi >= p.exitIdx) open.splice(i, 1);
    }
    value *= 1 + day;
    equity.push({ date, value });
    if (k >= sorted.length && !open.length) break;
  }
  return { equity, skipped, taken };
}

export function curveStats(equity: { date: string; value: number }[]): Pick<StrategyMetrics, 'netReturn' | 'cagr' | 'maxDrawdown' | 'sharpe' | 'sortino' | 'calmar'> {
  if (equity.length < 2) return { netReturn: 0, cagr: null, maxDrawdown: 0, sharpe: null, sortino: null, calmar: null };
  const rets = equity.slice(1).map((e, i) => e.value / equity[i].value - 1);
  let peak = equity[0].value;
  let mdd = 0;
  for (const e of equity) {
    peak = Math.max(peak, e.value);
    mdd = Math.min(mdd, e.value / peak - 1);
  }
  const years = (Date.parse(equity.at(-1)!.date) - Date.parse(equity[0].date)) / (365.25 * 86_400_000);
  const net = equity.at(-1)!.value / equity[0].value - 1;
  const cagr = years > 0.25 ? (1 + net) ** (1 / years) - 1 : null;
  const sd = std(rets);
  const down = rets.filter((r) => r < 0);
  const dsd = down.length > 1 ? Math.sqrt(mean(down.map((r) => r * r))) : NaN;
  const m = mean(rets);
  return {
    netReturn: net,
    cagr,
    maxDrawdown: mdd,
    sharpe: sd > 0 ? (m / sd) * Math.sqrt(252) : null,
    sortino: dsd > 0 ? (m / dsd) * Math.sqrt(252) : null,
    calmar: cagr !== null && mdd < 0 ? cagr / -mdd : null,
  };
}

function tradeStats(rets: number[]): Pick<StrategyMetrics, 'trades' | 'winRate' | 'winRateCI' | 'avgWin' | 'avgLoss' | 'expectancy' | 'expectancyCI'> {
  const wins = rets.filter((r) => r > 0);
  const losses = rets.filter((r) => r <= 0);
  return {
    trades: rets.length,
    winRate: rets.length ? wins.length / rets.length : null,
    winRateCI: rets.length ? wilson(wins.length, rets.length) : null,
    avgWin: wins.length ? mean(wins) : null,
    avgLoss: losses.length ? mean(losses) : null,
    expectancy: rets.length ? mean(rets) : null,
    expectancyCI: rets.length >= 10 ? bootstrapMeanCI(rets) : null,
  };
}

function breakdown(preds: OosPrediction[], take: (p: OosPrediction) => boolean, groupOf: (p: OosPrediction) => string, roundTrip: number): Breakdown[] {
  const g = new Map<string, number[]>();
  for (const p of preds) {
    if (!take(p)) continue;
    const k = groupOf(p);
    if (!g.has(k)) g.set(k, []);
    g.get(k)!.push(p.ret - roundTrip);
  }
  return [...g].map(([group, rs]) => ({ group, trades: rs.length, expectancy: rs.length ? mean(rs) : null, winRate: rs.length ? rs.filter((r) => r > 0).length / rs.length : null })).sort((a, b) => b.trades - a.trades);
}

export function isLongSignal(p: Probabilities, edge: number): boolean {
  return p.up - p.down >= edge && p.up >= p.flat;
}

export interface WalkForwardOptions {
  mode: Mode;
  horizon: Horizon;
  roundTrip: number;
  stepMonths?: number;
  edge?: number;
  maxConcurrent?: number;
  from?: string;
  to?: string;
  sector?: string;
  symbol?: string;
  generatedAt?: string;
}

export function runWalkForward(allRows: EventRow[], barsBy: Map<string, Bar[]>, spy: Bar[], o: WalkForwardOptions): WalkForwardResult {
  const { mode, horizon: h, roundTrip } = o;
  const step = o.stepMonths ?? 3;
  const edge = o.edge ?? 0.1;
  const K = o.maxConcurrent ?? 10;
  const warnings: string[] = [];
  const rows = allRows.filter((r) => r.labels[mode][h] && r.sigma).sort((a, b) => decisionDate(a, mode).localeCompare(decisionDate(b, mode)));
  const base: WalkForwardResult = { mode, horizon: h, generatedAt: o.generatedAt ?? new Date().toISOString(), roundTrip, edge, maxConcurrent: K, testStart: null, testEnd: null, folds: [], prob: null, strategies: [], bySector: [], byCap: [], byVolRegime: [], predictions: [], warnings };
  if (rows.length < MIN_TRAIN_EVENTS + 20) {
    warnings.push(`Evidencia insuficiente: ${rows.length} eventos con etiqueta (se necesitan al menos ${MIN_TRAIN_EVENTS + 20}).`);
    return base;
  }
  // Primer bloque: cuando ya hay MIN_TRAIN_EVENTS etiquetas terminadas.
  const ends = rows.map((r) => r.labels[mode][h]!.endDate).sort();
  let start = ends[MIN_TRAIN_EVENTS - 1];
  start = start > (o.from ?? '') ? start : o.from!;
  const lastDecision = decisionDate(rows.at(-1)!, mode);
  const stop = o.to && o.to < lastDecision ? o.to : lastDecision;
  const preds: OosPrediction[] = [];
  let liveSet: TrainedSet | undefined;
  for (let s = start; s <= stop; s = addMonths(s, step)) {
    const e = addMonths(s, step);
    const set = train(allRows, mode, h, s);
    const test = rows.filter((r) => {
      const d = decisionDate(r, mode);
      return d >= s && d < e && (!o.sector || r.sector === o.sector) && (!o.symbol || r.symbol === o.symbol);
    });
    base.folds.push({ start: s, end: e, trainN: set.nTrain, testN: test.length });
    // Compuerta: solo se opera con el modelo si su habilidad fuera de muestra ACUMULADA hasta antes del bloque es > 0.
    const priorSkill = preds.length >= GATE_MIN_N ? probMetrics(preds)!.skill : null;
    const gateOpen = priorSkill !== null && priorSkill > GATE_MIN_SKILL;
    for (const r of test) {
      const f = r.features[mode];
      const l = r.labels[mode][h]!;
      const model = probsFor(set, f).probs;
      preds.push({ id: r.id, symbol: r.symbol, sector: r.sector, decisionDate: decisionDate(r, mode), endDate: l.endDate, model, baseline: set.baseline.probs, usedModel: set.logistic ? 'logistic' : 'baseline', outcome: l.outcome, ret: l.ret, epsVerdict: r.facts.epsVerdict, capApprox: r.capApprox, marketVol20: r.marketVol20, trainN: set.nTrain, gateOpen });
    }
  }
  base.predictions = preds;
  base.testStart = preds[0]?.decisionDate ?? null;
  base.testEnd = preds.at(-1)?.decisionDate ?? null;
  base.prob = probMetrics(preds);
  if (base.prob && base.prob.skill <= 0) warnings.push('El modelo NO supera al baseline de frecuencias fuera de muestra: sus probabilidades no agregan información en este modo y horizonte.');
  if (preds.length < 200) warnings.push(`Muestra fuera de muestra pequeña (${preds.length} eventos): los intervalos de confianza son amplios.`);

  // Estrategias
  const barsOK = (p: OosPrediction) => barsBy.has(p.symbol);
  const toTrade = (p: OosPrediction): Trade => {
    const row = rows.find((r) => r.id === p.id)!;
    const entryDate = mode === 'PRE' ? row.baseDate : row.day0Date;
    return { symbol: p.symbol, entryDate, exitDate: p.endDate, ret: p.ret, entryAt: mode === 'PRE' ? 'close' : 'open' };
  };
  const strat = (name: string, description: string, take: (p: OosPrediction) => boolean): StrategyMetrics => {
    const chosen = preds.filter((p) => take(p) && barsOK(p));
    const sim = simulatePortfolio(chosen.map(toTrade), barsBy, spy, roundTrip, K);
    const takenIds = new Set(sim.taken.map((t) => `${t.symbol}:${t.entryDate}`));
    const rets = chosen.filter((p) => takenIds.has(`${p.symbol}:${toTrade(p).entryDate}`)).map((p) => p.ret - roundTrip);
    if (sim.skipped) warnings.push(`${name}: ${sim.skipped} señales omitidas por tener ${K} posiciones abiertas.`);
    return { name, description, ...tradeStats(rets), ...curveStats(sim.equity), equity: thin(sim.equity) };
  };
  base.strategies.push(strat('Modelo', `Compra si P(subida) − P(bajada) ≥ ${(edge * 100).toFixed(0)} pp, P(subida) ≥ P(lateral) y el modelo ya superó al baseline en bloques anteriores. Solo largos (en GBM no hay cortos en acciones de EE.UU.).`, (p) => p.gateOpen && isLongSignal(p.model, edge)));
  if (mode === 'POST') base.strategies.push(strat('Solo sorpresa de EPS', 'Compra en la apertura si el EPS superó el consenso.', (p) => p.epsVerdict === 'BEAT'));
  base.strategies.push(strat(mode === 'PRE' ? 'Comprar antes de todo reporte' : 'Comprar después de todo reporte', 'Sin filtro: mide si el modelo agrega algo a operar cada reporte.', () => true));
  base.strategies.push({ name: 'No operar', description: 'Referencia: 0%.', trades: 0, winRate: null, winRateCI: null, avgWin: null, avgLoss: null, expectancy: null, expectancyCI: null, netReturn: 0, cagr: 0, maxDrawdown: 0, sharpe: null, sortino: null, calmar: null, equity: [] });
  if (base.testStart && base.testEnd) {
    const si = lowerBound(spy, base.testStart);
    const ei = Math.min(spy.length - 1, lowerBound(spy, base.testEnd));
    const eq = spy.slice(si, ei + 1).map((b) => ({ date: b.time, value: b.close / spy[si].close }));
    base.strategies.push({ name: 'Comprar y mantener S&P 500', description: 'SPY durante todo el periodo de prueba (sin dividendos si el proveedor no los ajusta).', trades: 1, winRate: null, winRateCI: null, avgWin: null, avgLoss: null, expectancy: null, expectancyCI: null, ...curveStats(eq), equity: thin(eq) });
  }

  const take = (p: OosPrediction) => p.gateOpen && isLongSignal(p.model, edge);
  base.bySector = breakdown(preds, take, (p) => p.sector, roundTrip);
  const caps = preds.map((p) => p.capApprox).filter((x): x is number => x !== null);
  const c33 = caps.length ? quantile(caps, 1 / 3) : NaN;
  const c66 = caps.length ? quantile(caps, 2 / 3) : NaN;
  base.byCap = breakdown(preds, take, (p) => (p.capApprox === null ? 'Sin dato' : p.capApprox < c33 ? 'Tercio menor' : p.capApprox < c66 ? 'Tercio medio' : 'Tercio mayor'), roundTrip);
  const vols = preds.map((p) => p.marketVol20).filter((x): x is number => x !== null);
  const v33 = vols.length ? quantile(vols, 1 / 3) : NaN;
  const v66 = vols.length ? quantile(vols, 2 / 3) : NaN;
  base.byVolRegime = breakdown(preds, take, (p) => (p.marketVol20 === null ? 'Sin dato' : p.marketVol20 < v33 ? 'Mercado tranquilo' : p.marketVol20 < v66 ? 'Volatilidad media' : 'Mercado volátil'), roundTrip);

  // Modelo vigente: entrenado con todo lo terminado, con la habilidad fuera de muestra anotada.
  liveSet = train(allRows, mode, h, '9999-12-31');
  liveSet.oosSkill = base.prob?.skill ?? null;
  liveSet.oosN = base.prob?.n ?? 0;
  base.liveSet = liveSet;
  return base;
}

function thin<T>(xs: T[], max = 400): T[] {
  if (xs.length <= max) return xs;
  const step = xs.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(xs[Math.floor(i * step)]);
  out.push(xs.at(-1)!);
  return out;
}
