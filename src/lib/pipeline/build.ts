/**
 * Construye el snapshot: datos → eventos → variables → walk-forward → predicciones → decisiones → alertas.
 * Registra en la bitácora las predicciones nuevas ANTES de conocer su resultado y resuelve las vencidas.
 */
import type { Bar, Company, Horizon, Mode, Prediction, PriceSeries, TradeSignal, UniverseRegistry } from '../types';
import { HORIZONS } from '../types';
import { KEYS, type JsonStore } from '../store';
import { mergeEvents, type MergedEvent } from '../analysis/events';
import { epsSurprise, revenueSurprise } from '../analysis/surprise';
import { quarterMetrics } from '../analysis/fundamentals';
import { suspiciousSplits } from '../analysis/reaction';
import { buildRows, preFeaturesForUpcoming, type EventRow, type SymbolData } from '../model/dataset';
import { predict, train, type TrainedSet } from '../model/engine';
import { runWalkForward, type WalkForwardResult } from '../backtest/walkforward';
import { fitScore, scoreOf, scoreWalkForward } from '../score/earnings-score';
import { avgDollarVolume, decide } from '../decision/engine';
import { appendPredictions, outcomeKnowableAt, readLedger, recordOutcomes, verifyChain, type ResolvedOutcome } from '../ledger';
import { brier } from '../model/logistic';
import { MODEL_VERSION } from '../config';
import { inScope } from '../universe/registry';
import { MARKET_BENCHMARK } from '../universe/seed';
import type { AvRaw, CalendarRaw, EdgarRaw, ProviderStatus } from './ingest';
import { readConsensus } from './ingest';
import { SNAPSHOT_VERSION, type AlertEvent, type BacktestSummary, type CalendarItem, type CompanyView, type EarningsSnapshot, type ReactionRow, type ReportView } from './snapshot-types';
import { mean } from '../util/stats';

export interface Dataset {
  mode: 'live' | 'demo';
  registry: UniverseRegistry;
  symbols: SymbolData[];
  /** Empresas del alcance sin precios (se muestran con su estado, sin predicciones). */
  withoutPrices: Company[];
  spy: Bar[];
  sectors: Record<string, Bar[]>;
  priceSource: Record<string, PriceSeries['prov']>;
  providers: ProviderStatus[];
}

export async function loadDataset(store: JsonStore, registry: UniverseRegistry): Promise<Dataset> {
  const scope = registry.companies.filter(inScope);
  const cal = await store.get<CalendarRaw>(KEYS.raw('finnhub', 'calendar'));
  const snaps = await readConsensus(store);
  const spyS = await store.get<PriceSeries>(KEYS.raw('prices', MARKET_BENCHMARK));
  const sectors: Record<string, Bar[]> = {};
  const priceSource: Dataset['priceSource'] = {};
  for (const etf of new Set(scope.map((c) => c.sectorEtf).filter((x): x is string => !!x))) {
    const s = await store.get<PriceSeries>(KEYS.raw('prices', etf));
    if (s) sectors[etf] = s.bars;
  }
  const symbols: SymbolData[] = [];
  const withoutPrices: Company[] = [];
  for (const c of scope) {
    const [edgar, av, px] = [await store.get<EdgarRaw>(KEYS.raw('edgar', c.symbol)), await store.get<AvRaw>(KEYS.raw('av', c.symbol)), await store.get<PriceSeries>(KEYS.raw('prices', c.symbol))];
    const fhEvents = (cal?.events ?? []).filter((e) => e.symbol === c.symbol);
    const events = mergeEvents(c.symbol, av?.events ?? [], fhEvents, edgar?.releases ?? [], snaps);
    if (!px?.bars.length) {
      withoutPrices.push(c);
      continue;
    }
    priceSource[c.symbol] = px.prov;
    symbols.push({ company: c, bars: px.bars, events, quarters: edgar?.quarters ?? [] });
  }
  return { mode: 'live', registry, symbols, withoutPrices, spy: spyS?.bars ?? [], sectors, priceSource, providers: (await store.get<ProviderStatus[]>('meta/providers')) ?? [] };
}

const sectorBarsFor = (ds: Dataset, c: Company) => (c.sectorEtf ? ds.sectors[c.sectorEtf] ?? null : ds.sectors[c.sector] ?? null);

function reportView(e: MergedEvent, priceBefore: number | null): ReportView {
  const eps = epsSurprise(e.epsActual.value, e.epsEstimate.value, priceBefore);
  const rev = revenueSurprise(e.revenueActual.value, e.revenueEstimate.value);
  return {
    reportDate: e.reportDate, reportTime: e.reportTime, reportTimeSource: e.reportTimeSource, fiscalDateEnding: e.fiscalDateEnding, ...(e.releaseUrl ? { releaseUrl: e.releaseUrl } : {}),
    epsActual: e.epsActual, epsEstimate: e.epsEstimate, revenueActual: e.revenueActual, revenueEstimate: e.revenueEstimate,
    eps: { verdict: eps.verdict, pct: eps.pct, diff: eps.diff, note: eps.note },
    revenue: { verdict: rev.verdict, pct: rev.pct, diff: rev.diff, note: rev.note },
  };
}

/** Siguiente día hábil (lunes a viernes) después de `d`. Si es ≥ la fecha del reporte, esta es la última corrida antes del anuncio. */
export function nextWeekday(d: string): string {
  const x = new Date(`${d}T00:00:00Z`);
  do x.setUTCDate(x.getUTCDate() + 1);
  while (x.getUTCDay() === 0 || x.getUTCDay() === 6);
  return x.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export interface BuildOptions {
  now?: Date;
  roundTrip: number;
  store: JsonStore;
  prev?: EarningsSnapshot | null;
  /** Evita escribir en la bitácora (pruebas de solo lectura). */
  dryRun?: boolean;
  log?: (s: string) => void;
}

export async function buildSnapshot(ds: Dataset, o: BuildOptions): Promise<{ snapshot: EarningsSnapshot; walkForward: WalkForwardResult[]; rows: EventRow[] }> {
  const now = o.now ?? new Date();
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);
  const log = o.log ?? (() => {});
  const warnings: string[] = [];
  if (ds.mode === 'demo') warnings.push('MODO DEMO: todos los datos son SINTÉTICOS. Nada de esta pantalla describe empresas reales.');
  if (!ds.spy.length) warnings.push('Sin serie del S&P 500 (SPY): no hay rendimientos relativos ni predicciones.');

  // 1) Eventos → filas
  const rowsBy = new Map<string, EventRow[]>();
  for (const s of ds.symbols) rowsBy.set(s.company.symbol, ds.spy.length ? buildRows(s, ds.spy, sectorBarsFor(ds, s.company), o.roundTrip) : []);
  const rows = [...rowsBy.values()].flat();
  log(`${rows.length} reportes históricos con precios alineados`);

  // 2) Walk-forward por modo y horizonte → modelos vigentes con habilidad fuera de muestra
  const wf: WalkForwardResult[] = [];
  const live = new Map<string, TrainedSet>();
  const barsBy = new Map(ds.symbols.map((s) => [s.company.symbol, s.bars]));
  for (const mode of ['PRE', 'POST'] as Mode[]) {
    for (const h of HORIZONS) {
      const r = runWalkForward(rows, barsBy, ds.spy, { mode, horizon: h, roundTrip: o.roundTrip, generatedAt: nowIso });
      wf.push(r);
      const set = r.liveSet ?? train(rows, mode, h, '9999-12-31');
      live.set(`${mode}:${h}`, set);
      log(`Walk-forward ${mode} ${h}: n=${r.prob?.n ?? 0} skill=${r.prob?.skill?.toFixed(4) ?? 'n/d'}`);
    }
  }
  const scoreModel = fitScore(rows, '9999-12-31');
  const post5 = wf.find((w) => w.mode === 'POST' && w.horizon === 5);
  const scoreValidation = scoreWalkForward(rows, post5?.folds ?? []);

  // 3) Por empresa
  const companies: CompanyView[] = [];
  const allSignals: TradeSignal[] = [];
  const newPreds: Prediction[] = [];
  const knownAt = new Map<string, string | null>();
  const calendar: CalendarItem[] = [];
  for (const s of ds.symbols) {
    const c = s.company;
    const myRows = rowsBy.get(c.symbol) ?? [];
    const bars = s.bars;
    const last = bars.at(-1)!;
    const lastBarDate = last.time;
    const dataNotes: string[] = [];
    const priceIssues = suspiciousSplits(bars.slice(-750));
    if (priceIssues.length) dataNotes.push('Saltos de precio típicos de split sin ajustar: revisa la serie.');
    if (!s.quarters.length) dataNotes.push(c.coverage === 'US_FOREIGN_FILER' ? 'Emisor extranjero (20-F/6-K): sin cifras trimestrales XBRL en EDGAR.' : 'Sin cifras de EDGAR todavía.');
    const reported = s.events.filter((e) => e.status === 'reported');
    const lastEv = reported.at(-1) ?? null;
    const lastRow = lastEv ? myRows.find((r) => r.reportDate === lastEv.reportDate) ?? null : null;
    const upcomingEv = s.events.find((e) => e.status === 'scheduled' && e.reportDate >= today) ?? null;
    if (!s.events.length) dataNotes.push('Sin eventos de resultados: falta Alpha Vantage o Finnhub para este símbolo.');
    if (!upcomingEv) dataNotes.push('Próximo reporte no confirmado por el calendario.');

    // Reacciones históricas (últimos 8)
    const reactions: ReactionRow[] = myRows.slice(-8).map((r) => ({
      reportDate: r.reportDate,
      reportTime: r.reportTime,
      epsVerdict: r.facts.epsVerdict,
      epsSurprisePct: r.facts.epsSurprisePct,
      revenueSurprisePct: r.facts.revenueSurprisePct,
      react1: r.labels.PRE[1]?.ret ?? null,
      react1Abn: r.labels.PRE[1]?.abnormal ?? null,
      post5Abn: r.labels.POST[5]?.abnormal ?? null,
      post20Abn: r.labels.POST[20]?.abnormal ?? null,
      abnormalVolume: r.facts.abnormalVolume,
      fellDespiteBeat: r.facts.epsVerdict === 'BEAT' && (r.labels.PRE[1]?.abnormal ?? r.labels.PRE[1]?.ret ?? 0) < 0,
      preVol: r.sigma,
    }));
    const rx = reactions.filter((r) => r.react1 !== null);
    const reactionSummary = rx.length
      ? { n: rx.length, meanAbsMove: mean(rx.map((r) => Math.abs(r.react1!))), beatRate: rx.filter((r) => r.epsVerdict === 'BEAT').length / rx.length, fellDespiteBeat: rx.filter((r) => r.fellDespiteBeat).length, upAfterMiss: rx.filter((r) => r.epsVerdict === 'MISS' && (r.react1Abn ?? r.react1!) > 0).length }
      : null;

    // Trimestres oficiales (últimos 8)
    const quarters = s.quarters.slice(-8).map((q) => quarterMetrics(s.quarters, q));

    const predictions: Prediction[] = [];
    const signals: TradeSignal[] = [];
    let score = null as CompanyView['score'];
    let scoreMode: Mode | null = null;
    const dv = avgDollarVolume(bars);

    // POST: el reporte acaba de reaccionar (día 0 = última vela) o lo hizo en las últimas 20 sesiones.
    if (lastRow && lastEv) {
      const idx0 = bars.findIndex((b) => b.time === lastRow.day0Date);
      const sessionsSince = idx0 >= 0 ? bars.length - 1 - idx0 : Infinity;
      if (sessionsSince <= 20) {
        scoreMode = 'POST';
        score = scoreOf(fitScore(rows, lastRow.day0Date), lastRow.features.POST, 'POST');
        for (const h of HORIZONS) {
          const ls = live.get(`POST:${h}`)!;
          // Punto en el tiempo: modelo entrenado solo con etiquetas terminadas antes del día 0.
          const set = sessionsSince === 0 ? ls : { ...train(rows, 'POST', h, lastRow.day0Date), oosSkill: ls.oosSkill, oosN: ls.oosN };
          const p = predict(set, { symbol: c.symbol, reportDate: lastRow.reportDate, decisionDate: lastRow.day0Date, features: lastRow.features.POST, basePrice: lastRow.day0Close, sigma: lastRow.sigma, roundTrip: o.roundTrip, createdAt: nowIso, missingCritical: lastRow.features.POST.eps_surprise_bps === null });
          predictions.push(p);
          if (sessionsSince === 0) {
            newPreds.push(p);
            // Si los precios están atrasados, la sesión siguiente al día 0 puede haber cerrado ya: se rechaza.
            knownAt.set(p.id, outcomeKnowableAt(p));
          }
          signals.push(decide({ company: c, prediction: p, reportTime: lastEv.reportTime, basePrice: lastRow.day0Close, baseTime: lastRow.day0Date, sigma: lastRow.sigma, avgDollarVolume20: dv, typicalMove: lastRow.features.PRE.hist_abs_react, roundTrip: o.roundTrip, oosSkill: set.oosSkill }));
        }
      }
    }
    // PRE: próximo reporte en los siguientes 30 días.
    if (upcomingEv && daysBetween(today, upcomingEv.reportDate) <= 30) {
      const f = preFeaturesForUpcoming(s, myRows, ds.spy, sectorBarsFor(ds, c));
      if (f) {
        if (!score) {
          scoreMode = 'PRE';
          score = scoreOf(scoreModel, f.features, 'PRE');
        }
        for (const h of HORIZONS) {
          const set = live.get(`PRE:${h}`)!;
          const p = predict(set, { symbol: c.symbol, reportDate: upcomingEv.reportDate, decisionDate: f.baseDate, features: f.features, basePrice: f.basePrice, sigma: f.sigma, roundTrip: o.roundTrip, createdAt: nowIso });
          predictions.push(p);
          // A la bitácora solo la última predicción antes del anuncio (la corrida de la víspera).
          if (nextWeekday(lastBarDate) >= upcomingEv.reportDate) {
            newPreds.push(p);
            knownAt.set(p.id, outcomeKnowableAt(p, upcomingEv.reportTime));
          }
          signals.push(decide({ company: c, prediction: p, reportTime: upcomingEv.reportTime, basePrice: f.basePrice, baseTime: f.baseDate, sigma: f.sigma, avgDollarVolume20: dv, typicalMove: f.features.hist_abs_react, roundTrip: o.roundTrip, oosSkill: set.oosSkill }));
        }
      }
    }
    allSignals.push(...signals);

    for (const e of s.events.filter((x) => x.reportDate >= new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10))) {
      calendar.push({
        symbol: c.symbol, name: c.name, reportDate: e.reportDate, reportTime: e.reportTime, reportTimeSource: e.reportTimeSource, status: e.status,
        daysTo: daysBetween(today, e.reportDate), epsEstimate: e.epsEstimate.value, revenueEstimate: e.revenueEstimate.value, epsActual: e.epsActual.value, revenueActual: e.revenueActual.value,
        impliedMove: null, dataComplete: e.epsEstimate.value !== null && e.revenueEstimate.value !== null && e.reportTime !== 'unknown', sources: e.sources,
      });
    }

    const baseForLast = lastRow?.basePrice ?? null;
    companies.push({
      company: c,
      lastPrice: { close: last.close, date: last.time, source: ds.priceSource[c.symbol]?.source ?? (ds.mode === 'demo' ? 'DEMO (sintético)' : 'n/d') },
      priceIssues,
      lastReport: lastEv ? reportView(lastEv, baseForLast) : null,
      upcoming: upcomingEv ? { ...reportView(upcomingEv, null), daysTo: daysBetween(today, upcomingEv.reportDate) } : null,
      quarters,
      reactions,
      reactionSummary,
      predictions,
      score,
      scoreMode,
      signals,
      dataNotes,
      guidance: { available: false, note: 'El guidance no tiene fuente gratuita estructurada. Revisa el comunicado (enlace del 8-K) mientras se agrega la lectura automática.' },
      news: { available: false, note: 'Noticias por empresa: el hub ya ingiere fuentes oficiales (SEC, Fed, BLS). Integración por empresa pendiente.' },
    });
  }
  for (const c of ds.withoutPrices) {
    companies.push({ company: c, lastPrice: null, priceIssues: [], lastReport: null, upcoming: null, quarters: [], reactions: [], reactionSummary: null, predictions: [], score: null, scoreMode: null, signals: [], dataNotes: ['Sin precios: no se puede analizar la reacción ni predecir.'], guidance: { available: false, note: '' }, news: { available: false, note: '' } });
  }

  // 4) Bitácora: registrar antes del resultado y resolver vencidas.
  let ledgerInfo = { added: 0, skippedExisting: 0, rejectedLate: [] as string[] };
  if (!o.dryRun && newPreds.length) {
    ledgerInfo = await appendPredictions(o.store, newPreds.filter((p) => p.probs), { now: nowIso, labelKnownAt: (p) => knownAt.get(p.id) ?? null });
    if (ledgerInfo.rejectedLate.length) warnings.push(`${ledgerInfo.rejectedLate.length} predicciones no se registraron porque su resultado ya se conocía.`);
  }
  const ledger = await readLedger(o.store);
  const rowById = new Map(rows.map((r) => [`${r.symbol}:${r.reportDate}`, r]));
  const outcomes: ResolvedOutcome[] = [];
  for (const e of ledger) {
    const p = e.prediction;
    const r = rowById.get(`${p.symbol}:${p.reportDate}`);
    const l = r?.labels[p.mode][p.horizon as Horizon];
    if (l) outcomes.push({ id: p.id, resolvedAt: nowIso, endDate: l.endDate, ret: l.ret, outcome: l.outcome });
  }
  if (!o.dryRun && outcomes.length) await recordOutcomes(o.store, outcomes);
  const outBy = new Map(outcomes.map((x) => [x.id, x]));
  // Registros hechos cuando el resultado ya era conocible (p. ej. con precios atrasados): se conservan en la
  // bitácora (nunca se reescribe), pero NO cuentan en el historial en vivo.
  const late = (e: (typeof ledger)[number]) => e.recordedAt >= outcomeKnowableAt(e.prediction);
  const excludedLate = ledger.filter((e) => outBy.has(e.prediction.id) && e.prediction.probs && late(e)).length;
  const resolved = ledger.filter((e) => outBy.has(e.prediction.id) && e.prediction.probs && !late(e));
  const argmax = (p: Prediction) => (p.probs!.up >= p.probs!.down && p.probs!.up >= p.probs!.flat ? 'UP' : p.probs!.down >= p.probs!.flat ? 'DOWN' : 'FLAT');
  const hit = (e: (typeof ledger)[number]) => argmax(e.prediction) === outBy.get(e.prediction.id)!.outcome;
  const confs = ['ALTA', 'MEDIA', 'BAJA'];

  // 5) Alertas candidatas (el hub decide cuáles envía y deduplica)
  const alerts: AlertEvent[] = [];
  for (const cv of companies) {
    const c = cv.company;
    const pre = cv.predictions.find((p) => p.mode === 'PRE' && p.horizon === 5);
    // Reporte en las próximas dos sesiones hábiles.
    if (cv.upcoming && cv.upcoming.reportDate >= today && cv.upcoming.reportDate <= nextWeekday(nextWeekday(today))) {
      alerts.push({
        id: `upcoming:${c.symbol}:${cv.upcoming.reportDate}`, kind: 'UPCOMING', symbol: c.symbol, priority: 'normal', at: nowIso,
        title: `Reporte próximo — ${c.symbol} (${cv.upcoming.reportDate}, ${cv.upcoming.reportTime})`,
        lines: [
          'Tipo: PREDICCIÓN PREVIA AL ANUNCIO (aún no hay resultados).',
          `EPS esperado: ${fmt(cv.upcoming.epsEstimate.value)} · Ingresos esperados: ${fmtBig(cv.upcoming.revenueEstimate.value)}`,
          pre?.probs ? `5 sesiones: subida ${pct(pre.probs.up)} · bajada ${pct(pre.probs.down)} · lateral ${pct(pre.probs.flat)} · confianza ${pre.confidence}` : 'Probabilidades: evidencia insuficiente.',
          cv.reactionSummary?.meanAbsMove != null ? `Movimiento típico en reportes previos: ±${pct(cv.reactionSummary.meanAbsMove)}` : '',
          `Decisión: ${cv.signals.find((x) => x.mode === 'PRE' && x.horizon === 5)?.verdict ?? 'ESPERAR'}`,
        ].filter(Boolean),
      });
    }
    const lr = cv.lastReport;
    const post5 = cv.predictions.find((p) => p.mode === 'POST' && p.horizon === 5);
    const row = lr ? rowsBy.get(c.symbol)?.find((r) => r.reportDate === lr.reportDate) : undefined;
    if (lr && row && row.day0Date === ds.symbols.find((x) => x.company.symbol === c.symbol)?.bars.at(-1)?.time) {
      const sig = cv.signals.find((x) => x.mode === 'POST' && x.horizon === 5);
      const significant = (lr.eps.pct !== null && Math.abs(lr.eps.pct) >= 0.1) || (lr.revenue.pct !== null && Math.abs(lr.revenue.pct) >= 0.03);
      alerts.push({
        id: `reported:${c.symbol}:${lr.reportDate}`, kind: 'REPORTED', symbol: c.symbol, priority: significant ? 'high' : 'normal', at: nowIso,
        title: `EARNINGS INTELLIGENCE — ${c.symbol}`,
        lines: [
          'Evento: resultados trimestrales PUBLICADOS.',
          `Ingresos: ${fmtBig(lr.revenueActual.value)} vs. consenso ${fmtBig(lr.revenueEstimate.value)}${lr.revenue.pct !== null ? ` (${signed(lr.revenue.pct)})` : ''}`,
          `EPS: ${fmt(lr.epsActual.value)} vs. consenso ${fmt(lr.epsEstimate.value)}${lr.eps.pct !== null ? ` (${signed(lr.eps.pct)})` : ''} — ${lr.eps.verdict}`,
          'Guidance: no disponible automáticamente (revisa el comunicado).',
          `Reacción del día: ${signed(row.facts.react0)}`,
          post5?.probs ? `Probabilidad a 5 sesiones: subida ${pct(post5.probs.up)} · bajada ${pct(post5.probs.down)} · lateral ${pct(post5.probs.flat)}` : 'Probabilidades: evidencia insuficiente.',
          post5?.factors.length ? `Factores: ${post5.factors.slice(0, 3).map((f) => `${f.label} (${f.contribution > 0 ? '+' : '−'})`).join(', ')}` : '',
          `Decisión del sistema: ${sig?.verdict ?? 'ESPERAR'} · Confianza: ${post5?.confidence ?? 'EVIDENCIA_INSUFICIENTE'}`,
          lr.releaseUrl ? `Fuente: ${lr.releaseUrl}` : `Fuentes: ${lr.epsActual.prov.source}`,
        ].filter(Boolean),
      });
      if (row.sigma && Math.abs(row.facts.react0 / row.sigma) > 4) {
        alerts.push({ id: `risk:${c.symbol}:${lr.reportDate}`, kind: 'RISK', symbol: c.symbol, priority: 'high', at: nowIso, title: `Movimiento extraordinario — ${c.symbol}`, lines: [`Reacción de ${signed(row.facts.react0)} (${(row.facts.react0 / row.sigma).toFixed(1)} desviaciones estándar).`] });
      }
    }
    // Cambio material de probabilidad (PRE 5) contra el snapshot anterior
    const prevC = o.prev?.companies.find((x) => x.company.symbol === c.symbol);
    const prevPre = prevC?.predictions.find((p) => p.mode === 'PRE' && p.horizon === 5 && p.reportDate === pre?.reportDate);
    if (pre?.probs && prevPre?.probs && Math.abs(pre.probs.up - prevPre.probs.up) >= 0.15) {
      alerts.push({ id: `probchg:${c.symbol}:${pre.reportDate}:${today}`, kind: 'PROB_CHANGE', symbol: c.symbol, priority: 'normal', at: nowIso, title: `Cambio de probabilidad — ${c.symbol}`, lines: [`Subida a 5 sesiones: ${pct(prevPre.probs.up)} → ${pct(pre.probs.up)}.`] });
    }
    // Tesis confirmada o invalidada de señales ALCISTA del snapshot anterior
    for (const ps of prevC?.signals.filter((x) => x.verdict === 'ALCISTA' && x.stop && x.target) ?? []) {
      const px = cv.lastPrice?.close;
      if (!px) continue;
      if (px <= ps.stop!) alerts.push({ id: `thesis:${c.symbol}:${ps.reportDate}:${ps.mode}:${ps.horizon}:invalid`, kind: 'THESIS', symbol: c.symbol, priority: 'high', at: nowIso, title: `Tesis invalidada — ${c.symbol}`, lines: [`Cierre ${px.toFixed(2)} ≤ stop ${ps.stop!.toFixed(2)} (${ps.mode} ${ps.horizon} sesiones).`] });
      else if (px >= ps.target!) alerts.push({ id: `thesis:${c.symbol}:${ps.reportDate}:${ps.mode}:${ps.horizon}:target`, kind: 'THESIS', symbol: c.symbol, priority: 'normal', at: nowIso, title: `Objetivo alcanzado — ${c.symbol}`, lines: [`Cierre ${px.toFixed(2)} ≥ objetivo ${ps.target!.toFixed(2)}.`] });
    }
  }
  for (const p of ds.providers.filter((x) => x.status === 'ERROR')) {
    alerts.push({ id: `data:${p.provider}:${today}`, kind: 'DATA', symbol: null, priority: 'high', at: nowIso, title: `Falla de datos — ${p.provider}`, lines: [p.detail.slice(0, 300)] });
  }
  const staleSyms = ds.symbols.filter((s) => daysBetween(s.bars.at(-1)!.time, today) > 5).map((s) => s.company.symbol);
  if (ds.mode === 'live' && staleSyms.length) alerts.push({ id: `data:stale:${today}`, kind: 'DATA', symbol: null, priority: 'normal', at: nowIso, title: 'Precios desactualizados', lines: [`Más de 5 días sin vela nueva: ${staleSyms.slice(0, 15).join(', ')}`] });

  // 6) Resumen del backtest
  const backtests: BacktestSummary[] = wf.map((r) => ({
    mode: r.mode, horizon: r.horizon, testStart: r.testStart, testEnd: r.testEnd, folds: r.folds.length, prob: r.prob,
    strategies: r.strategies.map(({ equity: _e, ...rest }) => rest),
    equity: Object.fromEntries(r.strategies.filter((s) => s.equity.length).map((s) => [s.name, s.equity])),
    bySector: r.bySector, byCap: r.byCap, byVolRegime: r.byVolRegime, warnings: r.warnings,
  }));

  const coverage: Record<string, number> = {};
  for (const c of ds.registry.companies) coverage[c.coverage] = (coverage[c.coverage] ?? 0) + 1;
  const signals = allSignals.sort((a, b) => b.quality - a.quality);
  const snapshot: EarningsSnapshot = {
    version: SNAPSHOT_VERSION,
    generatedAt: nowIso,
    dataMode: ds.mode,
    modelVersion: MODEL_VERSION,
    roundTrip: o.roundTrip,
    universe: { total: ds.registry.companies.length, inScope: ds.registry.companies.filter(inScope).length, coverage, sources: ds.registry.sources.map(({ origin, status, detail, count }) => ({ origin, status, detail, count })) },
    providers: ds.providers,
    calendar: calendar.sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.symbol.localeCompare(b.symbol)),
    companies: companies.sort((a, b) => a.company.symbol.localeCompare(b.company.symbol)),
    signals,
    backtests,
    scoreValidation,
    live: {
      predictions: ledger.length,
      resolved: resolved.length,
      hitRate: resolved.length ? resolved.filter(hit).length / resolved.length : null,
      brier: resolved.length ? mean(resolved.map((e) => brier(e.prediction.probs!, outBy.get(e.prediction.id)!.outcome))) : null,
      chainOk: verifyChain(ledger).ok,
      excludedLate,
      byConfidence: confs.map((cf) => {
        const xs = resolved.filter((e) => e.prediction.confidence === cf);
        return { confidence: cf, n: xs.length, hitRate: xs.length ? xs.filter(hit).length / xs.length : null };
      }),
    },
    alerts,
    warnings,
  };
  log(`Bitácora: +${ledgerInfo.added} predicciones${ledgerInfo.rejectedLate.length ? `, ${ledgerInfo.rejectedLate.length} rechazadas (su resultado ya era conocible)` : ''}; ${resolved.length} resueltas válidas${excludedLate ? `, ${excludedLate} excluidas del historial por registro tardío` : ''}`);
  return { snapshot, walkForward: wf, rows };
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const signed = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const fmt = (x: number | null) => (x === null ? 'n/d' : x.toFixed(2));
const fmtBig = (x: number | null) => (x === null ? 'n/d' : x >= 1e9 ? `${(x / 1e9).toFixed(2)} mil M` : x >= 1e6 ? `${(x / 1e6).toFixed(1)} M` : x.toFixed(0));
