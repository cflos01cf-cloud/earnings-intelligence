import { getStore, log, syncUniverse } from './_common.mts';
import { inScope } from '../src/lib/universe/registry';

const store = getStore();
const r = await syncUniverse(store);
log(`Universo en ${store.label}: ${r.companies.length} símbolos, ${r.companies.filter(inScope).length} con análisis de resultados.`);
for (const s of r.sources) log(`  ${s.origin}: ${s.status} — ${s.detail} (${s.count})`);
