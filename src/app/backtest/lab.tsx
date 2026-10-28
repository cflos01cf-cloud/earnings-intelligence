'use client';
import { useMemo, useState } from 'react';
import { Calibration, Lines } from '@/components/charts';
import type { Probabilities } from '@/lib/types';

export interface LabPred { s: string; sec: string; d: string; m: Probabilities; b: Probabilities; o: 'UP' | 'DOWN' | 'FLAT'; r: number; e: string; g: boolean }
export interface LabRun {
  mode: 'PRE' | 'POST';
  horizon: number;
  roundTrip: number;
  folds: number;
  portfolio: { name: string; trades: number; netReturn: number; cagr: number | null; maxDrawdown: number; sharpe: number | null; sortino: number | null; calmar: number | null; winRate: number | null; expectancy: number | null }[];
  equity: Record<string, { date: string; value: number }[]>;
  bySector: { group: string; trades: number; expectancy: number | null; winRate: number | null }[];
  byCap: { group: string; trades: number; expectancy: number | null; winRate: number | null }[];
  byVolRegime: { group: string; trades: number; expectancy: number | null; winRate: number | null }[];
  warnings: string[];
  preds: LabPred[];
}

const pct = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`);
const signed = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%`);
const f2 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(2));
const ll = (p: Probabilities, o: string) => -Math.log(Math.max(1e-12, o === 'UP' ? p.up : o === 'DOWN' ? p.down : p.flat));
const br = (p: Probabilities, o: string) => (p.up - (o === 'UP' ? 1 : 0)) ** 2 + (p.down - (o === 'DOWN' ? 1 : 0)) ** 2 + (p.flat - (o === 'FLAT' ? 1 : 0)) ** 2;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function stats(rets: number[]) {
  const w = rets.filter((r) => r > 0);
  const l = rets.filter((r) => r <= 0);
  return { n: rets.length, win: rets.length ? w.length / rets.length : null, avgW: w.length ? mean(w) : null, avgL: l.length ? mean(l) : null, exp: rets.length ? mean(rets) : null };
}

export function Lab({ runs }: { runs: LabRun[] }) {
  const [mode, setMode] = useState<'PRE' | 'POST'>('POST');
  const [h, setH] = useState(5);
  const [sector, setSector] = useState('');
  const [symbol, setSymbol] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [edge, setEdge] = useState(10);
  const [costMult, setCostMult] = useState(1);
  const [gate, setGate] = useState(true);
  const run = runs.find((r) => r.mode === mode && r.horizon === h);
  const sectors = useMemo(() => [...new Set(runs.flatMap((r) => r.preds.map((p) => p.sec)))].sort(), [runs]);
  const symbols = useMemo(() => [...new Set(runs.flatMap((r) => r.preds.map((p) => p.s)))].sort(), [runs]);
  const view = useMemo(() => {
    if (!run) return null;
    const ps = run.preds.filter((p) => (!sector || p.sec === sector) && (!symbol || p.s === symbol) && (!from || p.d >= from) && (!to || p.d <= to));
    const cost = run.roundTrip * costMult;
    const llm = mean(ps.map((p) => ll(p.m, p.o)));
    const llb = mean(ps.map((p) => ll(p.b, p.o)));
    const bins = Array.from({ length: 10 }, () => ({ ps: [] as number[], ys: [] as number[] }));
    for (const p of ps) {
      const b = bins[Math.min(9, Math.floor(p.m.up * 10))];
      b.ps.push(p.m.up);
      b.ys.push(p.o === 'UP' ? 1 : 0);
    }
    const take = (p: LabPred) => (!gate || p.g) && p.m.up - p.m.down >= edge / 100 && p.m.up >= p.m.flat;
    const strat = (name: string, f: (p: LabPred) => boolean) => {
      const chosen = ps.filter(f).sort((a, b) => a.d.localeCompare(b.d));
      let acc = 0;
      const curve = chosen.map((p) => ({ date: p.d, value: (acc += p.r - cost) }));
      return { name, ...stats(chosen.map((p) => p.r - cost)), curve };
    };
    const strategies = [strat('Modelo', take), ...(mode === 'POST' ? [strat('Solo sorpresa de EPS', (p) => p.e === 'BEAT')] : []), strat('Todo reporte', () => true)];
    return {
      n: ps.length,
      brierM: mean(ps.map((p) => br(p.m, p.o))),
      brierB: mean(ps.map((p) => br(p.b, p.o))),
      llm,
      llb,
      skill: 1 - llm / llb,
      calib: bins.map((b, i) => ({ bin: `${i * 10}–${i * 10 + 10}%`, predicted: mean(b.ps), observed: mean(b.ys), n: b.ps.length })).filter((b) => b.n),
      strategies,
      cost,
    };
  }, [run, sector, symbol, from, to, edge, costMult, gate, mode]);

  const sel = 'rounded border border-line bg-panel px-2 py-1 text-sm';
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 text-xs text-muted">Escenario<select className={sel} value={mode} onChange={(e) => setMode(e.target.value as 'PRE' | 'POST')}><option value="POST">Después del reporte</option><option value="PRE">Antes del reporte</option></select></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Horizonte<select className={sel} value={h} onChange={(e) => setH(Number(e.target.value))}>{[1, 5, 20].map((x) => <option key={x} value={x}>{x} sesiones</option>)}</select></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Sector<select className={sel} value={sector} onChange={(e) => setSector(e.target.value)}><option value="">Todos</option>{sectors.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Activo<select className={sel} value={symbol} onChange={(e) => setSymbol(e.target.value)}><option value="">Todos</option>{symbols.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Desde<input type="date" className={sel} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Hasta<input type="date" className={sel} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Ventaja mínima (pp)<input type="number" min={0} max={60} className={`${sel} w-24`} value={edge} onChange={(e) => setEdge(Number(e.target.value))} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Costos ×<select className={sel} value={costMult} onChange={(e) => setCostMult(Number(e.target.value))}>{[0.5, 1, 1.5, 2, 3].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={gate} onChange={(e) => setGate(e.target.checked)} />Exigir habilidad previa</label>
      </div>
      {!run || !view ? <p className="text-sm text-muted">Sin backtest para este escenario.</p> : (
        <>
          {run.warnings.map((w) => <p key={w} className="mb-1 text-sm text-warn">⚠ {w}</p>)}
          <div className="my-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ['Eventos fuera de muestra', String(view.n)],
              ['Brier modelo / baseline', `${f2(view.brierM)} / ${f2(view.brierB)}`],
              ['Log loss modelo / baseline', `${f2(view.llm)} / ${f2(view.llb)}`],
              ['Habilidad (1 − LL/LL₀)', signed(view.skill)],
              ['Costo ida y vuelta', pct(view.cost, 2)],
            ].map(([k, v]) => <div key={k} className="rounded border border-line bg-panel px-3 py-2"><div className="text-xs text-muted">{k}</div><div className="num mt-1 text-lg">{v}</div></div>)}
          </div>
          <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
            <div>
              <Lines title="Suma de rendimientos netos por operación (sin capital compartido; con filtros)" series={view.strategies.map((s) => ({ name: s.name, points: s.curve }))} percentFromOne={false} />
              <table className="tbl mt-4 w-full text-sm">
                <thead><tr><th>Estrategia (filtrada)</th><th className="text-right">Operaciones</th><th className="text-right">Ganadoras</th><th className="text-right">Ganancia media</th><th className="text-right">Pérdida media</th><th className="text-right">Esperanza</th></tr></thead>
                <tbody>{view.strategies.map((s) => <tr key={s.name}><td>{s.name}</td><td className="num text-right">{s.n}</td><td className="num text-right">{pct(s.win, 0)}</td><td className="num text-right">{signed(s.avgW)}</td><td className="num text-right">{signed(s.avgL)}</td><td className="num text-right">{signed(s.exp)}</td></tr>)}</tbody>
              </table>
            </div>
            <Calibration title="Calibración de P(subida)" bins={view.calib} />
          </div>

          <h3 className="mb-2 mt-8 font-semibold">Cartera simulada (configuración base, sin filtros)</h3>
          <p className="mb-3 max-w-3xl text-sm text-muted">Hasta 10 posiciones simultáneas de 1/10 del capital, valuadas a diario con velas reales, costos completos y {run.folds} bloques trimestrales de walk-forward. Estas métricas no cambian con los filtros de arriba.</p>
          <Lines title="Capital (inicio = 0%)" series={Object.entries(run.equity).map(([name, points]) => ({ name, points }))} />
          <div className="overflow-x-auto">
            <table className="tbl mt-4 w-full text-sm">
              <thead><tr><th>Estrategia</th><th className="text-right">Ops</th><th className="text-right">Neto</th><th className="text-right">CAGR</th><th className="text-right">DD máx.</th><th className="text-right">Sharpe</th><th className="text-right">Sortino</th><th className="text-right">Calmar</th><th className="text-right">Ganadoras</th><th className="text-right">Esperanza</th></tr></thead>
              <tbody>{run.portfolio.map((s) => <tr key={s.name}><td>{s.name}</td><td className="num text-right">{s.trades}</td><td className="num text-right">{signed(s.netReturn, 1)}</td><td className="num text-right">{signed(s.cagr, 1)}</td><td className="num text-right">{signed(s.maxDrawdown, 1)}</td><td className="num text-right">{f2(s.sharpe)}</td><td className="num text-right">{f2(s.sortino)}</td><td className="num text-right">{f2(s.calmar)}</td><td className="num text-right">{pct(s.winRate, 0)}</td><td className="num text-right">{signed(s.expectancy)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            {([['Por sector', run.bySector], ['Por capitalización (aprox.)', run.byCap], ['Por régimen de volatilidad', run.byVolRegime]] as const).map(([t, rows]) => (
              <div key={t}>
                <h4 className="mb-2 text-sm text-muted">{t} — señales del modelo</h4>
                {rows.length ? <table className="tbl w-full text-sm"><tbody>{rows.map((r) => <tr key={r.group}><td>{r.group}</td><td className="num text-right">{r.trades}</td><td className="num text-right">{signed(r.expectancy)}</td><td className="num text-right">{pct(r.winRate, 0)}</td></tr>)}</tbody></table> : <p className="text-xs text-muted">Sin operaciones.</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
