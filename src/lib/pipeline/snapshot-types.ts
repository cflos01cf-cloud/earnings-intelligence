/** Forma del snapshot que publica Earnings Intelligence (lo leen la app y el Global Quant Hub). */
import type { Company, EarningsScore, Horizon, Mode, Prediction, ReportTime, Sourced, TradeSignal } from '../types';
import type { ProviderStatus } from './ingest';
import type { Breakdown, ProbMetrics, StrategyMetrics } from '../backtest/walkforward';
import type { QuarterMetrics } from '../analysis/fundamentals';

export const SNAPSHOT_VERSION = 1;

export interface CalendarItem {
  symbol: string;
  name: string;
  reportDate: string;
  reportTime: ReportTime;
  reportTimeSource: string;
  status: 'scheduled' | 'reported';
  daysTo: number;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  epsActual: number | null;
  revenueActual: number | null;
  impliedMove: null; // sin fuente autorizada de opciones en el plan gratuito
  dataComplete: boolean;
  sources: string[];
}

export interface ReactionRow {
  reportDate: string;
  reportTime: string;
  epsVerdict: string;
  epsSurprisePct: number | null;
  revenueSurprisePct: number | null;
  react1: number | null; // PRE h=1 (reacción inicial)
  react1Abn: number | null;
  post5Abn: number | null;
  post20Abn: number | null;
  abnormalVolume: number | null;
  fellDespiteBeat: boolean;
  preVol: number | null;
}

export interface ReportView {
  reportDate: string;
  reportTime: ReportTime;
  reportTimeSource: string;
  fiscalDateEnding: string | null;
  releaseUrl?: string;
  epsActual: Sourced<number>;
  epsEstimate: Sourced<number>;
  revenueActual: Sourced<number>;
  revenueEstimate: Sourced<number>;
  eps: { verdict: string; pct: number | null; diff: number | null; note: string | null };
  revenue: { verdict: string; pct: number | null; diff: number | null; note: string | null };
}

export interface CompanyView {
  company: Company;
  lastPrice: { close: number; date: string; source: string } | null;
  priceIssues: string[];
  lastReport: ReportView | null;
  upcoming: (ReportView & { daysTo: number }) | null;
  quarters: QuarterMetrics[];
  reactions: ReactionRow[];
  reactionSummary: { n: number; meanAbsMove: number | null; beatRate: number | null; fellDespiteBeat: number; upAfterMiss: number } | null;
  predictions: Prediction[];
  score: EarningsScore | null;
  scoreMode: Mode | null;
  signals: TradeSignal[];
  dataNotes: string[];
  guidance: { available: false; note: string };
  news: { available: false; note: string };
}

export interface BacktestSummary {
  mode: Mode;
  horizon: Horizon;
  testStart: string | null;
  testEnd: string | null;
  folds: number;
  prob: ProbMetrics | null;
  strategies: Omit<StrategyMetrics, 'equity'>[];
  equity: Record<string, { date: string; value: number }[]>;
  bySector: Breakdown[];
  byCap: Breakdown[];
  byVolRegime: Breakdown[];
  warnings: string[];
}

export interface AlertEvent {
  id: string;
  kind: 'UPCOMING' | 'REPORTED' | 'PROB_CHANGE' | 'THESIS' | 'RISK' | 'DATA';
  symbol: string | null;
  title: string;
  lines: string[];
  at: string;
  /** El hub manda alertas solo de los tipos que el usuario active. */
  priority: 'high' | 'normal';
}

export interface LiveTrack {
  predictions: number;
  resolved: number;
  hitRate: number | null;
  brier: number | null;
  chainOk: boolean;
  /** Resueltas pero registradas cuando su resultado ya era conocible: no cuentan en el historial. */
  excludedLate?: number;
  byConfidence: { confidence: string; n: number; hitRate: number | null }[];
}

export interface EarningsSnapshot {
  version: number;
  generatedAt: string;
  dataMode: 'live' | 'demo';
  modelVersion: string;
  roundTrip: number;
  universe: { total: number; inScope: number; coverage: Record<string, number>; sources: { origin: string; status: string; detail: string; count: number }[] };
  providers: ProviderStatus[];
  calendar: CalendarItem[];
  companies: CompanyView[];
  signals: TradeSignal[];
  backtests: BacktestSummary[];
  scoreValidation: { n: number; spearman: number | null; topMinusBottom: number | null };
  live: LiveTrack;
  alerts: AlertEvent[];
  warnings: string[];
}
