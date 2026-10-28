import { describe, expect, it } from 'vitest';
import { epsSurprise, revenueSurprise, yoy } from '@/lib/analysis/surprise';
import { align, classify, flatBand, labelReturn, benchmarkReturn } from '@/lib/analysis/reaction';
import { mergeEvents, pitConsensusFor, resolveReportTime } from '@/lib/analysis/events';
import { parseAvEarnings } from '@/lib/providers/alphavantage';
import type { Bar } from '@/lib/types';
import { roundTripCost, costsFromEnv } from '@/lib/config';

const bar = (time: string, open: number, close: number): Bar => ({ time, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1e6 });
// Jueves 2026-07-30, viernes 31, lunes 3 de agosto…
const BARS: Bar[] = [bar('2026-07-29', 100, 100), bar('2026-07-30', 100, 101), bar('2026-07-31', 105, 106), bar('2026-08-03', 106, 108), bar('2026-08-04', 108, 107)];

describe('sorpresas sin porcentajes engañosos', () => {
  it('EPS normal', () => {
    const s = epsSurprise(1.1, 1.0, 100);
    expect(s.verdict).toBe('BEAT');
    expect(s.pct).toBeCloseTo(0.1);
    expect(s.priceScaledBps).toBeCloseTo(10);
  });
  it('consenso cercano a cero o signos distintos: sin %', () => {
    expect(epsSurprise(0.05, 0.01, 50).pct).toBeNull();
    expect(epsSurprise(0.2, -0.1, 50)).toMatchObject({ pct: null, verdict: 'BEAT' });
    expect(epsSurprise(-0.3, -0.2, 50)).toMatchObject({ pct: null, verdict: 'MISS' });
  });
  it('en línea dentro de la banda', () => {
    expect(epsSurprise(1.005, 1.0, 100).verdict).toBe('IN_LINE');
  });
  it('faltantes no se inventan', () => {
    expect(epsSurprise(null, 1, 100).verdict).toBe('UNAVAILABLE');
    expect(revenueSurprise(100, null).verdict).toBe('UNAVAILABLE');
    expect(yoy(10, -5)).toBeNull();
  });
});

describe('alineación del reporte con las velas', () => {
  it('post-market: día 0 = sesión siguiente', () => {
    expect(align(BARS, '2026-07-30', 'post-market')).toEqual({ base: 1, day0: 2, twoSessionWindow: false });
  });
  it('pre-market: día 0 = misma sesión', () => {
    expect(align(BARS, '2026-07-30', 'pre-market')).toEqual({ base: 0, day0: 1, twoSessionWindow: false });
  });
  it('reporte en fin de semana', () => {
    expect(align(BARS, '2026-08-01', 'post-market')).toEqual({ base: 2, day0: 3, twoSessionWindow: false });
  });
  it('hora desconocida: ventana de dos sesiones', () => {
    expect(align(BARS, '2026-07-30', 'unknown')).toEqual({ base: 0, day0: 2, twoSessionWindow: true });
  });
  it('etiquetas PRE (cierre→cierre) y POST (apertura→cierre)', () => {
    const a = align(BARS, '2026-07-30', 'post-market')!;
    expect(labelReturn(BARS, a, 1, 'PRE')).toBeCloseTo(106 / 101 - 1);
    expect(labelReturn(BARS, a, 1, 'POST')).toBeCloseTo(106 / 105 - 1);
    expect(labelReturn(BARS, a, 5, 'POST')).toBeNull(); // aún no hay velas suficientes
    expect(benchmarkReturn(BARS, BARS, a, 1, 'PRE')).toBeCloseTo(106 / 101 - 1);
  });
  it('banda lateral con costos', () => {
    expect(flatBand(0.01, 1, 0.0066)).toBeCloseTo(0.0066);
    expect(flatBand(0.02, 5, 0.0066)).toBeCloseTo(0.5 * 0.02 * Math.sqrt(5));
    expect(classify(0.02, 0.01)).toBe('UP');
    expect(classify(-0.005, 0.01)).toBe('FLAT');
  });
  it('costo ida y vuelta de GBM con IVA', () => {
    expect(roundTripCost(costsFromEnv({}))).toBeCloseTo(2 * (0.25 * 1.16 + 0.05 + 0.015) / 100);
  });
});

describe('fusión de eventos', () => {
  const av = parseAvEarnings({ quarterlyEarnings: [{ fiscalDateEnding: '2026-06-30', reportedDate: '2026-07-30', reportedEPS: '1.5', estimatedEPS: '1.4', reportTime: 'pre-market' }] }, 'AAPL', '2026-10-27T00:00:00Z');
  it('la hora del 8-K manda, salvo que caiga en horario de mercado', () => {
    expect(resolveReportTime('pre-market', { date: '2026-07-30', acceptedAt: '', reportTime: 'post-market', url: '' }).time).toBe('post-market');
    expect(resolveReportTime('pre-market', { date: '2026-07-30', acceptedAt: '', reportTime: 'during-market', url: '' }).time).toBe('pre-market');
    expect(resolveReportTime('unknown', undefined).time).toBe('unknown');
  });
  it('consenso de ingresos solo si se observó ANTES del anuncio', () => {
    const snaps = [
      { symbol: 'AAPL', asOf: '2026-06-25', reportDate: '2026-07-30', reportTime: 'post-market' as const, epsEstimate: 1.38, revenueEstimate: 9e10, source: 'Finnhub' },
      { symbol: 'AAPL', asOf: '2026-07-29', reportDate: '2026-07-30', reportTime: 'post-market' as const, epsEstimate: 1.4, revenueEstimate: 9.1e10, source: 'Finnhub' },
      { symbol: 'AAPL', asOf: '2026-07-30', reportDate: '2026-07-30', reportTime: 'post-market' as const, epsEstimate: 1.5, revenueEstimate: 9.9e10, source: 'Finnhub' },
    ];
    const pit = pitConsensusFor(snaps, 'AAPL', '2026-07-30')!;
    expect(pit.asOf).toBe('2026-07-29');
    expect(pit.revenueEstimate).toBe(9.1e10);
    expect(pit.revisionsEps30d).toBeCloseTo(0.02);
    const [m] = mergeEvents('AAPL', av, [], [{ date: '2026-07-30', acceptedAt: '2026-07-30T20:31:00Z', reportTime: 'post-market', url: 'u' }], snaps);
    expect(m.reportTime).toBe('post-market');
    expect(m.revenueEstimate.value).toBe(9.1e10);
    expect(m.revenueEstimate.prov.verification).toBe('CONSENSUS');
    expect(m.epsEstimate.value).toBe(1.4);
  });
  it('un 8-K del día siguiente NO cambia la hora', () => {
    const [m] = mergeEvents('AAPL', av, [], [{ date: '2026-07-31', acceptedAt: '', reportTime: 'pre-market', url: '' }], []);
    expect(m.reportTime).toBe('pre-market');
    expect(m.reportTimeSource).toBe('Proveedor');
  });
});
