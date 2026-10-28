/**
 * Datos SINTÉTICOS para pruebas y para el modo demo. Siempre con prefijo DEMO- y verification 'SIMULATED'.
 * Nunca se mezclan con datos reales: la app los muestra con una franja de advertencia.
 *
 * `signal` controla cuánta relación real hay entre sorpresa/gap y la deriva posterior, para poder
 * probar que el walk-forward detecta una ventaja cuando existe y NO la inventa cuando no existe.
 */
import type { Bar, Company, Provenance, QuarterFundamentals } from '../types';
import type { MergedEvent } from '../analysis/events';
import type { SymbolData } from '../model/dataset';
import { mulberry32 } from '../util/stats';

const SIM = (fetchedAt: string, note?: string): Provenance => ({ source: 'DEMO (sintético)', publishedAt: null, fetchedAt, verification: 'SIMULATED', ...(note ? { note } : {}) });

function gauss(rnd: () => number): number {
  const u = Math.max(1e-12, rnd());
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Calendario de sesiones hábiles (lunes a viernes) desde `start`. */
export function sessions(start: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export interface SyntheticWorld {
  spy: Bar[];
  sectors: Record<string, Bar[]>;
  symbols: SymbolData[];
}

export function syntheticWorld(o: { nSymbols?: number; nSessions?: number; seed?: number; signal?: number; start?: string; fetchedAt?: string } = {}): SyntheticWorld {
  const n = o.nSessions ?? 1500;
  const rnd = mulberry32(o.seed ?? 42);
  const signal = o.signal ?? 1;
  const fetchedAt = o.fetchedAt ?? '2026-10-27T00:00:00.000Z';
  const days = sessions(o.start ?? '2020-01-06', n);
  const mkt: number[] = days.map(() => 0.0004 + 0.01 * gauss(rnd));
  const toBars = (rets: number[], start: number, gaps?: Map<number, number>): Bar[] => {
    let p = start;
    return days.map((t, i) => {
      const prev = p;
      const g = gaps?.get(i) ?? 0;
      const open = prev * (1 + g);
      p = prev * (1 + rets[i]);
      const hi = Math.max(open, p) * (1 + Math.abs(0.004 * gauss(rnd)));
      const lo = Math.min(open, p) * (1 - Math.abs(0.004 * gauss(rnd)));
      return { time: t, open, high: hi, low: lo, close: p, volume: Math.round(2e6 * (1 + rnd())) };
    });
  };
  const spy = toBars(mkt, 400);
  const sectorNames = ['Technology', 'Financials', 'Healthcare'];
  const sectors: Record<string, Bar[]> = {};
  const sectorRets: Record<string, number[]> = {};
  for (const s of sectorNames) {
    sectorRets[s] = mkt.map((m) => m + 0.006 * gauss(rnd));
    sectors[s] = toBars(sectorRets[s], 100);
  }
  const symbols: SymbolData[] = [];
  for (let k = 0; k < (o.nSymbols ?? 20); k++) {
    const symbol = `DEMO-${String.fromCharCode(65 + (k % 26))}${k >= 26 ? Math.floor(k / 26) : ''}`;
    const sector = sectorNames[k % sectorNames.length];
    const vol = 0.012 + 0.012 * rnd();
    const rets = sectorRets[sector].map((s) => 0.9 * s + vol * gauss(rnd));
    const gaps = new Map<number, number>();
    const events: MergedEvent[] = [];
    const quarters: QuarterFundamentals[] = [];
    let rev = 1e9 * (1 + 5 * rnd());
    let eps = 0.5 + 2 * rnd();
    for (let i = 70 + Math.floor(rnd() * 40); i < n - 2; i += 61 + Math.floor(rnd() * 6)) {
      const est = eps * (1 + 0.02 * gauss(rnd));
      const surpriseSd = 0.05 * Math.abs(est) + 0.01;
      const actual = est + surpriseSd * gauss(rnd);
      const z = (actual - est) / surpriseSd;
      // Gap del día de reacción: responde a la sorpresa + ruido.
      const day0 = i + 1;
      const gap = 0.01 * z + 0.02 * gauss(rnd);
      gaps.set(day0, gap);
      rets[day0] = gap + 0.01 * gauss(rnd) + rets[day0] * 0.3;
      // Deriva posterior (PEAD) proporcional a la sorpresa, escalada por `signal`.
      for (let d = 1; d <= 20 && day0 + d < n; d++) rets[day0 + d] += signal * 0.0015 * z;
      const prevRev = rev;
      rev *= 1 + 0.02 + 0.03 * gauss(rnd);
      eps = actual;
      const reportDate = days[i];
      events.push({
        symbol, fiscalDateEnding: days[i - 20], reportDate, reportTime: 'post-market', reportTimeSource: 'DEMO', status: 'reported', sources: ['DEMO'],
        epsActual: { value: actual, prov: SIM(fetchedAt) },
        epsEstimate: { value: est, prov: SIM(fetchedAt) },
        revenueActual: { value: rev, prov: SIM(fetchedAt) },
        revenueEstimate: { value: prevRev * 1.02, prov: SIM(fetchedAt) },
      });
      const filedIdx = Math.min(n - 1, i + 10);
      quarters.push({
        symbol, periodEnd: days[i - 20], fiscalPeriod: `DEMO-${quarters.length + 1}`, filed: days[filedIdx], form: '10-Q',
        revenue: rev, grossProfit: rev * (0.4 + 0.05 * rnd()), operatingIncome: rev * (0.15 + 0.05 * gauss(rnd)), netIncome: rev * 0.1, epsDiluted: actual,
        operatingCashFlow: rev * (0.12 + 0.03 * gauss(rnd)), capex: rev * 0.03, sharesDiluted: 5e8, inventory: rev * 0.2, receivables: rev * 0.15, cash: rev * 0.3, totalDebt: rev * 0.5,
        currentAssets: rev * 0.8, currentLiabilities: rev * 0.5, derived: [], prov: SIM(fetchedAt),
      });
    }
    // Un próximo reporte programado (sin cifras reales todavía).
    events.push({
      symbol, fiscalDateEnding: null, reportDate: '2099-01-01', reportTime: 'post-market', reportTimeSource: 'DEMO', status: 'scheduled', sources: ['DEMO'],
      epsActual: { value: null, prov: { ...SIM(fetchedAt), verification: 'UNAVAILABLE' } },
      epsEstimate: { value: eps, prov: SIM(fetchedAt) },
      revenueActual: { value: null, prov: { ...SIM(fetchedAt), verification: 'UNAVAILABLE' } },
      revenueEstimate: { value: rev * 1.02, prov: SIM(fetchedAt) },
    });
    const company: Company = { symbol, name: `Empresa sintética ${symbol}`, exchange: 'DEMO', currency: 'USD', country: 'US', assetClass: 'stock', sector, coverage: 'US_SEC', origins: ['manual'], addedAt: fetchedAt, notes: ['Datos SIMULADOS'] };
    symbols.push({ company, bars: toBars(rets, 50 + 100 * rnd(), gaps), events, quarters: quarters.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)) });
  }
  return { spy, sectors, symbols };
}
