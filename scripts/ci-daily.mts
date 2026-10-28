// Corrida diaria (GitHub Actions, después del cierre): universo → ingesta → modelos → snapshot → bitácora.
import { getStore, log, syncUniverse } from './_common.mts';
import { ingest } from '../src/lib/pipeline/ingest';
import { buildSnapshot, loadDataset } from '../src/lib/pipeline/build';
import { inScope } from '../src/lib/universe/registry';
import { KEYS } from '../src/lib/store';
import { costsFromEnv, roundTripCost } from '../src/lib/config';
import type { EarningsSnapshot } from '../src/lib/pipeline/snapshot-types';

const t0 = Date.now();
const store = getStore();
log(`Almacén: ${store.label}`);
const registry = await syncUniverse(store);
const { statuses, registry: reg2 } = await ingest(registry, registry.companies.filter(inScope), { store, env: process.env, log });
await store.put(KEYS.registry, reg2);
for (const s of statuses) log(`${s.provider}: ${s.status} — ${s.detail}`);
const ds = await loadDataset(store, reg2);
const prev = await store.get<EarningsSnapshot>(KEYS.snapshot);
const { snapshot, walkForward } = await buildSnapshot(ds, { roundTrip: roundTripCost(costsFromEnv()), store, prev, log });
await store.put(KEYS.snapshot, snapshot);
await store.put(KEYS.backtest, walkForward.map(({ liveSet: _l, ...r }) => r));
const runs = (await store.get<{ at: string; ms: number; providers: string[] }[]>(KEYS.runs)) ?? [];
await store.put(KEYS.runs, [...runs.slice(-59), { at: new Date().toISOString(), ms: Date.now() - t0, providers: statuses.map((s) => `${s.provider}:${s.status}`) }]);
log(`Listo en ${((Date.now() - t0) / 1000).toFixed(0)} s: ${snapshot.companies.length} empresas, ${snapshot.alerts.length} alertas candidatas, bitácora ${snapshot.live.predictions} predicciones (cadena ${snapshot.live.chainOk ? 'íntegra' : 'ROTA'}).`);
if (!snapshot.live.chainOk) process.exitCode = 1;
