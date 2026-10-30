/**
 * Alpha Vantage — consenso HISTÓRICO de EPS (plan gratuito).
 *   EARNINGS          → por trimestre: fecha de reporte, EPS reportado, EPS estimado, sorpresa, hora del reporte.
 *   EARNINGS_CALENDAR → próximos reportes (CSV) con EPS estimado.
 *
 * Advertencias que se muestran en la app:
 *   - El EPS "reportado" del proveedor suele ser AJUSTADO (no GAAP). Se compara contra su propio estimado,
 *     que está en la misma base; nunca contra el EPS GAAP de EDGAR.
 *   - No se publica en qué fecha se tomó el estimado: se asume que es el consenso vigente justo antes
 *     del anuncio (lo habitual), pero queda marcado como no verificado.
 *   - Plan gratuito: ~25 peticiones/día (verifícalo en tu cuenta). El presupuesto lo controla `budget.ts`.
 */
import type { EarningsEvent, ReportTime } from '../types';
import { getJson, RateLimiter, redact, type Fetcher } from '../util/http';
import { providerSymbol } from '../universe/normalize';

interface AvQuarter { fiscalDateEnding?: string; reportedDate?: string; reportedEPS?: string; estimatedEPS?: string; surprise?: string; surprisePercentage?: string; reportTime?: string }
export interface AvEarnings { symbol?: string; quarterlyEarnings?: AvQuarter[]; Information?: string; Note?: string; 'Error Message'?: string }

const num = (s: string | undefined): number | null => {
  if (s === undefined || s === null || s === '' || s === 'None' || s === '-') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

export function avReportTime(s: string | undefined): ReportTime {
  if (!s) return 'unknown';
  if (/pre/i.test(s)) return 'pre-market';
  if (/post|after/i.test(s)) return 'post-market';
  return 'unknown';
}

/** BURST = pediste más de 1 por segundo (se espera y se reintenta). RATE_LIMITED = cuota del día agotada. */
export type AvStatus = 'OK' | 'BURST' | 'RATE_LIMITED' | 'INVALID_SYMBOL' | 'ERROR';

export function avStatus(j: AvEarnings | null): { status: AvStatus; message?: string } {
  if (!j) return { status: 'ERROR', message: 'Respuesta vacía o no JSON' };
  const info = j.Information ?? j.Note;
  if (info) {
    // "Please consider spreading out your free API requests more sparingly (1 request per second)" ≠ cuota diaria.
    if (/per second|spreading out|sparingly/i.test(info) && !/per day|daily/i.test(info)) return { status: 'BURST', message: info };
    return { status: 'RATE_LIMITED', message: info };
  }
  if (j['Error Message']) return { status: 'INVALID_SYMBOL', message: j['Error Message'] };
  if (!Array.isArray(j.quarterlyEarnings)) return { status: 'ERROR', message: 'Sin quarterlyEarnings' };
  return { status: 'OK' };
}

/** Pura (se prueba con fixture). Solo devuelve reportes ya publicados con fecha válida. */
export function parseAvEarnings(j: AvEarnings, symbol: string, fetchedAt: string): EarningsEvent[] {
  const out: EarningsEvent[] = [];
  for (const q of j.quarterlyEarnings ?? []) {
    if (!q.reportedDate || !/^\d{4}-\d{2}-\d{2}$/.test(q.reportedDate)) continue;
    const actual = num(q.reportedEPS);
    const estimate = num(q.estimatedEPS);
    const base = { source: 'Alpha Vantage', url: `https://www.alphavantage.co/query?function=EARNINGS&symbol=${providerSymbol(symbol, 'alphavantage')}`, fetchedAt, fiscalPeriod: q.fiscalDateEnding };
    out.push({
      symbol,
      fiscalDateEnding: q.fiscalDateEnding ?? null,
      reportDate: q.reportedDate,
      reportTime: avReportTime(q.reportTime),
      status: actual === null ? 'scheduled' : 'reported',
      epsActual: { value: actual, prov: { ...base, publishedAt: q.reportedDate, verification: actual === null ? 'UNAVAILABLE' : 'PROVIDER_ACTUAL', note: 'EPS según el proveedor (normalmente ajustado, no GAAP).' } },
      epsEstimate: { value: estimate, prov: { ...base, publishedAt: null, verification: estimate === null ? 'UNAVAILABLE' : 'CONSENSUS', note: 'Consenso según el proveedor; fecha de corte del estimado no publicada.' } },
      revenueActual: { value: null, prov: { ...base, publishedAt: null, verification: 'UNAVAILABLE', note: 'Alpha Vantage gratuito no trae ingresos por reporte.' } },
      revenueEstimate: { value: null, prov: { ...base, publishedAt: null, verification: 'UNAVAILABLE', note: 'Sin consenso histórico de ingresos en el plan gratuito.' } },
    });
  }
  return out.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

export class AlphaVantageClient {
  private readonly limiter: RateLimiter;
  /**
   * El plan gratuito exige ≤ 1 petición por segundo además de la cuota diaria. Una ventana de 60 s con
   * N permitidas deja pasar N seguidas, así que se usa una ventana corta: 1 petición cada `minGapMs`.
   */
  constructor(
    private readonly apiKey: string,
    perMinute = 5,
    private readonly fetcher?: Fetcher,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly burstWaitMs = 15_000,
  ) {
    if (!apiKey) throw new Error('Falta ALPHAVANTAGE_API_KEY');
    const minGapMs = Math.max(1500, Math.ceil(60_000 / Math.max(1, perMinute)));
    this.limiter = new RateLimiter(1, minGapMs);
  }
  /** Una consulta lógica; ante BURST espera y reintenta (hasta 2 veces). `calls` = peticiones reales hechas. */
  async earnings(symbol: string): Promise<{ status: AvStatus; message?: string; data: AvEarnings | null; url: string; calls: number }> {
    const url = `https://www.alphavantage.co/query?function=EARNINGS&symbol=${encodeURIComponent(providerSymbol(symbol, 'alphavantage'))}&apikey=${this.apiKey}`;
    let calls = 0;
    for (let attempt = 0; ; attempt++) {
      const r = await getJson<AvEarnings>(url, { limiter: this.limiter, fetcher: this.fetcher, retries: 1 });
      calls++;
      const s = r.ok ? avStatus(r.data) : { status: 'ERROR' as const, message: `HTTP ${r.status} ${r.error ?? ''}` };
      if (s.status === 'BURST' && attempt < 2) {
        await this.sleep(this.burstWaitMs);
        continue;
      }
      return { ...s, data: r.data, url: redact(url), calls };
    }
  }
}
