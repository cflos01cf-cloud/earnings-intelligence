import { loadBacktest, loadSnapshot } from '@/lib/load';
import { DemoBanner, Empty, Section, Stamp, signed } from '@/components/ui';
import { Lab, type LabRun } from './lab';

export const dynamic = 'force-dynamic';

export default async function BacktestPage() {
  const { snap, error, store } = await loadSnapshot();
  if (!snap) return <Empty error={error} store={store} />;
  const wf = (await loadBacktest()) ?? [];
  const runs: LabRun[] = wf.map((r) => ({
    mode: r.mode,
    horizon: r.horizon,
    roundTrip: r.roundTrip,
    folds: r.folds.length,
    portfolio: r.strategies.map((s) => ({ name: s.name, trades: s.trades, netReturn: s.netReturn, cagr: s.cagr, maxDrawdown: s.maxDrawdown, sharpe: s.sharpe, sortino: s.sortino, calmar: s.calmar, winRate: s.winRate, expectancy: s.expectancy })),
    equity: Object.fromEntries(r.strategies.filter((s) => s.equity.length).map((s) => [s.name, s.equity])),
    bySector: r.bySector,
    byUniverse: r.byUniverse ?? [],
    byCap: r.byCap,
    byVolRegime: r.byVolRegime,
    warnings: r.warnings,
    preds: r.predictions.map((p) => ({ s: p.symbol, sec: p.sector, grp: p.group ?? 'GBM', d: p.decisionDate, m: p.model, b: p.baseline, o: p.outcome, r: p.ret, e: p.epsVerdict, g: p.gateOpen })),
  }));
  const sv = snap.scoreValidation;
  return (
    <>
      <DemoBanner snap={snap} />
      <Stamp snap={snap} />
      <Section title="Backtesting Lab" note="Walk-forward sin información futura: cada bloque se predice con un modelo entrenado solo con reportes cuya etiqueta ya había terminado. Ningún resultado se presenta como rentable si no lo es fuera de muestra.">
        <div className="mb-6 rounded border border-line bg-panel p-4 text-sm">
          <p className="mb-1 font-semibold">Limitaciones conocidas</p>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>Sesgo de supervivencia: el universo son empresas que hoy existen y son grandes. El resultado histórico tiende a verse mejor que la realidad.</li>
            <li>Consenso de EPS según Alpha Vantage sin fecha de corte publicada; consenso de ingresos solo desde que la app guarda instantáneas propias.</li>
            <li>Ajuste por splits/dividendos del proveedor de precios no verificado (se marcan saltos sospechosos).</li>
            <li>Sin guidance, transcripciones ni noticias por empresa en el modelo v1.</li>
          </ul>
          <p className="mt-2 text-muted">Validación del Earnings Score fuera de muestra: {sv.n} reportes · correlación de rango con el rendimiento anormal a 5 sesiones {sv.spearman === null ? 'n/d' : sv.spearman.toFixed(3)} · tercio superior − inferior {signed(sv.topMinusBottom)}.</p>
        </div>
        {runs.length ? <Lab runs={runs} /> : <p className="text-sm text-muted">No hay resultados de backtest publicados.</p>}
      </Section>
    </>
  );
}
