// Genera un snapshot SINTÉTICO en .data/ para ver la app sin llaves (DATA_MODE=demo).
import { fileStore, KEYS } from '../src/lib/store';
import { demoDataset } from '../src/lib/demo/dataset';
import { buildSnapshot } from '../src/lib/pipeline/build';
import { costsFromEnv, roundTripCost } from '../src/lib/config';

const store = fileStore('.data/demo');
const { ds, now } = demoDataset();
const { snapshot, walkForward } = await buildSnapshot(ds, { now, roundTrip: roundTripCost(costsFromEnv()), store, log: console.log });
await store.put(KEYS.snapshot, snapshot);
await store.put(KEYS.backtest, walkForward.map(({ liveSet: _l, ...r }) => r));
console.log(`Snapshot DEMO escrito en .data/demo (${snapshot.companies.length} empresas sintéticas).`);
