/**
 * Fusión de eventos de resultados de varias fuentes en un solo registro por reporte.
 *  - Alpha Vantage: historia larga de EPS real vs. consenso.
 *  - Finnhub: próximos reportes y consenso de ingresos (instantáneas diarias propias).
 *  - EDGAR 8-K Item 2.02: fecha y hora OFICIAL del comunicado.
 */
import type { ConsensusSnapshot, EarningsEvent, ReportTime, Sourced } from '../types';
import type { EarningsRelease } from '../providers/edgar';

const DAY = 86_400_000;
const near = (a: string, b: string, d: number) => Math.abs(Date.parse(a) - Date.parse(b)) <= d * DAY;

export interface MergedEvent extends EarningsEvent {
  reportTimeSource: string;
  releaseUrl?: string;
  /** Consenso de ingresos/EPS observado por nosotros antes del anuncio (punto en el tiempo verificado). */
  pitConsensus?: { asOf: string; epsEstimate: number | null; revenueEstimate: number | null; revisionsEps30d: number | null };
  sources: string[];
}

function pick<T>(...xs: Sourced<T>[]): Sourced<T> {
  return xs.find((x) => x.value !== null) ?? xs[0];
}

/** Resuelve la hora del reporte: la del 8-K manda salvo que caiga en horario de mercado (el 8-K a veces se presenta horas después del comunicado). */
export function resolveReportTime(provider: ReportTime, edgar: EarningsRelease | undefined): { time: ReportTime; source: string } {
  if (edgar && edgar.reportTime !== 'during-market') return { time: edgar.reportTime, source: 'SEC 8-K (hora de aceptación)' };
  if (provider !== 'unknown') return { time: provider, source: edgar ? 'Proveedor (el 8-K se presentó en horario de mercado)' : 'Proveedor' };
  if (edgar) return { time: 'during-market', source: 'SEC 8-K (hora de aceptación, en horario de mercado)' };
  return { time: 'unknown', source: 'Sin hora: se usa una ventana de dos sesiones' };
}

/** Última instantánea de consenso estrictamente anterior al día del anuncio, y revisión de EPS en 30 días. */
export function pitConsensusFor(snaps: ConsensusSnapshot[], symbol: string, reportDate: string): MergedEvent['pitConsensus'] | undefined {
  const mine = snaps.filter((s) => s.symbol === symbol && near(s.reportDate, reportDate, 5) && s.asOf < reportDate).sort((a, b) => a.asOf.localeCompare(b.asOf));
  const last = mine.at(-1);
  if (!last) return undefined;
  const cutoff = new Date(Date.parse(last.asOf) - 30 * DAY).toISOString().slice(0, 10);
  const old = mine.filter((s) => s.asOf <= cutoff).at(-1) ?? mine[0];
  const rev = last.epsEstimate !== null && old.epsEstimate !== null && old !== last ? last.epsEstimate - old.epsEstimate : null;
  return { asOf: last.asOf, epsEstimate: last.epsEstimate, revenueEstimate: last.revenueEstimate, revisionsEps30d: rev };
}

export function mergeEvents(symbol: string, av: EarningsEvent[], fh: EarningsEvent[], releases: EarningsRelease[], snaps: ConsensusSnapshot[]): MergedEvent[] {
  const out: MergedEvent[] = [];
  const usedFh = new Set<EarningsEvent>();
  for (const a of av) {
    const f = fh.find((x) => !usedFh.has(x) && near(x.reportDate, a.reportDate, 3));
    if (f) usedFh.add(f);
    out.push(build(a, f));
  }
  for (const f of fh) if (!usedFh.has(f)) out.push(build(f, undefined));
  return out.sort((x, y) => x.reportDate.localeCompare(y.reportDate));

  function build(main: EarningsEvent, other: EarningsEvent | undefined): MergedEvent {
    // Solo un 8-K del MISMO día define la hora: uno del día siguiente puede ser un comunicado nocturno presentado tarde.
    const rel = releases.find((r) => r.date === main.reportDate);
    const reportDate = main.reportDate;
    const providerTime = main.reportTime !== 'unknown' ? main.reportTime : other?.reportTime ?? 'unknown';
    const rt = resolveReportTime(providerTime, rel);
    const pit = pitConsensusFor(snaps, symbol, reportDate);
    const revenueEstimate: Sourced<number> = pit?.revenueEstimate != null
      ? { value: pit.revenueEstimate, prov: { source: 'Finnhub (instantánea propia)', publishedAt: pit.asOf, fetchedAt: pit.asOf, verification: 'CONSENSUS', note: `Consenso vigente el ${pit.asOf}, antes del anuncio` } }
      : pick(main.revenueEstimate, other?.revenueEstimate ?? main.revenueEstimate);
    const epsActual = pick(main.epsActual, other?.epsActual ?? main.epsActual);
    const revenueActual = pick(main.revenueActual, other?.revenueActual ?? main.revenueActual);
    return {
      symbol,
      fiscalDateEnding: main.fiscalDateEnding ?? other?.fiscalDateEnding ?? null,
      reportDate,
      reportTime: rt.time,
      reportTimeSource: rt.source,
      ...(rel ? { releaseUrl: rel.url } : {}),
      status: epsActual.value !== null || revenueActual.value !== null ? 'reported' : main.status,
      epsActual,
      // El EPS real de AV se compara contra el estimado de AV (misma base). Solo si falta, se usa el de Finnhub.
      epsEstimate: pick(main.epsEstimate, other?.epsEstimate ?? main.epsEstimate),
      revenueActual,
      revenueEstimate,
      ...(pit ? { pitConsensus: pit } : {}),
      sources: [...new Set([main.epsActual.prov.source, other?.epsActual.prov.source, rel ? 'SEC EDGAR 8-K' : undefined].filter((x): x is string => !!x))],
    };
  }
}
