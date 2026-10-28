import { getStore, log } from './_common.mts';
import { KEYS } from '../src/lib/store';
import { buildSnapshot, loadDataset } from '../src/lib/pipeline/build';
import { costsFromEnv, roundTripCost } from '../src/lib/config';
import type { UniverseRegistry } from '../src/lib/types';
import type { EarningsSnapshot } from '../src/lib/pipeline/snapshot-types';

const store = getStore();
const registry = await store.get<UniverseRegistry>(KEYS.registry);
if (!registry) throw new Error('No hay universo: corre primero `npm run ingest`.');
const ds = await loadDataset(store, registry);
const prev = await store.get<EarningsSnapshot>(KEYS.snapshot);
const { snapshot, walkForward } = await buildSnapshot(ds, { roundTrip: roundTripCost(costsFromEnv()), store, prev, log });
await store.put(KEYS.snapshot, snapshot);
await store.put(KEYS.backtest, walkForward.map(({ liveSet: _l, ...r }) => r));
log(`Snapshot publicado en ${store.label}: ${snapshot.companies.length} empresas, ${snapshot.signals.length} señales, ${snapshot.alerts.length} alertas candidatas.`);
for (const w of snapshot.warnings) log(`AVISO: ${w}`);
