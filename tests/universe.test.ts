import { describe, expect, it } from 'vitest';
import { normalizeTicker, parseCsv, parseJsonImport, providerSymbol } from '@/lib/universe/normalize';
import { buildRegistry, importCandidates, inScope, seedCandidates } from '@/lib/universe/registry';
import { candidatesFromPortfolio, candidatesFromRanking, readGbmSources } from '@/lib/universe/gbm-source';

describe('normalización de tickers', () => {
  it('unifica clases de acción y quita prefijos', () => {
    expect(normalizeTicker('brk-b').symbol).toBe('BRK.B');
    expect(normalizeTicker('BRK/B').symbol).toBe('BRK.B');
    expect(normalizeTicker('NASDAQ:aapl').symbol).toBe('AAPL');
    expect(normalizeTicker(' msft ').market).toBe('US');
  });
  it('reconoce emisoras de BMV', () => {
    expect(normalizeTicker('WALMEX.MX')).toMatchObject({ symbol: 'WALMEX', market: 'BMV' });
    expect(normalizeTicker('GFNORTEO').market).toBe('BMV');
  });
  it('marca formatos no estándar sin inventar', () => {
    const n = normalizeTicker('12$%');
    expect(n.market).toBe('UNKNOWN');
    expect(n.warnings.length).toBeGreaterThan(0);
  });
  it('traduce al formato de cada proveedor', () => {
    expect(providerSymbol('BRK.B', 'sec')).toBe('BRK-B');
    expect(providerSymbol('BRK.B', 'finnhub')).toBe('BRK.B');
    expect(providerSymbol('AAPL', 'alphavantage')).toBe('AAPL');
  });
});

describe('importación CSV/JSON', () => {
  it('CSV con encabezado y separador ;', () => {
    const r = parseCsv('symbol;name;sector\nAAPL;Apple;Technology\n;sin;x\n');
    expect(r.rows).toEqual([{ symbol: 'AAPL', name: 'Apple', sector: 'Technology' }]);
    expect(r.errors).toHaveLength(1);
  });
  it('CSV de una sola columna sin encabezado', () => {
    expect(parseCsv('aapl\nmsft\n# comentario\n').rows.map((r) => r.symbol)).toEqual(['aapl', 'msft']);
  });
  it('JSON arreglo o {symbols}', () => {
    expect(parseJsonImport('["AAPL", {"symbol":"MSFT"}]').rows).toHaveLength(2);
    expect(parseJsonImport('{"symbols":["NVDA"]}').rows).toHaveLength(1);
    expect(parseJsonImport('{bad').errors[0]).toMatch(/JSON inválido/);
  });
});

describe('registro central', () => {
  it('deduplica conservando todos los orígenes y clasifica cobertura', () => {
    const cands = [...seedCandidates(), ...importCandidates([{ symbol: 'aapl' }, { symbol: 'WALMEX.MX' }, { symbol: 'SPY' }]), ...candidatesFromPortfolio({ positions: [{ symbol: 'NVDA' }], watchlist: ['AMD'] })];
    cands.push({ symbol: 'SPY', origin: 'manual', assetClass: 'etf' });
    const { registry } = buildRegistry(cands, null, [], '2026-10-27T00:00:00Z');
    const aapl = registry.companies.find((c) => c.symbol === 'AAPL')!;
    expect(aapl.origins).toEqual(['gbm-seed', 'import']);
    expect(aapl.coverage).toBe('US_SEC');
    expect(aapl.sectorEtf).toBe('XLK');
    expect(registry.companies.find((c) => c.symbol === 'NVDA')!.origins).toContain('gbm-portfolio');
    expect(registry.companies.find((c) => c.symbol === 'WALMEX')!.coverage).toBe('BMV_PENDING');
    expect(registry.companies.find((c) => c.symbol === 'TSM')!.coverage).toBe('US_FOREIGN_FILER');
    expect(registry.companies.filter((c) => c.symbol === 'AAPL')).toHaveLength(1);
    expect(inScope(registry.companies.find((c) => c.symbol === 'WALMEX')!)).toBe(false);
  });
  it('lee el ranking de GBM: ETFs no reportan resultados', () => {
    const c = candidatesFromRanking({ assets: [{ entry: { symbol: 'XLK', assetClass: 'etf' } }, { entry: { symbol: 'AAPL', assetClass: 'stock', sector: 'Technology' } }] });
    const { registry } = buildRegistry(c, null, []);
    expect(registry.companies.find((x) => x.symbol === 'XLK')!.coverage).toBe('NO_EARNINGS');
  });
  it('sin credenciales de GBM no afirma estar conectado', async () => {
    const r = await readGbmSources(null);
    expect(r.sources.every((s) => s.status === 'NOT_CONFIGURED')).toBe(true);
  });
  it('reporta error real si la lectura falla', async () => {
    const r = await readGbmSources(async () => {
      throw new Error('401');
    });
    expect(r.sources.every((s) => s.status === 'ERROR')).toBe(true);
  });
});
