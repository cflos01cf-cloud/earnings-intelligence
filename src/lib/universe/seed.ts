/**
 * Copia de las acciones de EE.UU./ADR del universo semilla de GBM Weekly Trend
 * (repo gbm-trend-engine, src/lib/config/universe-seed.ts, commit f59809b).
 *
 * Es el RESPALDO. La fuente viva es el snapshot que GBM publica en su Netlify Blobs
 * (`latest/ranking.json`), más tus posiciones y watchlist de My Portfolio; ver `gbm-source.ts`.
 * Los ETFs del universo GBM no reportan resultados: se usan solo como benchmark.
 */
import type { AssetClass } from '../types';

export type SeedRow = [symbol: string, name: string, exchange: string, sector: string, assetClass: AssetClass, country: string];

export const GBM_US_STOCKS: SeedRow[] = [
  ['AAPL', 'Apple', 'NASDAQ', 'Technology', 'stock', 'US'],
  ['MSFT', 'Microsoft', 'NASDAQ', 'Technology', 'stock', 'US'],
  ['NVDA', 'NVIDIA', 'NASDAQ', 'Semiconductors', 'stock', 'US'],
  ['AMZN', 'Amazon', 'NASDAQ', 'Consumer', 'stock', 'US'],
  ['GOOGL', 'Alphabet (A)', 'NASDAQ', 'Communication', 'stock', 'US'],
  ['META', 'Meta Platforms', 'NASDAQ', 'Communication', 'stock', 'US'],
  ['TSLA', 'Tesla', 'NASDAQ', 'Consumer', 'stock', 'US'],
  ['AVGO', 'Broadcom', 'NASDAQ', 'Semiconductors', 'stock', 'US'],
  ['AMD', 'Advanced Micro Devices', 'NASDAQ', 'Semiconductors', 'stock', 'US'],
  ['NFLX', 'Netflix', 'NASDAQ', 'Communication', 'stock', 'US'],
  ['ORCL', 'Oracle', 'NYSE', 'Technology', 'stock', 'US'],
  ['CRM', 'Salesforce', 'NYSE', 'Technology', 'stock', 'US'],
  ['ADBE', 'Adobe', 'NASDAQ', 'Technology', 'stock', 'US'],
  ['QCOM', 'Qualcomm', 'NASDAQ', 'Semiconductors', 'stock', 'US'],
  ['MU', 'Micron Technology', 'NASDAQ', 'Semiconductors', 'stock', 'US'],
  ['TSM', 'Taiwan Semiconductor (ADR)', 'NYSE', 'Semiconductors', 'adr', 'TW'],
  ['ASML', 'ASML Holding (ADR)', 'NASDAQ', 'Semiconductors', 'adr', 'NL'],
  ['PLTR', 'Palantir', 'NASDAQ', 'Technology', 'stock', 'US'],
  ['MELI', 'MercadoLibre', 'NASDAQ', 'Consumer', 'stock', 'US'],
  ['JPM', 'JPMorgan Chase', 'NYSE', 'Financials', 'stock', 'US'],
  ['GS', 'Goldman Sachs', 'NYSE', 'Financials', 'stock', 'US'],
  ['BAC', 'Bank of America', 'NYSE', 'Financials', 'stock', 'US'],
  ['V', 'Visa', 'NYSE', 'Financials', 'stock', 'US'],
  ['MA', 'Mastercard', 'NYSE', 'Financials', 'stock', 'US'],
  ['BRK.B', 'Berkshire Hathaway (B)', 'NYSE', 'Financials', 'stock', 'US'],
  ['UNH', 'UnitedHealth', 'NYSE', 'Healthcare', 'stock', 'US'],
  ['LLY', 'Eli Lilly', 'NYSE', 'Healthcare', 'stock', 'US'],
  ['JNJ', 'Johnson & Johnson', 'NYSE', 'Healthcare', 'stock', 'US'],
  ['XOM', 'Exxon Mobil', 'NYSE', 'Energy', 'stock', 'US'],
  ['CVX', 'Chevron', 'NYSE', 'Energy', 'stock', 'US'],
  ['CAT', 'Caterpillar', 'NYSE', 'Industrials', 'stock', 'US'],
  ['GE', 'GE Aerospace', 'NYSE', 'Industrials', 'stock', 'US'],
  ['LMT', 'Lockheed Martin', 'NYSE', 'Industrials', 'stock', 'US'],
  ['COST', 'Costco', 'NASDAQ', 'Consumer Staples', 'stock', 'US'],
  ['WMT', 'Walmart', 'NYSE', 'Consumer Staples', 'stock', 'US'],
];

/** Benchmark de mercado y ETF sectorial por sector (todos en el universo de GBM). */
export const MARKET_BENCHMARK = 'SPY';
export const SECTOR_ETF: Record<string, string> = {
  Technology: 'XLK',
  Semiconductors: 'SMH',
  Communication: 'XLC',
  Consumer: 'XLY',
  'Consumer Staples': 'XLP',
  Financials: 'XLF',
  Healthcare: 'XLV',
  Energy: 'XLE',
  Industrials: 'XLI',
  Materials: 'XLB',
  Utilities: 'XLU',
  'Real Estate': 'XLRE',
};

/** Emisores extranjeros: presentan 20-F/6-K, sin XBRL trimestral en EDGAR. */
export const FOREIGN_FILERS = new Set(['TSM', 'ASML']);
