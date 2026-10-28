/**
 * Tipos centrales de Earnings Intelligence.
 *
 * Regla madre: todo dato lleva su procedencia y se distingue entre
 *   - HECHO confirmado (reporte oficial o cifra real reportada por proveedor),
 *   - ESTIMACIÓN de analistas (consenso),
 *   - PREDICCIÓN del modelo,
 *   - dato SIMULADO (solo modo demo, siempre etiquetado).
 * Si no hay dato: `null` + verification 'UNAVAILABLE'. Nunca un valor inventado.
 */

export type Verification =
  | 'OFFICIAL_FILING' // SEC EDGAR (XBRL de 10-Q/10-K)
  | 'PROVIDER_ACTUAL' // cifra real reportada por un proveedor (no auditada por nosotros)
  | 'CONSENSUS' // estimación de analistas según proveedor
  | 'MODEL' // salida del modelo
  | 'DERIVED' // calculado por esta app a partir de otros datos
  | 'SIMULATED' // SOLO modo demo
  | 'UNAVAILABLE';

export interface Provenance {
  source: string; // 'SEC EDGAR', 'Alpha Vantage', 'Finnhub', 'TwelveData', 'Modelo', 'DEMO'
  url?: string;
  /** Cuándo se publicó el dato en su fuente (ISO o YYYY-MM-DD). null = desconocido. */
  publishedAt: string | null;
  /** Cuándo lo descargamos (ISO). */
  fetchedAt: string;
  fiscalPeriod?: string; // p. ej. '2026-Q3' o fecha de fin de periodo fiscal
  verification: Verification;
  note?: string;
}

export interface Sourced<T> {
  value: T | null;
  prov: Provenance;
}

// ───────────────────────── Universo ─────────────────────────

export type AssetClass = 'stock' | 'adr' | 'etf';
export type UniverseOrigin = 'gbm-seed' | 'gbm-portfolio' | 'gbm-watchlist' | 'manual' | 'import';
/** Qué tan cubierto está el símbolo para análisis de resultados. */
export type EarningsCoverage = 'US_SEC' | 'US_FOREIGN_FILER' | 'NO_EARNINGS' | 'BMV_PENDING' | 'UNKNOWN';

export interface Company {
  /** Ticker normalizado (mayúsculas; clases con punto: BRK.B). */
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  country: string; // 'US', 'MX', o país de origen del ADR
  assetClass: AssetClass;
  sector: string;
  /** CIK de la SEC (10 dígitos con ceros), si se resolvió. */
  cik?: string;
  coverage: EarningsCoverage;
  origins: UniverseOrigin[];
  /** Benchmark sectorial (ETF) para rendimiento relativo. */
  sectorEtf?: string;
  addedAt: string;
  notes?: string[];
}

export interface UniverseRegistry {
  version: 1;
  updatedAt: string;
  companies: Company[];
  /** Fuentes que se intentaron leer y su estado real (nunca "conectado" sin probar). */
  sources: { origin: UniverseOrigin; status: 'OK' | 'NOT_CONFIGURED' | 'ERROR'; detail: string; checkedAt: string; count: number }[];
}

// ───────────────────────── Precios ─────────────────────────

export interface Bar {
  time: string; // YYYY-MM-DD (sesión local)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface PriceSeries {
  symbol: string;
  bars: Bar[];
  prov: Provenance;
  /** Ajuste por splits/dividendos declarado por el proveedor. */
  adjustment: 'SPLITS_AND_DIVIDENDS' | 'PROVIDER_DEFAULT_UNVERIFIED' | 'SYNTHETIC';
}

// ───────────────────────── Resultados ─────────────────────────

export type ReportTime = 'pre-market' | 'post-market' | 'during-market' | 'unknown';

/** Un reporte trimestral (pasado o próximo). */
export interface EarningsEvent {
  symbol: string;
  /** Fin del trimestre fiscal (YYYY-MM-DD) si se conoce. */
  fiscalDateEnding: string | null;
  /** Fecha del anuncio (YYYY-MM-DD, hora de Nueva York). */
  reportDate: string;
  reportTime: ReportTime;
  status: 'scheduled' | 'reported';
  epsActual: Sourced<number>;
  epsEstimate: Sourced<number>;
  revenueActual: Sourced<number>;
  revenueEstimate: Sourced<number>;
}

/** Instantánea punto-en-el-tiempo del consenso de un próximo reporte (para construir historia propia). */
export interface ConsensusSnapshot {
  symbol: string;
  asOf: string; // YYYY-MM-DD en que se observó
  reportDate: string;
  fiscalYear?: number;
  fiscalQuarter?: number;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  reportTime: ReportTime;
  source: string;
}

/** Cifras trimestrales oficiales (SEC EDGAR, XBRL). Cada número con su fecha de presentación. */
export interface QuarterFundamentals {
  symbol: string;
  periodEnd: string;
  fiscalPeriod: string; // 'FY2026-Q2'
  /** Fecha en que se presentó el 10-Q/10-K ante la SEC: el dato NO existe para el modelo antes de esta fecha. */
  filed: string;
  form: string;
  accession?: string;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  epsDiluted: number | null;
  operatingCashFlow: number | null; // del trimestre (derivado de acumulados cuando aplica)
  capex: number | null;
  sharesDiluted: number | null;
  inventory: number | null;
  receivables: number | null;
  cash: number | null;
  totalDebt: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  /** Campos derivados de acumulados (YTD → trimestre). */
  derived: string[];
  prov: Provenance;
}

// ───────────────────────── Modelo ─────────────────────────

export type Horizon = 1 | 5 | 20;
export const HORIZONS: Horizon[] = [1, 5, 20];
/** PRE: decisión al cierre previo al anuncio. POST: decisión en la apertura de la primera sesión que ya conoce el reporte. */
export type Mode = 'PRE' | 'POST';
export type Outcome = 'UP' | 'DOWN' | 'FLAT';

export interface Probabilities {
  up: number;
  down: number;
  flat: number;
}

export type ModelName = 'baseline' | 'logistic';

export interface FactorContribution {
  feature: string;
  label: string;
  value: number | null;
  /** Contribución al logit de subida menos el de bajada (positivo = empuja al alza). */
  contribution: number;
}

export interface Prediction {
  id: string; // `${symbol}:${reportDate}:${mode}:${horizon}`
  symbol: string;
  reportDate: string;
  mode: Mode;
  horizon: Horizon;
  /** Instante en que la predicción existe (la bitácora prueba que fue antes del resultado). */
  createdAt: string;
  /** Sesión de decisión (cierre previo para PRE, apertura del día 0 para POST). */
  decisionDate: string;
  referencePrice: number | null;
  model: ModelName;
  modelVersion: string;
  probs: Probabilities | null; // null = Evidencia insuficiente
  /** Umbral de movimiento lateral usado (rendimiento absoluto). */
  flatBand: number | null;
  expectedReturn: number | null;
  /** Intervalo plausible 10%–90% (cuantiles empíricos de los residuos en entrenamiento). */
  interval: [number, number] | null;
  confidence: 'ALTA' | 'MEDIA' | 'BAJA' | 'EVIDENCIA_INSUFICIENTE';
  factors: FactorContribution[];
  invalidation: string[];
  insufficientReason?: string;
}

// ───────────────────────── Decisión ─────────────────────────

export type Verdict = 'ALCISTA' | 'BAJISTA' | 'NEUTRAL' | 'ESPERAR' | 'NO_OPERAR';

export interface TradeSignal {
  symbol: string;
  name: string;
  verdict: Verdict;
  mode: Mode;
  horizon: Horizon;
  reportDate: string;
  reportTime: ReportTime;
  referencePrice: number | null;
  referenceTime: string | null;
  probs: Probabilities | null;
  catalysts: string[];
  risks: string[];
  entry: number | null;
  invalidation: number | null;
  stop: number | null;
  target: number | null;
  rewardRisk: number | null;
  costsPct: number;
  cancelIf: string[];
  /** Calidad estadística para ordenar el scanner (no solo la probabilidad). */
  quality: number;
  reasons: string[];
}

export interface ScoreComponent {
  key: string;
  label: string;
  score: number | null; // 0–100; null = sin dato
  weight: number; // peso efectivo después de renormalizar
  detail: string;
}

export interface EarningsScore {
  total: number | null;
  components: ScoreComponent[];
  calibrated: boolean;
  method: string;
  missing: string[];
}
