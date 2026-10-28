import { getStore, log, syncUniverse } from './_common.mts';
import { ingest } from '../src/lib/pipeline/ingest';
import { inScope } from '../src/lib/universe/registry';
import { KEYS } from '../src/lib/store';

const store = getStore();
const registry = await syncUniverse(store);
const { statuses, registry: reg2 } = await ingest(registry, registry.companies.filter(inScope), { store, env: process.env, log });
await store.put(KEYS.registry, reg2);
for (const s of statuses) log(`${s.provider}: ${s.status} — ${s.detail}`);
