import { describe, expect, it } from 'vitest';
import { EXPANSION, expansionEnabled } from '@/lib/universe/expansion';
import { GBM_US_STOCKS, SECTOR_ETF } from '@/lib/universe/seed';
import { buildRegistry, expansionCandidates, inScope, seedCandidates, universeGroup } from '@/lib/universe/registry';
import { normalizeTicker } from '@/lib/universe/normalize';
import { activeSymbols, pricesDue } from '@/lib/pipeline/ingest';
import { syntheticWorld } from '@/lib/demo/synthetic';
import { buildRows } from '@/lib/model/dataset';
import { runWalkForward } from '@/lib/backtest/walkforward';
import type { PriceSeries } from '@/lib/types';

describe('lista de ampliación', () => {
  it('sin duplicados, sin cruces con GBM, tickers válidos y sector con ETF', () => {
    const syms = EXPANSION.map((r) => r[0]);
    expect(new Set(syms).size).toBe(syms.length);
    const gbm = new Set(GBM_US_STOCKS.map((r) => r[0]));
    expect(syms.filter((s) => gbm.has(s))).toEqual([]);
    for (const [sym, , , sector] of EXPANSION) {
      expect(normalizeTicker(sym).market).toBe('US');
      expect(SECTOR_ETF[sector], `${sym}: ${sector}`).toBeTruthy();
    }
    expect(syms.length).toBeGreaterThanOrEqual(150);
  });
  it('entra al registro como "Medianas" y se puede apagar', () => {
    const { registry } = buildRegistry([...seedCandidates(), ...expansionCandidates()], null, []);
    expect(registry.companies.filter(inScope).length).toBe(GBM_US_STOCKS.length + EXPANSION.length);
    expect(universeGroup(registry.companies.find((c) => c.symbol === 'AYI')!)).toBe('Medianas');
    expect(universeGroup(registry.companies.find((c) => c.symbol === 'AAPL')!)).toBe('GBM');
    expect(expansionEnabled({})).toBe(true);
    expect(expansionEnabled({ UNIVERSE_EXPANSION: 'off' })).toBe(false);
  });
});

describe('programación de descargas', () => {
  const ps = (fetchedAt: string): PriceSeries => ({ symbol: 'X', bars: [], adjustment: 'PROVIDER_DEFAULT_UNVERIFIED', prov: { source: 't', publishedAt: null, fetchedAt, verification: 'PROVIDER_ACTUAL' } });
  const now = new Date('2026-10-30T23:00:00Z');
  it('activos: reporte entre −45 y +35 días', () => {
    const cal = { fetchedAt: '', asOf: '2026-10-30', events: [
      { symbol: 'A', reportDate: '2026-10-28' }, { symbol: 'B', reportDate: '2026-12-01' }, { symbol: 'C', reportDate: '2026-08-01' }, { symbol: 'D', reportDate: '2027-01-30' },
    ] } as never;
    expect([...activeSymbols(cal, '2026-10-30')].sort()).toEqual(['A', 'B']);
  });
  it('diarios se actualizan cada día; el resto cada 6 días; nuevos siempre', () => {
    expect(pricesDue(null, now, false)).toBe(true);
    expect(pricesDue(ps('2026-10-29T23:00:00Z'), now, true)).toBe(true);
    expect(pricesDue(ps('2026-10-29T23:00:00Z'), now, false)).toBe(false);
    expect(pricesDue(ps('2026-10-23T23:00:00Z'), now, false)).toBe(true);
    expect(pricesDue(ps('2026-10-30T22:00:00Z'), now, true)).toBe(false);
  });
});

describe('backtest por universo', () => {
  it('reporta habilidad separada por grupo', () => {
    const w = syntheticWorld({ nSymbols: 20, signal: 3, seed: 3 });
    // La mitad de las empresas sintéticas como "Medianas".
    w.symbols.forEach((s, i) => (s.company.origins = [i % 2 ? 'expansion' : 'gbm-seed']));
    const rows = w.symbols.flatMap((s) => buildRows(s, w.spy, null, 0.0071));
    const r = runWalkForward(rows, new Map(w.symbols.map((s) => [s.company.symbol, s.bars])), w.spy, { mode: 'POST', horizon: 20, roundTrip: 0.0071 });
    expect(r.probByGroup.map((g) => g.group)).toEqual(['GBM', 'Medianas']);
    expect(r.probByGroup.reduce((a, g) => a + (g.prob?.n ?? 0), 0)).toBe(r.prob!.n);
  }, 60_000);
});
