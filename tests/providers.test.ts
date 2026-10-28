import { describe, expect, it } from 'vitest';
import { classifyNyTime, nyClock, parseCompanyFacts, parseEarningsReleases, type CompanyFacts } from '@/lib/providers/edgar';
import { avStatus, parseAvEarnings } from '@/lib/providers/alphavantage';
import { parseFhCalendar } from '@/lib/providers/finnhub';
import { parseTwelveData } from '@/lib/providers/twelvedata';

const F = '2026-10-27T00:00:00Z';

/** Empresa con año fiscal calendario: Q1–Q3 en 10-Q (flujo acumulado), anual en 10-K. */
function facts(): CompanyFacts {
  const q = (start: string, end: string, val: number, filed: string, fp: string, form = '10-Q') => ({ start, end, val, filed, fy: 2025, fp, form });
  return {
    cik: 320193,
    facts: {
      'us-gaap': {
        Revenues: { units: { USD: [
          q('2025-01-01', '2025-03-31', 100, '2025-04-25', 'Q1'),
          q('2025-04-01', '2025-06-30', 110, '2025-07-25', 'Q2'),
          q('2025-07-01', '2025-09-30', 120, '2025-10-24', 'Q3'),
          q('2025-01-01', '2025-12-31', 470, '2026-02-10', 'FY', '10-K'),
          q('2025-01-01', '2025-09-30', 330, '2025-10-24', 'Q3'),
          // Reexpresión posterior del Q1: NO debe usarse (punto en el tiempo).
          q('2025-01-01', '2025-03-31', 999, '2026-04-25', 'Q1'),
        ] } },
        NetIncomeLoss: { units: { USD: [q('2025-01-01', '2025-03-31', 10, '2025-04-25', 'Q1'), q('2025-04-01', '2025-06-30', 11, '2025-07-25', 'Q2')] } },
        NetCashProvidedByUsedInOperatingActivities: { units: { USD: [
          q('2025-01-01', '2025-03-31', 20, '2025-04-25', 'Q1'),
          q('2025-01-01', '2025-06-30', 45, '2025-07-25', 'Q2'),
        ] } },
        AssetsCurrent: { units: { USD: [{ end: '2025-06-30', val: 500, filed: '2025-07-25', form: '10-Q' }] } },
      },
    },
  };
}

describe('SEC EDGAR', () => {
  const qs = parseCompanyFacts(facts(), 'TEST', F);
  it('arma trimestres y deriva el Q4 del anual menos 9 meses', () => {
    expect(qs.map((q) => q.periodEnd)).toEqual(['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31']);
    const q4 = qs.at(-1)!;
    expect(q4.revenue).toBe(140);
    expect(q4.derived).toContain('revenue');
    expect(q4.filed).toBe('2026-02-10');
  });
  it('usa la PRIMERA presentación, no reexpresiones posteriores', () => {
    expect(qs[0].revenue).toBe(100);
    expect(qs[0].filed).toBe('2025-04-25');
  });
  it('convierte flujo acumulado (YTD) a trimestre', () => {
    expect(qs[1].operatingCashFlow).toBe(25);
    expect(qs[1].derived).toContain('operatingCashFlow');
    expect(qs[1].currentAssets).toBe(500);
  });
  it('marca procedencia oficial', () => {
    expect(qs[0].prov.verification).toBe('OFFICIAL_FILING');
    expect(qs[0].prov.source).toBe('SEC EDGAR');
  });
  it('hora de Nueva York con horario de verano y de invierno', () => {
    expect(nyClock('2026-07-30T20:31:00.000Z')).toEqual({ date: '2026-07-30', minutes: 16 * 60 + 31 });
    expect(nyClock('2026-01-29T21:05:00.000Z')).toEqual({ date: '2026-01-29', minutes: 16 * 60 + 5 });
    expect(nyClock('2026-01-30T02:00:00.000Z').date).toBe('2026-01-29');
    expect(classifyNyTime(7 * 60)).toBe('pre-market');
    expect(classifyNyTime(12 * 60)).toBe('during-market');
    expect(classifyNyTime(16 * 60)).toBe('post-market');
  });
  it('detecta solo 8-K con Item 2.02', () => {
    const r = parseEarningsReleases({ filings: { recent: {
      form: ['8-K', '8-K', '10-Q'], items: ['2.02,9.01', '5.02', ''], acceptanceDateTime: ['2026-07-30T20:31:07.000Z', '2026-07-01T12:00:00.000Z', '2026-08-01T12:00:00.000Z'],
      filingDate: ['2026-07-30', '2026-07-01', '2026-08-01'], accessionNumber: ['0000320193-26-000070', 'x', 'y'], primaryDocument: ['a8-k.htm', 'b', 'c'],
    } } }, '0000320193');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ date: '2026-07-30', reportTime: 'post-market' });
    expect(r[0].url).toContain('/320193/000032019326000070/a8-k.htm');
  });
});

describe('Alpha Vantage', () => {
  it('interpreta EARNINGS y no inventa ingresos', () => {
    const ev = parseAvEarnings({ quarterlyEarnings: [
      { fiscalDateEnding: '2026-06-30', reportedDate: '2026-07-30', reportedEPS: '1.57', estimatedEPS: '1.43', reportTime: 'post-market' },
      { fiscalDateEnding: '2026-03-31', reportedDate: '2026-05-01', reportedEPS: 'None', estimatedEPS: '1.6', reportTime: 'pre-market' },
      { fiscalDateEnding: 'x', reportedDate: 'bad' },
    ] }, 'AAPL', F);
    expect(ev).toHaveLength(2);
    const last = ev.at(-1)!;
    expect(last).toMatchObject({ reportDate: '2026-07-30', reportTime: 'post-market', status: 'reported' });
    expect(last.epsActual.value).toBe(1.57);
    expect(last.epsEstimate.prov.verification).toBe('CONSENSUS');
    expect(last.revenueActual.value).toBeNull();
    expect(last.revenueEstimate.prov.verification).toBe('UNAVAILABLE');
    expect(ev[0].status).toBe('scheduled');
  });
  it('detecta límite de peticiones', () => {
    expect(avStatus({ Information: 'Our standard API rate limit is 25 requests per day' }).status).toBe('RATE_LIMITED');
    expect(avStatus({ 'Error Message': 'Invalid API call' }).status).toBe('INVALID_SYMBOL');
  });
});

describe('Finnhub', () => {
  it('filtra al universo y produce instantáneas de consenso', () => {
    const r = parseFhCalendar({ earningsCalendar: [
      { date: '2026-10-30', epsEstimate: 1.8, revenueEstimate: 1.2e11, hour: 'amc', quarter: 4, year: 2026, symbol: 'AAPL' },
      { date: '2026-10-30', epsEstimate: 1, symbol: 'ZZZZ' },
    ] }, new Set(['AAPL']), '2026-10-27', F);
    expect(r.snapshots).toEqual([{ symbol: 'AAPL', asOf: '2026-10-27', reportDate: '2026-10-30', reportTime: 'post-market', fiscalYear: 2026, fiscalQuarter: 4, epsEstimate: 1.8, revenueEstimate: 1.2e11, source: 'Finnhub' }]);
    expect(r.events[0].status).toBe('scheduled');
  });
});

describe('TwelveData', () => {
  it('ordena velas y clasifica errores', () => {
    const ok = parseTwelveData({ values: [{ datetime: '2026-01-03', open: '2', high: '2', low: '2', close: '2' }, { datetime: '2026-01-02', open: '1', high: '1', low: '1', close: '1' }] }, 'AAPL', F);
    expect(ok.series!.bars.map((b) => b.time)).toEqual(['2026-01-02', '2026-01-03']);
    expect(ok.series!.adjustment).toBe('PROVIDER_DEFAULT_UNVERIFIED');
    expect(parseTwelveData({ status: 'error', code: 429, message: 'x' }, 'A', F).status).toBe('RATE_LIMITED');
    expect(parseTwelveData({ status: 'error', code: 404, message: 'symbol not found' }, 'A', F).status).toBe('INVALID_SYMBOL');
  });
});
