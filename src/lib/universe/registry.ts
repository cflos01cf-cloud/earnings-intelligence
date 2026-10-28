/**
 * Registro central de empresas. Une todas las fuentes, normaliza y deduplica.
 * Se publica como `universe/registry.json` para que las demás apps lo puedan leer.
 */
import type { AssetClass, Company, EarningsCoverage, UniverseOrigin, UniverseRegistry } from '../types';
import { normalizeTicker, type ImportRow } from './normalize';
import { FOREIGN_FILERS, GBM_US_STOCKS, SECTOR_ETF } from './seed';

export interface Candidate {
  symbol: string;
  name?: string;
  exchange?: string;
  currency?: string;
  sector?: string;
  assetClass?: AssetClass;
  country?: string;
  origin: UniverseOrigin;
}

export function seedCandidates(): Candidate[] {
  return GBM_US_STOCKS.map(([symbol, name, exchange, sector, assetClass, country]) => ({
    symbol, name, exchange, sector, assetClass, country, currency: 'USD', origin: 'gbm-seed',
  }));
}

export function importCandidates(rows: ImportRow[], origin: UniverseOrigin = 'import'): Candidate[] {
  return rows.map((r) => ({ ...r, origin }));
}

function coverageFor(c: { symbol: string; market: string; assetClass: AssetClass; country: string }): EarningsCoverage {
  if (c.assetClass === 'etf') return 'NO_EARNINGS';
  if (c.market === 'BMV') return 'BMV_PENDING';
  if (c.market !== 'US') return 'UNKNOWN';
  if (FOREIGN_FILERS.has(c.symbol) || c.assetClass === 'adr') return 'US_FOREIGN_FILER';
  return 'US_SEC';
}

/**
 * Fusiona candidatos. Si un símbolo llega de varias fuentes, se conservan todos sus orígenes
 * y se completa cada campo con el primer valor no vacío (el seed de GBM va primero).
 */
export function buildRegistry(candidates: Candidate[], prev: UniverseRegistry | null, sources: UniverseRegistry['sources'], now = new Date().toISOString()): { registry: UniverseRegistry; warnings: string[] } {
  const warnings: string[] = [];
  const prevBy = new Map((prev?.companies ?? []).map((c) => [c.symbol, c]));
  const by = new Map<string, Company & { _market: string }>();
  for (const cand of candidates) {
    const n = normalizeTicker(cand.symbol);
    for (const w of n.warnings) warnings.push(`${cand.symbol}: ${w}`);
    const existing = by.get(n.symbol);
    if (existing) {
      if (!existing.origins.includes(cand.origin)) existing.origins.push(cand.origin);
      existing.name = existing.name || cand.name || n.symbol;
      if (existing.sector === 'Sin clasificar' && cand.sector) existing.sector = cand.sector;
      continue;
    }
    const assetClass: AssetClass = cand.assetClass ?? (FOREIGN_FILERS.has(n.symbol) ? 'adr' : 'stock');
    const market = n.market;
    const country = cand.country ?? (market === 'BMV' ? 'MX' : market === 'US' ? 'US' : '??');
    const sector = cand.sector || prevBy.get(n.symbol)?.sector || 'Sin clasificar';
    const c: Company & { _market: string } = {
      _market: market,
      symbol: n.symbol,
      name: cand.name || prevBy.get(n.symbol)?.name || n.symbol,
      exchange: cand.exchange || (market === 'BMV' ? 'BMV' : prevBy.get(n.symbol)?.exchange || 'US'),
      currency: cand.currency || (market === 'BMV' ? 'MXN' : 'USD'),
      country,
      assetClass,
      sector,
      ...(prevBy.get(n.symbol)?.cik ? { cik: prevBy.get(n.symbol)!.cik } : {}),
      coverage: 'UNKNOWN',
      origins: [cand.origin],
      ...(SECTOR_ETF[sector] ? { sectorEtf: SECTOR_ETF[sector] } : {}),
      addedAt: prevBy.get(n.symbol)?.addedAt ?? now,
    };
    by.set(n.symbol, c);
  }
  const companies: Company[] = [...by.values()]
    .map(({ _market, ...c }) => ({ ...c, coverage: coverageFor({ symbol: c.symbol, market: _market, assetClass: c.assetClass, country: c.country }) }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { registry: { version: 1, updatedAt: now, companies, sources }, warnings };
}

/** Empresas a las que el MVP les calcula resultados (decisión del usuario: acciones de EE.UU.; BMV en fase posterior). */
export function inScope(c: Company): boolean {
  return c.coverage === 'US_SEC' || c.coverage === 'US_FOREIGN_FILER';
}
