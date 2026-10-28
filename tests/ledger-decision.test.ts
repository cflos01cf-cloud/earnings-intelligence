import { describe, expect, it } from 'vitest';
import { appendPredictions, readLedger, recordOutcomes, verifyChain } from '@/lib/ledger';
import { memoryStore, KEYS } from '@/lib/store';
import { decide, type DecisionInput } from '@/lib/decision/engine';
import type { Company, Prediction } from '@/lib/types';

const pred = (id: string, over: Partial<Prediction> = {}): Prediction => ({
  id, symbol: id.split(':')[0], reportDate: '2026-10-30', mode: 'POST', horizon: 5, createdAt: '2026-10-31T13:00:00Z', decisionDate: '2026-10-31', referencePrice: 100,
  model: 'logistic', modelVersion: 'ei-v1', probs: { up: 0.55, down: 0.25, flat: 0.2 }, flatBand: 0.01, expectedReturn: 0.02, interval: [-0.03, 0.09], confidence: 'MEDIA',
  factors: [{ feature: 'eps_surprise_bps', label: 'Sorpresa de EPS', value: 20, contribution: 0.4 }, { feature: 'runup20_rel', label: 'Subida previa', value: 0.1, contribution: -0.2 }], invalidation: ['x'], ...over,
});

describe('bitácora de predicciones', () => {
  it('solo agrega: la primera predicción con un id es la que cuenta', async () => {
    const s = memoryStore();
    expect((await appendPredictions(s, [pred('AAPL:1'), pred('MSFT:1')], { now: '2026-10-31T13:00:00Z' })).added).toBe(2);
    const r = await appendPredictions(s, [pred('AAPL:1', { probs: { up: 0.9, down: 0.05, flat: 0.05 } }), pred('NVDA:1')], { now: '2026-11-01T13:00:00Z' });
    expect(r).toMatchObject({ added: 1, skippedExisting: 1 });
    const l = await readLedger(s);
    expect(l.map((e) => e.prediction.id)).toEqual(['AAPL:1', 'MSFT:1', 'NVDA:1']);
    expect(l[0].prediction.probs!.up).toBe(0.55);
    expect(verifyChain(l).ok).toBe(true);
  });
  it('rechaza predicciones cuyo resultado ya se conoce', async () => {
    const s = memoryStore();
    const r = await appendPredictions(s, [pred('AAPL:1')], { now: '2026-11-10T13:00:00Z', labelKnownAt: () => '2026-11-07' });
    expect(r.added).toBe(0);
    expect(r.rejectedLate).toEqual(['AAPL:1']);
  });
  it('detecta alteraciones de registros viejos', async () => {
    const s = memoryStore();
    await appendPredictions(s, [pred('AAPL:1'), pred('MSFT:1')], { now: '2026-10-31T13:00:00Z' });
    const key = KEYS.ledgerMonth('2026-10');
    const month = (await s.get<{ prediction: Prediction }[]>(key))!;
    month[0].prediction.probs = { up: 0.99, down: 0, flat: 0.01 };
    await s.put(key, month);
    expect(verifyChain(await readLedger(s))).toEqual({ ok: false, brokenAt: 1 });
  });
  it('resultados: no se duplican', async () => {
    const s = memoryStore();
    const o = { id: 'AAPL:1', resolvedAt: '2026-11-08', endDate: '2026-11-07', ret: 0.03, outcome: 'UP' as const };
    expect(await recordOutcomes(s, [o])).toBe(1);
    expect(await recordOutcomes(s, [o])).toBe(0);
  });
});

const company: Company = { symbol: 'AAPL', name: 'Apple', exchange: 'NASDAQ', currency: 'USD', country: 'US', assetClass: 'stock', sector: 'Technology', coverage: 'US_SEC', origins: ['gbm-seed'], addedAt: '' };
const input = (p: Prediction, over: Partial<DecisionInput> = {}): DecisionInput => ({ company, prediction: p, reportTime: 'post-market', basePrice: 100, baseTime: '2026-10-31', sigma: 0.015, avgDollarVolume20: 5e9, typicalMove: 0.04, roundTrip: 0.0066, oosSkill: 0.02, ...over });

describe('motor de decisión', () => {
  it('evidencia insuficiente → ESPERAR', () => {
    expect(decide(input(pred('A:1', { probs: null, confidence: 'EVIDENCIA_INSUFICIENTE', insufficientReason: 'pocos' }))).verdict).toBe('ESPERAR');
  });
  it('antes del reporte sin confianza ALTA → NO_OPERAR', () => {
    const s = decide(input(pred('A:1', { mode: 'PRE' })));
    expect(s.verdict).toBe('NO_OPERAR');
    expect(s.risks.join(' ')).toMatch(/binario/);
  });
  it('liquidez baja → NO_OPERAR', () => {
    expect(decide(input(pred('A:1'), { avgDollarVolume20: 1e6 })).verdict).toBe('NO_OPERAR');
  });
  it('confianza BAJA → NEUTRAL aunque la probabilidad sea alta', () => {
    expect(decide(input(pred('A:1', { confidence: 'BAJA', probs: { up: 0.8, down: 0.1, flat: 0.1 } }), { oosSkill: -0.01 })).verdict).toBe('NEUTRAL');
  });
  it('ALCISTA con stop, objetivo y beneficio/riesgo', () => {
    const s = decide(input(pred('A:1')));
    expect(s.verdict).toBe('ALCISTA');
    expect(s.stop!).toBeLessThan(100);
    expect(s.target!).toBeGreaterThan(100);
    expect(s.rewardRisk!).toBeGreaterThanOrEqual(1.5);
    expect(s.catalysts).toContain('Sorpresa de EPS');
    expect(s.risks).toContain('Subida previa');
    expect(s.quality).toBeGreaterThan(0);
  });
  it('beneficio/riesgo insuficiente → ESPERAR', () => {
    expect(decide(input(pred('A:1', { interval: [-0.03, 0.005], expectedReturn: 0.008 }))).verdict).toBe('ESPERAR');
  });
  it('BAJISTA sugiere evitar (sin cortos en GBM)', () => {
    const s = decide(input(pred('A:1', { probs: { up: 0.2, down: 0.6, flat: 0.2 }, expectedReturn: -0.03 })));
    expect(s.verdict).toBe('BAJISTA');
    expect(s.reasons.join(' ')).toMatch(/cortos/);
  });
});
