import { getStore, KEYS, type JsonStore } from '../src/lib/store';
import type { UniverseRegistry } from '../src/lib/types';
import { buildRegistry, expansionCandidates, importCandidates, seedCandidates, type Candidate } from '../src/lib/universe/registry';
import { EXPANSION_LIST_DATE, expansionEnabled } from '../src/lib/universe/expansion';
import { netlifyGbmReader, readGbmSources } from '../src/lib/universe/gbm-source';
import { parseCsv, parseJsonImport } from '../src/lib/universe/normalize';
import { promises as fs } from 'node:fs';

export const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

/** Sincroniza el universo: GBM (si hay credenciales) + copia del seed de GBM + ampliación de medianas + data/universe-manual.(csv|json). */
export async function syncUniverse(store: JsonStore, env = process.env): Promise<UniverseRegistry> {
  const now = new Date().toISOString();
  const prev = await store.get<UniverseRegistry>(KEYS.registry);
  const gbm = await readGbmSources(netlifyGbmReader(env), now);
  const cands: Candidate[] = [];
  const sources = [...gbm.sources];
  if (!gbm.candidates.some((c) => c.origin === 'gbm-seed')) {
    cands.push(...seedCandidates());
    sources.push({ origin: 'gbm-seed', status: 'OK', detail: 'Copia local del universo semilla de GBM (respaldo)', checkedAt: now, count: seedCandidates().length });
  }
  cands.push(...gbm.candidates);
  if (expansionEnabled(env)) {
    const e = expansionCandidates();
    cands.push(...e);
    sources.push({ origin: 'expansion', status: 'OK', detail: `Ampliación curada de acciones medianas de EE.UU. (lista del ${EXPANSION_LIST_DATE}); UNIVERSE_EXPANSION=off la desactiva`, checkedAt: now, count: e.length });
  }
  for (const f of ['data/universe-manual.csv', 'data/universe-manual.json']) {
    try {
      const text = await fs.readFile(f, 'utf8');
      const r = f.endsWith('.csv') ? parseCsv(text) : parseJsonImport(text);
      cands.push(...importCandidates(r.rows, 'manual'));
      sources.push({ origin: 'manual', status: r.errors.length ? 'ERROR' : 'OK', detail: `${f}${r.errors.length ? `: ${r.errors.join('; ')}` : ''}`, checkedAt: now, count: r.rows.length });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  const manualStored = (await store.get<{ symbol: string }[]>('universe/manual')) ?? [];
  if (manualStored.length) cands.push(...importCandidates(manualStored, 'manual'));
  const { registry, warnings } = buildRegistry(cands, prev, sources, now);
  for (const w of warnings) log(`Universo: ${w}`);
  await store.put(KEYS.registry, registry);
  return registry;
}

export { getStore, KEYS };
