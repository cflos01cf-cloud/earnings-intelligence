import { describe, expect, it } from 'vitest';
import { syntheticWorld } from '@/lib/demo/synthetic';
import { buildRows, preFeaturesForUpcoming, type EventRow } from '@/lib/model/dataset';
import { predict, train } from '@/lib/model/engine';
import { fitLogistic, predictLogistic } from '@/lib/model/logistic';
import { runWalkForward } from '@/lib/backtest/walkforward';
import { fitScore, scoreOf } from '@/lib/score/earnings-score';
import type { Outcome } from '@/lib/types';

const RT = 0.0066;

function world(signal: number, seed = 3) {
  const w = syntheticWorld({ nSymbols: 20, signal, seed });
  const rows = w.symbols.flatMap((s) => buildRows(s, w.spy, w.sectors[s.company.sector], RT));
  return { w, rows, barsBy: new Map(w.symbols.map((s) => [s.company.symbol, s.bars])) };
}

describe('sin información futura', () => {
  it('las variables no cambian si se alteran las velas posteriores a la decisión', () => {
    const { w } = world(1);
    const s = w.symbols[0];
    const rows = buildRows(s, w.spy, null, RT);
    const r = rows[5];
    const day0 = s.bars.findIndex((b) => b.time === r.day0Date);
    const tampered = { ...s, bars: s.bars.map((b, i) => (i > day0 ? { ...b, open: b.open * 3, close: b.close * 3, high: b.high * 3, low: b.low * 3 } : i === day0 ? { ...b, close: b.close * 3, high: b.high * 3 } : b)) };
    const r2 = buildRows(tampered, w.spy, null, RT).find((x) => x.id === r.id)!;
    expect(r2.features.PRE).toEqual(r.features.PRE);
    expect(r2.features.POST).toEqual(r.features.POST);
    expect(r2.labels.POST[1]!.ret).not.toBeCloseTo(r.labels.POST[1]!.ret);
  });
  it('la historia de reacciones solo usa reportes cuya reacción ya terminó', () => {
    const { rows } = world(1);
    const sym = rows.filter((r) => r.symbol === rows[0].symbol);
    expect(sym[0].features.PRE.hist_n).toBe(0);
    expect(sym[3].features.PRE.hist_n).toBe(3);
  });
  it('fundamentales: solo trimestres presentados antes de la decisión', () => {
    const { w, rows } = world(1);
    const s = w.symbols[0];
    for (const r of rows.filter((x) => x.symbol === s.company.symbol)) {
      const visible = s.quarters.filter((q) => q.filed < r.baseDate);
      expect(r.features.PRE.has_fund).toBe(visible.length ? 1 : 0);
    }
  });
  it('el entrenamiento excluye eventos cuya etiqueta termina en o después del corte (purga)', () => {
    const { rows } = world(1);
    const cutoff = rows.map((r) => r.day0Date).sort()[Math.floor(rows.length / 2)];
    const set = train(rows, 'POST', 20, cutoff);
    const expected = rows.filter((r) => r.labels.POST[20] && r.labels.POST[20]!.endDate < cutoff && r.sigma).length;
    expect(set.nTrain).toBe(expected);
  });
  it('próximo reporte: variables PRE con datos hasta el último cierre', () => {
    const { w, rows } = world(1);
    const s = w.symbols[0];
    const f = preFeaturesForUpcoming(s, rows.filter((r) => r.symbol === s.company.symbol), w.spy, null)!;
    expect(f.baseDate).toBe(s.bars.at(-1)!.time);
    expect(f.features.hist_n).toBeGreaterThan(0);
  });
});

describe('modelo', () => {
  it('probabilidades suman 1', () => {
    const X = Array.from({ length: 200 }, (_, i) => ({ a: Math.sin(i), b: i % 3 === 0 ? null : Math.cos(i) }));
    const y: Outcome[] = X.map((x) => (x.a > 0.3 ? 'UP' : x.a < -0.3 ? 'DOWN' : 'FLAT'));
    const m = fitLogistic(X, y, ['a', 'b']);
    const p = predictLogistic(m, { a: 0.9, b: null });
    expect(p.up + p.down + p.flat).toBeCloseTo(1, 10);
    expect(p.up).toBeGreaterThan(0.6);
  });
  it('evidencia insuficiente con pocos eventos', () => {
    const { rows } = world(1);
    const set = train(rows.slice(0, 20), 'POST', 5, '9999-12-31');
    const p = predict(set, { symbol: 'X', reportDate: '2026-01-01', decisionDate: '2026-01-02', features: rows[0].features.POST, basePrice: 100, sigma: 0.02, roundTrip: RT });
    expect(p.probs).toBeNull();
    expect(p.confidence).toBe('EVIDENCIA_INSUFICIENTE');
  });
  it('predicción completa: intervalo ordenado, factores, invalidación', () => {
    const { rows } = world(1);
    const set = train(rows, 'POST', 20, '9999-12-31');
    const r = rows.at(-1)!;
    const p = predict(set, { symbol: r.symbol, reportDate: r.reportDate, decisionDate: r.day0Date, features: r.features.POST, basePrice: r.day0Open, sigma: r.sigma, roundTrip: RT });
    expect(p.probs!.up + p.probs!.down + p.probs!.flat).toBeCloseTo(1, 10);
    expect(p.interval![0]).toBeLessThan(p.interval![1]);
    expect(p.factors.length).toBeGreaterThan(0);
    expect(p.invalidation.length).toBeGreaterThan(0);
    // Sin walk-forward todavía no hay habilidad demostrada: confianza BAJA aunque haya probabilidades.
    expect(p.confidence).toBe('BAJA');
  });
});

describe('walk-forward', () => {
  it('detecta ventaja cuando existe (deriva post-reporte sintética)', () => {
    const { rows, w, barsBy } = world(1);
    const r = runWalkForward(rows, barsBy, w.spy, { mode: 'POST', horizon: 20, roundTrip: RT });
    expect(r.prob!.skill).toBeGreaterThan(0);
    expect(r.prob!.brierModel).toBeLessThan(r.prob!.brierBaseline);
    const model = r.strategies.find((s) => s.name === 'Modelo')!;
    expect(model.trades).toBeGreaterThan(0);
    expect(r.liveSet!.oosSkill).toBe(r.prob!.skill);
    // Cada bloque se entrenó solo con etiquetas terminadas antes de su inicio.
    for (const f of r.folds) {
      const set = train(rows, 'POST', 20, f.start);
      expect(set.nTrain).toBe(f.trainN);
    }
  }, 60_000);
  it('NO inventa ventaja en datos sin señal y entonces no opera', () => {
    const { rows, w, barsBy } = world(0);
    const r = runWalkForward(rows, barsBy, w.spy, { mode: 'POST', horizon: 20, roundTrip: RT });
    expect(r.prob!.skill).toBeLessThan(0.01);
    expect(r.strategies.find((s) => s.name === 'Modelo')!.trades).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/NO supera al baseline/);
  }, 60_000);
  it('evidencia insuficiente con pocos eventos', () => {
    const { rows, w, barsBy } = world(1);
    const r = runWalkForward(rows.slice(0, 50), barsBy, w.spy, { mode: 'POST', horizon: 5, roundTrip: RT });
    expect(r.prob).toBeNull();
    expect(r.warnings[0]).toMatch(/Evidencia insuficiente/);
  });
  it('incluye las referencias: no operar, todo reporte, sorpresa de EPS y S&P 500', () => {
    const { rows, w, barsBy } = world(1);
    const r = runWalkForward(rows, barsBy, w.spy, { mode: 'POST', horizon: 5, roundTrip: RT });
    expect(r.strategies.map((s) => s.name)).toEqual(['Modelo', 'Solo sorpresa de EPS', 'Comprar después de todo reporte', 'No operar', 'Comprar y mantener S&P 500']);
    expect(r.prob!.calibration.reduce((s, b) => s + b.n, 0)).toBe(r.prob!.n);
  }, 60_000);
});

describe('Earnings Score', () => {
  const { rows } = world(1);
  it('pesos suman 1 y los faltantes se excluyen', () => {
    const m = fitScore(rows, '9999-12-31');
    expect(m.calibrated).toBe(true);
    const r: EventRow = rows.at(-1)!;
    const s = scoreOf(m, { ...r.features.POST, fund_opm_chg: null }, 'POST');
    const live = s.components.filter((c) => c.score !== null);
    expect(live.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1);
    expect(s.missing).toContain('Guidance');
    expect(s.total).toBeGreaterThanOrEqual(0);
    expect(s.total).toBeLessThanOrEqual(100);
  });
  it('no calibrado con pocos eventos', () => {
    const m = fitScore(rows.slice(0, 10), '9999-12-31');
    expect(m.calibrated).toBe(false);
    expect(scoreOf(m, rows[0].features.POST, 'POST').method).toMatch(/NO calibrado/);
  });
  it('en modo PRE no usa sorpresas', () => {
    const m = fitScore(rows, '9999-12-31');
    const s = scoreOf(m, rows.at(-1)!.features.PRE, 'PRE');
    expect(s.components.find((c) => c.key === 'eps')!.score).toBeNull();
  });
});
