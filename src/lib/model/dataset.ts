/**
 * Construcción del conjunto de eventos con variables PUNTO EN EL TIEMPO y etiquetas a 1, 5 y 20 sesiones.
 *
 * Reglas anti look-ahead (probadas en tests/no-lookahead.test.ts):
 *   - PRE  decide al cierre de la base: solo velas ≤ base, trimestres presentados antes de la base,
 *          reportes previos cuya reacción a 1 sesión ya terminó.
 *   - POST decide al CIERRE del día 0: lo anterior + cifras del reporte + reacción y volumen del día 0.
 *          Nada posterior al cierre del día 0.
 *   - Consenso de ingresos solo si lo observamos antes del día del anuncio.
 */
import type { Bar, Company, Horizon, Mode, Outcome, QuarterFundamentals } from '../types';
import { HORIZONS } from '../types';
import type { MergedEvent } from '../analysis/events';
import { abnormalVolume, align, benchmarkReturn, classify, dailyVol, flatBand, labelReturn, labelSpan, lowerBound, trailingReturn } from '../analysis/reaction';
import { epsSurprise, revenueSurprise } from '../analysis/surprise';
import { asOfQuarter, quarterMetrics } from '../analysis/fundamentals';
import { mean } from '../util/stats';

export interface SymbolData {
  company: Company;
  bars: Bar[];
  events: MergedEvent[];
  quarters: QuarterFundamentals[];
}

export interface Label {
  ret: number;
  abnormal: number | null;
  band: number;
  outcome: Outcome;
  endDate: string;
}

export type FeatureVector = Record<string, number | null>;

export interface EventRow {
  id: string;
  symbol: string;
  sector: string;
  reportDate: string;
  reportTime: string;
  twoSessionWindow: boolean;
  baseDate: string;
  day0Date: string;
  basePrice: number;
  day0Open: number;
  /** Precio de decisión POST (cierre del día 0). */
  day0Close: number;
  sigma: number | null;
  /** Capitalización aproximada al cierre base: acciones diluidas del último 10-Q × precio. */
  capApprox: number | null;
  /** Volatilidad diaria del S&P 500 (20 sesiones) a la base: define el régimen. */
  marketVol20: number | null;
  features: Record<Mode, FeatureVector>;
  labels: Record<Mode, Partial<Record<Horizon, Label>>>;
  /** Datos del reporte para mostrar (no para el modelo PRE). */
  facts: {
    epsActual: number | null;
    epsEstimate: number | null;
    epsSurprisePct: number | null;
    epsVerdict: string;
    revenueActual: number | null;
    revenueEstimate: number | null;
    revenueSurprisePct: number | null;
    gap: number;
    react0: number;
    abnormalVolume: number | null;
  };
}

export const FEATURE_LABELS: Record<string, string> = {
  hist_n: 'Reportes previos con historia',
  hist_mean_react: 'Reacción media anormal en reportes previos',
  hist_abs_react: 'Movimiento típico en reportes previos',
  hist_beat_rate: 'Frecuencia histórica de superar el consenso de EPS',
  hist_sell_news: 'Caídas pese a superar el consenso (historia)',
  runup20_rel: 'Subida previa de 20 sesiones vs. S&P 500',
  mom60_rel: 'Momento de 60 sesiones vs. S&P 500',
  vol60: 'Volatilidad diaria previa (60 sesiones)',
  spy20: 'Tendencia del S&P 500 (20 sesiones)',
  sector20_rel: 'Sector vs. S&P 500 (20 sesiones)',
  prev_surprise_bps: 'Sorpresa de EPS del reporte anterior',
  fund_rev_yoy: 'Crecimiento interanual de ingresos (último 10-Q)',
  fund_opm_chg: 'Cambio en margen operativo (último 10-Q)',
  fund_fcf_margin: 'Margen de flujo libre (último 10-Q)',
  fund_accrual: 'Utilidad vs. flujo operativo (último 10-Q)',
  has_fund: 'Hay fundamentales de EDGAR',
  eps_surprise_bps: 'Sorpresa de EPS (escalada por precio)',
  eps_beat: 'Superó / cumplió / incumplió EPS',
  rev_surprise_pct: 'Sorpresa de ingresos',
  has_rev_surprise: 'Hay consenso de ingresos verificable',
  react0: 'Reacción del día 0',
  react0_abn: 'Reacción del día 0 vs. S&P 500',
  react0_z: 'Reacción del día 0 en desviaciones estándar',
  react0_x_surprise: 'Reacción alineada con la sorpresa',
  intraday0: 'Cierre vs. apertura del día 0 (confirmación)',
  abvol0: 'Volumen anormal del día 0',
};

export const PRE_FEATURES = ['hist_n', 'hist_mean_react', 'hist_abs_react', 'hist_beat_rate', 'hist_sell_news', 'runup20_rel', 'mom60_rel', 'vol60', 'spy20', 'sector20_rel', 'prev_surprise_bps', 'fund_rev_yoy', 'fund_opm_chg', 'fund_fcf_margin', 'fund_accrual', 'has_fund'];
export const POST_FEATURES = [...PRE_FEATURES, 'eps_surprise_bps', 'eps_beat', 'rev_surprise_pct', 'has_rev_surprise', 'react0', 'react0_abn', 'react0_z', 'react0_x_surprise', 'intraday0', 'abvol0'];

const clip = (x: number | null, lo: number, hi: number) => (x === null ? null : Math.max(lo, Math.min(hi, x)));

function relTrailing(bars: Bar[], bench: Bar[], end: number, n: number): number | null {
  const r = trailingReturn(bars, end, n);
  if (r === null) return null;
  const bi = lowerBound(bench, bars[end].time);
  if (bi >= bench.length || bench[bi].time !== bars[end].time) return null;
  const rb = trailingReturn(bench, bi, n);
  return rb === null ? null : r - rb;
}

function benchTrailing(bench: Bar[], date: string, n: number): number | null {
  let i = lowerBound(bench, date);
  if (i >= bench.length || bench[i].time !== date) i -= 1;
  return i >= 0 ? trailingReturn(bench, i, n) : null;
}

export function buildRows(d: SymbolData, spy: Bar[], sector: Bar[] | null, roundTrip: number): EventRow[] {
  const rows: EventRow[] = [];
  const bars = d.bars;
  const reported = d.events.filter((e) => e.status === 'reported');
  for (const e of reported) {
    const a = align(bars, e.reportDate, e.reportTime);
    if (!a || a.base < 61) continue;
    const base = bars[a.base];
    const day0 = bars[a.day0];
    const sigma = dailyVol(bars, a.base, 60);
    const baseDate = base.time;
    const day0Date = day0.time;

    // Historia de la misma emisora, solo reportes cuya reacción a 1 sesión terminó antes de la base.
    const prior = rows.filter((r) => r.labels.PRE[1] && r.labels.PRE[1]!.endDate < baseDate).slice(-8);
    const priorAbn = prior.map((r) => r.labels.PRE[1]!.abnormal ?? r.labels.PRE[1]!.ret);
    const priorBeats = prior.filter((r) => r.facts.epsVerdict === 'BEAT');
    const sellNews = priorBeats.length ? priorBeats.filter((r) => (r.labels.PRE[1]!.abnormal ?? r.labels.PRE[1]!.ret) < 0).length / priorBeats.length : null;
    const prev = prior.at(-1);

    // Fundamentales: último trimestre presentado ANTES de la decisión.
    const qPre = asOfQuarter(d.quarters, baseDate);
    const mPre = qPre ? quarterMetrics(d.quarters, qPre) : null;
    const qPost = asOfQuarter(d.quarters, day0Date);
    const mPost = qPost ? quarterMetrics(d.quarters, qPost) : null;

    const fund = (m: typeof mPre): FeatureVector => ({
      fund_rev_yoy: clip(m?.revenueYoY ?? null, -0.8, 2),
      fund_opm_chg: clip(m?.operatingMarginChgPp ?? null, -30, 30),
      fund_fcf_margin: clip(m?.fcfMargin ?? null, -1, 1),
      fund_accrual: clip(m?.accrualRatio ?? null, -1, 1),
      has_fund: m ? 1 : 0,
    });

    const eps = epsSurprise(e.epsActual.value, e.epsEstimate.value, base.close);
    const rev = revenueSurprise(e.revenueActual.value, e.revenueEstimate.value);
    const gap = day0.open / base.close - 1;
    const react0 = day0.close / base.close - 1;
    const spyB = lowerBound(spy, baseDate);
    const spy0 = lowerBound(spy, day0Date);
    const spyReact = spyB < spy.length && spy0 < spy.length && spy[spyB].time === baseDate && spy[spy0].time === day0Date ? spy[spy0].close / spy[spyB].close - 1 : null;
    const abvol0 = abnormalVolume(bars, a.day0);
    const epsBps = clip(eps.priceScaledBps, -300, 300);

    const pre: FeatureVector = {
      hist_n: prior.length,
      hist_mean_react: prior.length >= 2 ? mean(priorAbn) : null,
      hist_abs_react: prior.length >= 2 ? mean(priorAbn.map(Math.abs)) : null,
      hist_beat_rate: prior.length >= 2 ? priorBeats.length / prior.length : null,
      hist_sell_news: priorBeats.length >= 2 ? sellNews : null,
      runup20_rel: clip(relTrailing(bars, spy, a.base, 20), -0.6, 0.6),
      mom60_rel: clip(relTrailing(bars, spy, a.base, 60), -1, 1),
      vol60: sigma,
      spy20: benchTrailing(spy, baseDate, 20),
      sector20_rel: sector ? (() => { const s = benchTrailing(sector, baseDate, 20); const m = benchTrailing(spy, baseDate, 20); return s !== null && m !== null ? s - m : null; })() : null,
      prev_surprise_bps: prev ? clip(prev.features.POST.eps_surprise_bps ?? null, -300, 300) : null,
      ...fund(mPre),
    };
    const post: FeatureVector = {
      ...pre,
      ...fund(mPost),
      eps_surprise_bps: epsBps,
      eps_beat: eps.verdict === 'BEAT' ? 1 : eps.verdict === 'MISS' ? -1 : eps.verdict === 'IN_LINE' ? 0 : null,
      rev_surprise_pct: clip(rev.pct, -0.3, 0.3),
      has_rev_surprise: rev.pct !== null ? 1 : 0,
      react0: clip(react0, -0.5, 0.5),
      react0_abn: spyReact === null ? null : clip(react0 - spyReact, -0.5, 0.5),
      react0_z: sigma ? clip(react0 / sigma, -12, 12) : null,
      react0_x_surprise: epsBps !== null ? Math.sign(epsBps) * clip(react0, -0.5, 0.5)! : null,
      intraday0: day0.open > 0 ? clip(day0.close / day0.open - 1, -0.3, 0.3) : null,
      abvol0: clip(abvol0, 0, 15),
    };

    const labels: EventRow['labels'] = { PRE: {}, POST: {} };
    for (const mode of ['PRE', 'POST'] as Mode[]) {
      for (const h of HORIZONS) {
        const r = labelReturn(bars, a, h, mode);
        const band = flatBand(sigma, h, roundTrip);
        if (r === null || band === null) continue;
        const rb = benchmarkReturn(spy, bars, a, h, mode);
        labels[mode][h] = { ret: r, abnormal: rb === null ? null : r - rb, band, outcome: classify(r, band), endDate: bars[labelSpan(a, h, mode).to].time };
      }
    }

    rows.push({
      id: `${d.company.symbol}:${e.reportDate}`,
      symbol: d.company.symbol,
      sector: d.company.sector,
      reportDate: e.reportDate,
      reportTime: e.reportTime,
      twoSessionWindow: a.twoSessionWindow,
      baseDate,
      day0Date,
      basePrice: base.close,
      day0Open: day0.open,
      day0Close: day0.close,
      sigma,
      capApprox: qPre?.sharesDiluted ? qPre.sharesDiluted * base.close : null,
      marketVol20: (() => { const i = lowerBound(spy, baseDate); return i < spy.length && spy[i].time === baseDate ? dailyVol(spy, i, 20) : null; })(),
      features: { PRE: pre, POST: post },
      labels,
      facts: {
        epsActual: e.epsActual.value,
        epsEstimate: e.epsEstimate.value,
        epsSurprisePct: eps.pct,
        epsVerdict: eps.verdict,
        revenueActual: e.revenueActual.value,
        revenueEstimate: e.revenueEstimate.value,
        revenueSurprisePct: rev.pct,
        gap,
        react0,
        abnormalVolume: abvol0,
      },
    });
  }
  return rows;
}

/** Variables PRE para un reporte FUTURO (decisión al último cierre disponible). */
export function preFeaturesForUpcoming(d: SymbolData, rows: EventRow[], spy: Bar[], sector: Bar[] | null): { features: FeatureVector; baseDate: string; basePrice: number; sigma: number | null } | null {
  const bars = d.bars;
  const end = bars.length - 1;
  if (end < 61) return null;
  const baseDate = bars[end].time;
  const prior = rows.filter((r) => r.labels.PRE[1] && r.labels.PRE[1]!.endDate <= baseDate).slice(-8);
  const priorAbn = prior.map((r) => r.labels.PRE[1]!.abnormal ?? r.labels.PRE[1]!.ret);
  const priorBeats = prior.filter((r) => r.facts.epsVerdict === 'BEAT');
  const q = asOfQuarter(d.quarters, baseDate);
  const m = q ? quarterMetrics(d.quarters, q) : null;
  const sigma = dailyVol(bars, end, 60);
  const s20 = sector ? benchTrailing(sector, baseDate, 20) : null;
  const m20 = benchTrailing(spy, baseDate, 20);
  return {
    baseDate,
    basePrice: bars[end].close,
    sigma,
    features: {
      hist_n: prior.length,
      hist_mean_react: prior.length >= 2 ? mean(priorAbn) : null,
      hist_abs_react: prior.length >= 2 ? mean(priorAbn.map(Math.abs)) : null,
      hist_beat_rate: prior.length >= 2 ? priorBeats.length / prior.length : null,
      hist_sell_news: priorBeats.length >= 2 ? priorBeats.filter((r) => (r.labels.PRE[1]!.abnormal ?? r.labels.PRE[1]!.ret) < 0).length / priorBeats.length : null,
      runup20_rel: clip(relTrailing(bars, spy, end, 20), -0.6, 0.6),
      mom60_rel: clip(relTrailing(bars, spy, end, 60), -1, 1),
      vol60: sigma,
      spy20: m20,
      sector20_rel: s20 !== null && m20 !== null ? s20 - m20 : null,
      prev_surprise_bps: prior.at(-1) ? clip(prior.at(-1)!.features.POST.eps_surprise_bps ?? null, -300, 300) : null,
      fund_rev_yoy: clip(m?.revenueYoY ?? null, -0.8, 2),
      fund_opm_chg: clip(m?.operatingMarginChgPp ?? null, -30, 30),
      fund_fcf_margin: clip(m?.fcfMargin ?? null, -1, 1),
      fund_accrual: clip(m?.accrualRatio ?? null, -1, 1),
      has_fund: m ? 1 : 0,
    },
  };
}
