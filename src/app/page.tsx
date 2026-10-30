import Link from 'next/link';
import { loadSnapshot } from '@/lib/load';
import { DemoBanner, Empty, HORIZON_TEXT, Kpi, MODE_TEXT, ProbBar, Section, Stamp, SymbolLink, VerdictBadge, pct, signed } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function Executive() {
  const { snap, error, store } = await loadSnapshot();
  if (!snap) return <Empty error={error} store={store} />;
  const today = snap.generatedAt.slice(0, 10);
  const upcoming = snap.calendar.filter((c) => c.status === 'scheduled' && c.reportDate >= today && c.daysTo <= 7);
  const recent = snap.companies.filter((c) => c.scoreMode === 'POST' && c.lastReport);
  const main = snap.signals.filter((s) => s.horizon === 5);
  const bull = main.filter((s) => s.verdict === 'ALCISTA');
  const bear = main.filter((s) => s.verdict === 'BAJISTA');
  const risk = snap.alerts.filter((a) => a.priority === 'high');
  const bt = snap.backtests.find((b) => b.mode === 'POST' && b.horizon === 5);
  const model = bt?.strategies.find((s) => s.name === 'Modelo');
  const providersBad = snap.providers.filter((p) => p.status === 'ERROR' || p.status === 'NOT_CONFIGURED');
  return (
    <>
      <DemoBanner snap={snap} />
      <Stamp snap={snap} />
      {snap.warnings.filter((w) => !w.startsWith('MODO DEMO')).map((w) => <p key={w} className="mb-2 text-sm text-warn">⚠ {w}</p>)}
      {providersBad.length && snap.dataMode === 'live' ? (
        <p className="mb-4 text-sm text-warn">⚠ Fuentes sin datos: {providersBad.map((p) => `${p.provider} (${p.status === 'ERROR' ? 'error' : 'sin configurar'})`).join(', ')}. <Link className="underline" href="/settings">Ver ajustes</Link></p>
      ) : null}

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Empresas monitoreadas" value={snap.universe.inScope} sub={`${snap.universe.total} en el universo`} />
        <Kpi label="Reportes en 7 días" value={upcoming.length} />
        <Kpi label="Alcistas (5 sesiones)" value={bull.length} tone={bull.length ? 'up' : undefined} />
        <Kpi label="Bajistas (5 sesiones)" value={bear.length} tone={bear.length ? 'down' : undefined} />
        <Kpi label="Recién publicados" value={recent.length} sub="últimas 20 sesiones" />
        <Kpi label="Alertas de riesgo" value={risk.length} tone={risk.length ? 'warn' : undefined} />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Próximos reportes" right={<Link href="/calendar" className="text-xs text-muted hover:text-fg">Calendario →</Link>}>
          {upcoming.length ? (
            <div className="overflow-x-auto"><table className="tbl w-full text-sm">
              <thead><tr><th>Empresa</th><th>Fecha</th><th>Hora</th><th>5 sesiones (PRE)</th></tr></thead>
              <tbody>
                {upcoming.slice(0, 10).map((c) => {
                  const p = snap.companies.find((x) => x.company.symbol === c.symbol)?.predictions.find((x) => x.mode === 'PRE' && x.horizon === 5 && x.reportDate === c.reportDate);
                  return (
                    <tr key={`${c.symbol}${c.reportDate}`}>
                      <td><SymbolLink s={c.symbol} /></td>
                      <td className="num">{c.reportDate}</td>
                      <td className="text-xs text-muted">{c.reportTime}</td>
                      <td><ProbBar p={p?.probs ?? null} compact /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          ) : <p className="text-sm text-muted">Sin reportes confirmados en los próximos 7 días.</p>}
        </Section>

        <Section title="Resultados recién publicados">
          {recent.length ? (
            <div className="overflow-x-auto"><table className="tbl w-full text-sm">
              <thead><tr><th>Empresa</th><th>Fecha</th><th>EPS</th><th>Ingresos</th><th>Decisión (5)</th></tr></thead>
              <tbody>
                {recent.map((c) => {
                  const s = c.signals.find((x) => x.mode === 'POST' && x.horizon === 5);
                  return (
                    <tr key={c.company.symbol}>
                      <td><SymbolLink s={c.company.symbol} /></td>
                      <td className="num">{c.lastReport!.reportDate}</td>
                      <td className="text-xs">{c.lastReport!.eps.verdict} {c.lastReport!.eps.pct !== null ? signed(c.lastReport!.eps.pct) : ''}</td>
                      <td className="text-xs">{c.lastReport!.revenue.verdict === 'UNAVAILABLE' ? <span className="text-muted">sin consenso</span> : `${c.lastReport!.revenue.verdict} ${signed(c.lastReport!.revenue.pct)}`}</td>
                      <td>{s ? <VerdictBadge v={s.verdict} /> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          ) : <p className="text-sm text-muted">Ninguna empresa del universo reportó en las últimas 20 sesiones.</p>}
        </Section>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Oportunidades" right={<Link href="/scanner" className="text-xs text-muted hover:text-fg">Todas →</Link>} note="Ordenadas por calidad estadística (habilidad fuera de muestra × ventaja × beneficio/riesgo), no por probabilidad.">
          {[...bull, ...bear].length ? (
            <ul className="space-y-2 text-sm">
              {[...bull, ...bear].slice(0, 8).map((s) => (
                <li key={`${s.symbol}${s.mode}${s.horizon}`} className="flex flex-wrap items-center gap-3">
                  <VerdictBadge v={s.verdict} /> <SymbolLink s={s.symbol} /> <span className="text-xs text-muted">{MODE_TEXT[s.mode]} · {HORIZON_TEXT[s.horizon]}</span> <ProbBar p={s.probs} compact />
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Sin señales alcistas ni bajistas. El sistema no opera cuando el modelo no ha demostrado ventaja fuera de muestra o el beneficio/riesgo no compensa.</p>}
        </Section>

        <Section title="Alertas de riesgo">
          {risk.length ? (
            <ul className="space-y-2 text-sm">
              {risk.map((a) => <li key={a.id}><span className="text-warn">⚠ {a.title}</span><div className="text-xs text-muted">{a.lines.join(' · ')}</div></li>)}
            </ul>
          ) : <p className="text-sm text-muted">Sin alertas de alta prioridad.</p>}
        </Section>
      </div>

      <Section title="Rendimiento del sistema" note="Fuera de muestra (walk-forward) y en vivo (bitácora de predicciones registradas antes del resultado).">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Habilidad POST 5 sesiones" value={bt?.prob ? signed(bt.prob.skill, 2) : '—'} sub="vs. baseline de frecuencias (log loss)" tone={bt?.prob ? (bt.prob.skill > 0.005 ? 'up' : 'warn') : undefined} />
          <Kpi label="Modelo: esperanza por operación" value={model?.expectancy != null ? signed(model.expectancy, 2) : '—'} sub={model ? `${model.trades} operaciones, neto de costos` : ''} />
          <Kpi label="Predicciones en bitácora" value={snap.live.predictions} sub={`${snap.live.resolved} resueltas válidas${snap.live.excludedLate ? ` · ${snap.live.excludedLate} excluidas (registradas tarde)` : ''} · cadena ${snap.live.chainOk ? 'íntegra' : 'ROTA'}`} tone={snap.live.chainOk ? undefined : 'down'} />
          <Kpi label="Acierto en vivo" value={pct(snap.live.hitRate, 0)} sub={snap.live.brier != null ? `Brier ${snap.live.brier.toFixed(3)}` : 'aún sin resultados'} />
        </div>
      </Section>
    </>
  );
}
