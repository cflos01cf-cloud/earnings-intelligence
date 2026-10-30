// Backtest walk-forward con los datos guardados. Uso: npm run backtest -- POST 5
import { getStore } from './_common.mts';
import { KEYS } from '../src/lib/store';
import { loadDataset } from '../src/lib/pipeline/build';
import { buildRows } from '../src/lib/model/dataset';
import { runWalkForward } from '../src/lib/backtest/walkforward';
import { costsFromEnv, roundTripCost } from '../src/lib/config';
import type { Horizon, Mode, UniverseRegistry } from '../src/lib/types';

const [mode = 'POST', h = '5'] = process.argv.slice(2);
const store = getStore();
const reg = await store.get<UniverseRegistry>(KEYS.registry);
if (!reg) throw new Error('No hay universo: corre `npm run ingest`.');
const ds = await loadDataset(store, reg);
const rt = roundTripCost(costsFromEnv());
const rows = ds.symbols.flatMap((s) => buildRows(s, ds.spy, s.company.sectorEtf ? ds.sectors[s.company.sectorEtf] ?? null : null, rt));
const r = runWalkForward(rows, new Map(ds.symbols.map((s) => [s.company.symbol, s.bars])), ds.spy, { mode: mode as Mode, horizon: Number(h) as Horizon, roundTrip: rt });
const p = (x: number | null | undefined, d = 2) => (x == null ? 'n/d' : x.toFixed(d));
console.log(`${mode} ${h} sesiones · eventos fuera de muestra ${r.prob?.n ?? 0} · ${r.testStart} → ${r.testEnd} · costo ida y vuelta ${(rt * 100).toFixed(2)}%`);
if (r.prob) console.log(`Brier ${p(r.prob.brierModel, 4)} (baseline ${p(r.prob.brierBaseline, 4)}) · log loss ${p(r.prob.logLossModel, 4)} (baseline ${p(r.prob.logLossBaseline, 4)}) · habilidad ${p(r.prob.skill, 4)}`);
for (const g of r.probByGroup) if (g.prob) console.log(`  ${g.group.padEnd(10)} n=${g.prob.n} habilidad ${p(g.prob.skill, 4)}`);
for (const s of r.strategies) console.log(`${s.name.padEnd(34)} ops ${String(s.trades).padStart(4)} · gana ${p(s.winRate && s.winRate * 100, 0)}% · esperanza ${p(s.expectancy && s.expectancy * 100)}% · neto ${p(s.netReturn * 100, 1)}% · Sharpe ${p(s.sharpe)} · DD ${p(s.maxDrawdown * 100, 1)}%`);
for (const w of r.warnings) console.log(`AVISO: ${w}`);
