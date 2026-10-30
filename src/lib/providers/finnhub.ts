/**
 * Finnhub — calendario de resultados con consenso de EPS e INGRESOS de próximos reportes.
 *   GET /calendar/earnings?from&to
 *
 * Como el consenso histórico de ingresos no es gratuito, la app guarda cada día una instantánea
 * (`ConsensusSnapshot`) del consenso vigente para los símbolos del universo. Con el tiempo eso
 * construye una historia PROPIA y punto-en-el-tiempo del consenso de ingresos (y de sus revisiones).
 */
import type { ConsensusSnapshot, EarningsEvent, ReportTime } from '../types';
import { getJson, RateLimiter, redact, type Fetcher } from '../util/http';

export interface FhRow { date?: string; epsActual?: number | null; epsEstimate?: number | null; hour?: string; quarter?: number; revenueActual?: number | null; revenueEstimate?: number | null; symbol?: string; year?: number }
export interface FhCalendar { earningsCalendar?: FhRow[]; error?: string }

export function fhReportTime(h: string | undefined): ReportTime {
  if (h === 'bmo') return 'pre-market';
  if (h === 'amc') return 'post-market';
  if (h === 'dmh') return 'during-market';
  return 'unknown';
}

const n = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export function parseFhCalendar(j: FhCalendar, universe: Set<string>, asOf: string, fetchedAt: string): { snapshots: ConsensusSnapshot[]; events: EarningsEvent[] } {
  const snapshots: ConsensusSnapshot[] = [];
  const events: EarningsEvent[] = [];
  for (const r of j.earningsCalendar ?? []) {
    const sym = r.symbol?.toUpperCase();
    if (!sym || !universe.has(sym) || !r.date) continue;
    const reportTime = fhReportTime(r.hour);
    const past = r.date < asOf;
    // Solo cuenta como instantánea punto-en-el-tiempo si el reporte aún no ocurre.
    if (r.date >= asOf) snapshots.push({
      symbol: sym, asOf, reportDate: r.date, reportTime,
      ...(r.year ? { fiscalYear: r.year } : {}), ...(r.quarter ? { fiscalQuarter: r.quarter } : {}),
      epsEstimate: n(r.epsEstimate), revenueEstimate: n(r.revenueEstimate), source: 'Finnhub',
    });
    const base = { source: 'Finnhub', url: 'https://finnhub.io/docs/api/earnings-calendar', fetchedAt, fiscalPeriod: r.year && r.quarter ? `${r.year}-Q${r.quarter}` : undefined };
    const epsA = n(r.epsActual);
    const revA = n(r.revenueActual);
    events.push({
      symbol: sym,
      fiscalDateEnding: null,
      reportDate: r.date,
      reportTime,
      status: epsA !== null || revA !== null ? 'reported' : 'scheduled',
      epsActual: { value: epsA, prov: { ...base, publishedAt: epsA !== null ? r.date : null, verification: epsA !== null ? 'PROVIDER_ACTUAL' : 'UNAVAILABLE' } },
      epsEstimate: { value: n(r.epsEstimate), prov: { ...base, publishedAt: past ? null : asOf, verification: n(r.epsEstimate) !== null ? 'CONSENSUS' : 'UNAVAILABLE', note: past ? 'Consenso histórico según el proveedor; fecha de corte no publicada.' : `Consenso observado el ${asOf}` } },
      revenueActual: { value: revA, prov: { ...base, publishedAt: revA !== null ? r.date : null, verification: revA !== null ? 'PROVIDER_ACTUAL' : 'UNAVAILABLE' } },
      revenueEstimate: { value: n(r.revenueEstimate), prov: { ...base, publishedAt: past ? null : asOf, verification: n(r.revenueEstimate) !== null ? 'CONSENSUS' : 'UNAVAILABLE', note: past ? 'Consenso histórico según el proveedor; fecha de corte no publicada.' : `Consenso observado el ${asOf}` } },
    });
  }
  return { snapshots, events };
}

export class FinnhubClient {
  private readonly limiter = new RateLimiter(50);
  constructor(private readonly apiKey: string, private readonly fetcher?: Fetcher) {
    if (!apiKey) throw new Error('Falta FINNHUB_API_KEY');
  }
  /**
   * Con `symbol` la respuesta se limita a esa emisora. Sin él, Finnhub corta en ~1,500 filas y se pierden
   * reportes de la ventana (por eso la ingesta consulta por símbolo).
   */
  async calendar(from: string, to: string, symbol?: string) {
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ''}&token=${this.apiKey}`;
    const r = await getJson<FhCalendar>(url, { limiter: this.limiter, fetcher: this.fetcher });
    return { ...r, url: redact(url) };
  }
}
