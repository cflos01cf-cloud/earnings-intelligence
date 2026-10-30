/** Problemas encontrados en la primera corrida con datos reales (2026-10-30). */
import { describe, expect, it } from 'vitest';
import { AlphaVantageClient, avStatus } from '@/lib/providers/alphavantage';
import { parseFhCalendar } from '@/lib/providers/finnhub';
import { formerCikCandidates, mergeCompanyFacts, parseCompanyFacts, sameEntity, type CompanyFacts } from '@/lib/providers/edgar';
import { ingest } from '@/lib/pipeline/ingest';
import { memoryStore, KEYS } from '@/lib/store';
import { buildRegistry, inScope, seedCandidates } from '@/lib/universe/registry';
import { FinnhubClient } from '@/lib/providers/finnhub';
import type { CalendarRaw } from '@/lib/pipeline/ingest';

const BURST = 'Thank you for using Alpha Vantage! Please consider spreading out your free API requests more sparingly (1 request per second).';
const DAILY = 'We have detected your API key as ... standard API rate limit is 25 requests per day.';

describe('Alpha Vantage: límite por segundo ≠ cuota diaria', () => {
  it('clasifica los dos mensajes', () => {
    expect(avStatus({ Information: BURST }).status).toBe('BURST');
    expect(avStatus({ Information: DAILY }).status).toBe('RATE_LIMITED');
  });
  it('ante BURST espera y reintenta, y cuenta las peticiones reales', async () => {
    let n = 0;
    const fetcher = async () => new Response(JSON.stringify(++n === 1 ? { Information: BURST } : { quarterlyEarnings: [] }));
    const waits: number[] = [];
    const av = new AlphaVantageClient('k', 1000, fetcher as typeof fetch, async (ms) => void waits.push(ms), 10);
    const r = await av.earnings('AAPL');
    expect(r).toMatchObject({ status: 'OK', calls: 2 });
    expect(waits).toEqual([10]);
  }, 20_000);
  it('la ingesta no da por agotado el día por un BURST', async () => {
    const store = memoryStore();
    const { registry } = buildRegistry(seedCandidates().slice(0, 3), null, []);
    let n = 0;
    const fetcher = async () => new Response(JSON.stringify(++n === 2 ? { Information: BURST } : { quarterlyEarnings: [{ reportedDate: '2026-07-30', reportedEPS: '1', estimatedEPS: '0.9' }] }));
    const av = new AlphaVantageClient('k', 1000, fetcher as typeof fetch, async () => {}, 0);
    const { statuses } = await ingest(registry, registry.companies.filter(inScope), { store, env: {}, clients: { av, edgar: null, fh: null, td: null }, now: new Date('2026-10-30T02:00:00Z') });
    expect(statuses.find((s) => s.provider === 'Alpha Vantage')!.status).toBe('OK');
    expect((await store.get<{ alphavantage: number }>(KEYS.budget))!.alphavantage).toBe(4);
  }, 30_000);
});

describe('Finnhub: consulta por símbolo', () => {
  it('pide cada símbolo con su parámetro y conserva reportes recientes', async () => {
    const urls: string[] = [];
    const fetcher = async (u: string) => {
      urls.push(u);
      const sym = new URL(u).searchParams.get('symbol');
      return new Response(JSON.stringify({ earningsCalendar: [{ symbol: sym, date: '2026-10-28', epsActual: 4, epsEstimate: 3.8, hour: 'amc' }, { symbol: sym, date: '2027-01-27', epsEstimate: 4.1, hour: 'amc' }] }));
    };
    const store = memoryStore();
    const { registry } = buildRegistry(seedCandidates().slice(0, 4), null, []);
    const fh = new FinnhubClient('k', fetcher as typeof fetch);
    const { statuses } = await ingest(registry, registry.companies.filter(inScope), { store, env: {}, clients: { fh, av: null, edgar: null, td: null }, now: new Date('2026-10-30T02:00:00Z') });
    expect(urls).toHaveLength(4);
    expect(urls.every((u) => /[?&]symbol=/.test(u))).toBe(true);
    const cal = (await store.get<CalendarRaw>(KEYS.raw('finnhub', 'calendar')))!;
    expect(cal.events.filter((e) => e.status === 'reported')).toHaveLength(4);
    // Solo los reportes futuros cuentan como instantánea punto-en-el-tiempo del consenso.
    expect((await store.get<unknown[]>(KEYS.consensus('2026-10-30')))!).toHaveLength(4);
    expect(statuses.find((s) => s.provider === 'Finnhub')!.status).toBe('OK');
  });
  it('consenso de un reporte ya publicado no se etiqueta como observado hoy', () => {
    const r = parseFhCalendar({ earningsCalendar: [{ symbol: 'MSFT', date: '2026-10-28', epsActual: 4, epsEstimate: 3.8 }] }, new Set(['MSFT']), '2026-10-30', '');
    expect(r.snapshots).toHaveLength(0);
    expect(r.events[0].epsEstimate.prov.publishedAt).toBeNull();
    expect(r.events[0].epsEstimate.prov.note).toMatch(/histórico/);
  });
});

describe('EDGAR: cambio de CIK', () => {
  const q = (start: string, end: string, val: number, filed: string, accn: string) => ({ start, end, val, filed, accn, form: '10-Q', fy: 2026, fp: 'Q2' });
  const neu: CompanyFacts = { cik: 2115436, entityName: 'Exxon Mobil Corp', facts: { 'us-gaap': { Revenues: { units: { USD: [q('2026-04-01', '2026-06-30', 116, '2026-08-03', '0000034088-26-000093'), q('2025-04-01', '2025-06-30', 81, '2026-08-03', '0000034088-26-000093')] } } } } };
  const old: CompanyFacts = { cik: 34088, entityName: 'EXXON MOBIL CORP', facts: { 'us-gaap': { Revenues: { units: { USD: [
    q('2025-01-01', '2025-03-31', 83, '2025-05-02', '0000034088-25-000020'),
    q('2025-04-01', '2025-06-30', 81, '2025-08-04', '0000034088-25-000040'),
    q('2025-07-01', '2025-09-30', 85, '2025-11-03', '0000034088-25-000060'),
  ] } } } } };
  it('detecta el CIK anterior por el prefijo de acceso', () => {
    expect(formerCikCandidates(neu, '0002115436')).toEqual(['0000034088']);
  });
  it('confirma la misma entidad por nombre', () => {
    expect(sameEntity('Exxon Mobil Corp', 'EXXON MOBIL CORP /NJ/')).toBe(true);
    expect(sameEntity('Exxon Mobil Corp', 'Donnelley Financial')).toBe(false);
  });
  it('une la historia y conserva la primera presentación', () => {
    const qs = parseCompanyFacts(mergeCompanyFacts(neu, old), 'XOM', '');
    expect(qs.map((x) => x.periodEnd)).toEqual(['2025-03-31', '2025-06-30', '2025-09-30', '2026-06-30']);
    expect(qs[1].filed).toBe('2025-08-04');
  });
});

import { pricesFresh } from '@/lib/pipeline/ingest';
describe('TwelveData: frescura de precios', () => {
  it('la descarga de anoche (misma fecha UTC, antes del cierre) no cuenta como fresca', () => {
    expect(pricesFresh('2026-10-30T02:48:00Z', new Date('2026-10-30T23:06:00Z'))).toBe(false);
  });
  it('una descarga después del cierre del mismo día sí', () => {
    expect(pricesFresh('2026-10-30T23:10:00Z', new Date('2026-10-30T23:40:00Z'))).toBe(true);
  });
  it('una descarga de ayer nunca', () => {
    expect(pricesFresh('2026-10-29T23:10:00Z', new Date('2026-10-30T23:40:00Z'))).toBe(false);
  });
});

import { appendPredictions, outcomeKnowableAt } from '@/lib/ledger';
import type { Prediction } from '@/lib/types';
describe('Bitácora: no registrar predicciones cuyo resultado ya era conocible', () => {
  const p = (over: Partial<Prediction>): Prediction => ({
    id: 'MSFT:2026-10-28:POST:1', symbol: 'MSFT', reportDate: '2026-10-28', mode: 'POST', horizon: 1, createdAt: '', decisionDate: '2026-10-29', referencePrice: 1,
    model: 'baseline', modelVersion: 'ei-v1', probs: { up: 0.4, down: 0.3, flat: 0.3 }, flatBand: 0.01, expectedReturn: 0, interval: null, confidence: 'BAJA', factors: [], invalidation: [], ...over,
  });
  it('POST: conocible al cierre de la sesión siguiente al día 0 (salta el fin de semana)', () => {
    expect(outcomeKnowableAt(p({}))).toBe('2026-10-30T20:00:00.000Z');
    expect(outcomeKnowableAt(p({ decisionDate: '2026-10-30' }))).toBe('2026-11-02T20:00:00.000Z');
  });
  it('PRE: conocible al publicarse el reporte', () => {
    expect(outcomeKnowableAt(p({ mode: 'PRE' }), 'post-market')).toBe('2026-10-28T20:00:00.000Z');
    expect(outcomeKnowableAt(p({ mode: 'PRE' }), 'pre-market')).toBe('2026-10-28T11:00:00.000Z');
  });
  it('caso real del 30-oct: precios del 29 registrados a las 23:14 UTC del 30 → rechazada', async () => {
    const r = await appendPredictions(memoryStore(), [p({})], { now: '2026-10-30T23:14:19.000Z', labelKnownAt: (x) => outcomeKnowableAt(x) });
    expect(r.rejectedLate).toEqual(['MSFT:2026-10-28:POST:1']);
  });
  it('misma predicción hecha la noche del día 0 → aceptada', async () => {
    const r = await appendPredictions(memoryStore(), [p({})], { now: '2026-10-29T23:14:19.000Z', labelKnownAt: (x) => outcomeKnowableAt(x) });
    expect(r.added).toBe(1);
  });
});
