import { describe, expect, it } from 'vitest';
import { demoDataset } from '@/lib/demo/dataset';
import { buildSnapshot, nextWeekday } from '@/lib/pipeline/build';
import { ingest, mergeBars, type AvRaw } from '@/lib/pipeline/ingest';
import { memoryStore, KEYS } from '@/lib/store';
import { readLedger, verifyChain } from '@/lib/ledger';
import { AlphaVantageClient } from '@/lib/providers/alphavantage';
import { buildRegistry, inScope, seedCandidates } from '@/lib/universe/registry';
import type { PriceSeries } from '@/lib/types';

const RT = 0.0066;

describe('snapshot de demostración', () => {
  it('construye todo, marca DEMO, registra predicciones y es idempotente', async () => {
    const { ds, now } = demoDataset();
    const store = memoryStore();
    const { snapshot } = await buildSnapshot(ds, { now, roundTrip: RT, store });
    expect(snapshot.dataMode).toBe('demo');
    expect(snapshot.warnings[0]).toMatch(/SINTÉTICOS/);
    expect(snapshot.companies.length).toBe(24);
    expect(snapshot.backtests).toHaveLength(6);
    for (const c of snapshot.companies) {
      for (const p of c.predictions) {
        if (p.probs) expect(p.probs.up + p.probs.down + p.probs.flat).toBeCloseTo(1, 9);
        else expect(p.confidence).toBe('EVIDENCIA_INSUFICIENTE');
      }
    }
    // Hay reportes recién publicados (día 0 = hoy) y próximos.
    expect(snapshot.alerts.some((a) => a.kind === 'REPORTED')).toBe(true);
    expect(snapshot.alerts.some((a) => a.kind === 'UPCOMING')).toBe(true);
    const rep = snapshot.alerts.find((a) => a.kind === 'REPORTED')!;
    expect(rep.lines[0]).toMatch(/PUBLICADOS/);
    expect(snapshot.alerts.find((a) => a.kind === 'UPCOMING')!.lines[0]).toMatch(/PREVIA AL ANUNCIO/);
    const l1 = await readLedger(store);
    expect(l1.length).toBeGreaterThan(0);
    expect(l1.every((e) => e.prediction.createdAt === now.toISOString())).toBe(true);
    // Segunda corrida el mismo día: no duplica ni reescribe.
    await buildSnapshot(ds, { now, roundTrip: RT, store, prev: snapshot });
    const l2 = await readLedger(store);
    expect(l2.length).toBe(l1.length);
    expect(verifyChain(l2).ok).toBe(true);
    expect(snapshot.live.chainOk).toBe(true);
    // Señales ordenadas por calidad estadística.
    const q = snapshot.signals.map((s) => s.quality);
    expect([...q].sort((a, b) => b - a)).toEqual(q);
  }, 180_000);
});

describe('ingesta', () => {
  it('sin llaves: cada proveedor queda NOT_CONFIGURED y nada se inventa', async () => {
    const store = memoryStore();
    const { registry } = buildRegistry(seedCandidates(), null, []);
    const { statuses } = await ingest(registry, registry.companies.filter(inScope), { store, env: {} });
    expect(statuses.map((s) => s.status)).toEqual(['NOT_CONFIGURED', 'NOT_CONFIGURED', 'NOT_CONFIGURED', 'NOT_CONFIGURED']);
    expect(await store.get(KEYS.raw('prices', 'AAPL'))).toBeNull();
  });
  it('Alpha Vantage respeta el presupuesto diario y se detiene ante el límite del proveedor', async () => {
    const store = memoryStore();
    const { registry } = buildRegistry(seedCandidates(), null, []);
    let calls = 0;
    const fetcher = async () => {
      calls++;
      const body = calls <= 3 ? { quarterlyEarnings: [{ reportedDate: '2026-07-30', reportedEPS: '1', estimatedEPS: '0.9' }] } : { Information: 'rate limit 25 requests per day' };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const av = new AlphaVantageClient('k', 1000, fetcher as typeof fetch);
    const { statuses } = await ingest(registry, registry.companies.filter(inScope), { store, env: { ALPHAVANTAGE_DAILY_LIMIT: '10' }, clients: { av, edgar: null, fh: null, td: null }, now: new Date('2026-10-27T23:00:00Z') });
    expect(calls).toBe(4);
    const s = statuses.find((x) => x.provider === 'Alpha Vantage')!;
    expect(s.status).toBe('PARTIAL');
    expect(s.detail).toMatch(/límite del proveedor/);
    expect((await store.get<AvRaw>(KEYS.raw('av', 'AAPL')))!.events).toHaveLength(1);
  });
  it('fusión de velas y detección de ajuste retroactivo', () => {
    const mk = (bars: [string, number][]): PriceSeries => ({ symbol: 'X', bars: bars.map(([time, close]) => ({ time, open: close, high: close, low: close, close, volume: 1 })), adjustment: 'PROVIDER_DEFAULT_UNVERIFIED', prov: { source: 't', publishedAt: null, fetchedAt: '', verification: 'PROVIDER_ACTUAL' } });
    const a = mergeBars(mk([['2026-01-01', 10], ['2026-01-02', 11]]), mk([['2026-01-02', 11], ['2026-01-05', 12]]));
    expect(a.needFull).toBe(false);
    expect(a.series.bars.map((b) => b.time)).toEqual(['2026-01-01', '2026-01-02', '2026-01-05']);
    expect(mergeBars(mk([['2026-01-01', 10], ['2026-01-02', 11]]), mk([['2026-01-02', 5.5], ['2026-01-05', 6]])).needFull).toBe(true);
  });
  it('siguiente día hábil', () => {
    expect(nextWeekday('2026-10-30')).toBe('2026-11-02');
    expect(nextWeekday('2026-10-27')).toBe('2026-10-28');
  });
});
