/**
 * Lectura en SOLO LECTURA de lo que GBM Weekly Trend publica en su Netlify Blobs
 * (mismo mecanismo que usa global-quant-hub en src/lib/engines/gbm.ts):
 *   - latest/ranking.json        → universo completo de GBM (con sector y clase de activo)
 *   - myportfolio/positions.json → tus posiciones reales y tu watchlist
 * Nunca se escribe en ese almacén.
 */
import type { AssetClass, UniverseRegistry } from '../types';
import type { Candidate } from './registry';

export const GBM_STORE = 'gbm-trend-engine';

interface GbmRanking { assets?: { entry?: { symbol?: string; name?: string; exchange?: string; currency?: string; assetClass?: string; sector?: string } }[] }
interface GbmPortfolio { positions?: { symbol?: string }[]; watchlist?: string[] }

export type BlobReader = (key: string) => Promise<unknown>;

export function netlifyGbmReader(env: NodeJS.ProcessEnv): BlobReader | null {
  if (!env.GBM_NETLIFY_SITE_ID || !env.GBM_BLOBS_TOKEN) return null;
  return async (key) => {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore({ name: GBM_STORE, siteID: env.GBM_NETLIFY_SITE_ID!, token: env.GBM_BLOBS_TOKEN! });
    return (await store.get(key, { type: 'json' })) ?? null;
  };
}

export function candidatesFromRanking(r: GbmRanking): Candidate[] {
  const out: Candidate[] = [];
  for (const a of r.assets ?? []) {
    const e = a.entry;
    if (!e?.symbol) continue;
    const assetClass: AssetClass = e.assetClass === 'etf' ? 'etf' : /ADR/i.test(e.name ?? '') ? 'adr' : 'stock';
    out.push({ symbol: e.symbol, name: e.name, exchange: e.exchange, currency: e.currency, sector: e.sector, assetClass, origin: 'gbm-seed' });
  }
  return out;
}

export function candidatesFromPortfolio(p: GbmPortfolio): Candidate[] {
  const out: Candidate[] = [];
  for (const pos of p.positions ?? []) if (pos.symbol) out.push({ symbol: pos.symbol, origin: 'gbm-portfolio' });
  for (const s of p.watchlist ?? []) if (s) out.push({ symbol: s, origin: 'gbm-watchlist' });
  return out;
}

/** Lee GBM y reporta el estado REAL de cada fuente (probado, no supuesto). */
export async function readGbmSources(reader: BlobReader | null, now = new Date().toISOString()): Promise<{ candidates: Candidate[]; sources: UniverseRegistry['sources'] }> {
  if (!reader) {
    const detail = 'Faltan GBM_NETLIFY_SITE_ID y GBM_BLOBS_TOKEN: se usa la copia local del universo semilla de GBM.';
    return {
      candidates: [],
      sources: [
        { origin: 'gbm-seed', status: 'NOT_CONFIGURED', detail, checkedAt: now, count: 0 },
        { origin: 'gbm-portfolio', status: 'NOT_CONFIGURED', detail, checkedAt: now, count: 0 },
      ],
    };
  }
  const sources: UniverseRegistry['sources'] = [];
  const candidates: Candidate[] = [];
  try {
    const r = (await reader('latest/ranking.json')) as GbmRanking | null;
    const c = r ? candidatesFromRanking(r) : [];
    candidates.push(...c);
    sources.push({ origin: 'gbm-seed', status: r ? 'OK' : 'ERROR', detail: r ? 'GBM latest/ranking.json leído' : 'latest/ranking.json no existe en el almacén de GBM', checkedAt: now, count: c.length });
  } catch (e) {
    sources.push({ origin: 'gbm-seed', status: 'ERROR', detail: `GBM ranking: ${(e as Error).message}`, checkedAt: now, count: 0 });
  }
  try {
    const p = (await reader('myportfolio/positions.json')) as GbmPortfolio | null;
    const c = p ? candidatesFromPortfolio(p) : [];
    candidates.push(...c);
    sources.push({ origin: 'gbm-portfolio', status: 'OK', detail: p ? 'GBM My Portfolio leído (posiciones + watchlist)' : 'Sin archivo de My Portfolio en GBM', checkedAt: now, count: c.length });
  } catch (e) {
    sources.push({ origin: 'gbm-portfolio', status: 'ERROR', detail: `GBM My Portfolio: ${(e as Error).message}`, checkedAt: now, count: 0 });
  }
  return { candidates, sources };
}
