/**
 * TwelveData — precios diarios OHLCV (mismo proveedor que GBM Weekly Trend).
 * El ajuste por splits/dividendos que aplica el proveedor NO está verificado: se declara así
 * y `analysis/prices.ts` marca saltos sospechosos de split.
 */
import type { Bar, PriceSeries } from '../types';
import { getJson, RateLimiter, redact, type Fetcher } from '../util/http';
import { providerSymbol } from '../universe/normalize';

interface TDValue { datetime: string; open: string; high: string; low: string; close: string; volume?: string }
export interface TDResponse { status?: string; code?: number; message?: string; meta?: { symbol: string; exchange?: string; currency?: string }; values?: TDValue[] }

export type TdStatus = 'OK' | 'RATE_LIMITED' | 'UNAVAILABLE_ON_PLAN' | 'INVALID_SYMBOL' | 'ERROR';

export function parseTwelveData(j: TDResponse, symbol: string, fetchedAt: string): { status: TdStatus; message?: string; series?: PriceSeries } {
  if (j.status === 'error' || !j.values) {
    const msg = j.message ?? 'Respuesta sin datos';
    if (j.code === 429) return { status: 'RATE_LIMITED', message: msg };
    if (/available starting with|upgrad|pricing/i.test(msg) || j.code === 403) return { status: 'UNAVAILABLE_ON_PLAN', message: msg };
    if (j.code === 400 || j.code === 404) return { status: 'INVALID_SYMBOL', message: msg };
    return { status: 'ERROR', message: msg };
  }
  const num = (s?: string) => (s === undefined || s === '' ? NaN : Number(s));
  const bars: Bar[] = j.values
    .map((v) => ({ time: v.datetime.slice(0, 10), open: num(v.open), high: num(v.high), low: num(v.low), close: num(v.close), volume: v.volume ? num(v.volume) : null }))
    .filter((b) => Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.time.localeCompare(b.time));
  return {
    status: 'OK',
    series: {
      symbol,
      bars,
      adjustment: 'PROVIDER_DEFAULT_UNVERIFIED',
      prov: { source: 'TwelveData', url: 'https://twelvedata.com/docs#time-series', publishedAt: bars.at(-1)?.time ?? null, fetchedAt, verification: 'PROVIDER_ACTUAL' },
    },
  };
}

export class TwelveDataClient {
  private readonly limiter: RateLimiter;
  constructor(private readonly apiKey: string, perMinute = 8, private readonly fetcher?: Fetcher) {
    if (!apiKey) throw new Error('Falta TWELVEDATA_API_KEY');
    this.limiter = new RateLimiter(perMinute);
  }
  async daily(symbol: string, outputsize = 5000) {
    const p = new URLSearchParams({ symbol: providerSymbol(symbol, 'twelvedata'), interval: '1day', outputsize: String(outputsize), order: 'ASC', apikey: this.apiKey });
    const url = `https://api.twelvedata.com/time_series?${p}`;
    const fetchedAt = new Date().toISOString();
    const r = await getJson<TDResponse>(url, { limiter: this.limiter, fetcher: this.fetcher, timeoutMs: 60_000 });
    if (!r.data) return { status: 'ERROR' as TdStatus, message: `HTTP ${r.status} ${r.error ?? r.text ?? ''}`, url: redact(url) };
    if (!r.ok && r.data.code === undefined) r.data.code = r.status;
    return { ...parseTwelveData(r.data, symbol, fetchedAt), url: redact(url) };
  }
}
