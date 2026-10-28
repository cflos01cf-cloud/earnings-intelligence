import { notFound } from 'next/navigation';
import { loadSnapshot } from '@/lib/load';
import { Bars } from '@/components/charts';
import { Confidence, DemoBanner, Empty, HORIZON_TEXT, MODE_TEXT, ProbBar, Prov, Section, Stamp, VerdictBadge, big, num, pct, signed } from '@/components/ui';
import type { ReportView } from '@/lib/pipeline/snapshot-types';

export const dynamic = 'force-dynamic';

function ReportTable({ r }: { r: ReportView }) {
  const row = (label: string, a: ReportView['epsActual'], e: ReportView['epsEstimate'], s: ReportView['eps'], fmt: (x: number | null) => string) => (
    <tr>
      <td>{label}</td>
      <td className="num text-right">{fmt(a.value)}<div><Prov p={a.prov} /></div></td>
      <td className="num text-right">{fmt(e.value)}<div><Prov p={e.prov} /></div></td>
      <td className="num text-right">{s.pct !== null ? signed(s.pct) : s.diff !== null ? `${s.diff >= 0 ? '+' : ''}${fmt(s.diff)}` : '—'}</td>
      <td className="text-xs">{s.verdict === 'UNAVAILABLE' ? <span className="text-muted">No disponible</span> : s.verdict === 'BEAT' ? <span className="text-up">Superó</span> : s.verdict === 'MISS' ? <span className="text-down">Incumplió</span> : 'En línea'}{s.note ? <div className="max-w-[240px] whitespace-normal text-muted">{s.note}</div> : null}</td>
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <table className="tbl w-full text-sm">
        <thead><tr><th></th><th className="text-right">Real (hecho)</th><th className="text-right">Consenso (estimación)</th><th className="text-right">Sorpresa</th><th>Veredicto</th></tr></thead>
        <tbody>
          {row('EPS', r.epsActual, r.epsEstimate, r.eps, (x) => num(x))}
          {row('Ingresos', r.revenueActual, r.revenueEstimate, r.revenue, big)}
        </tbody>
      </table>
    </div>
  );
}

export default async function Company({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const { snap, error, store } = await loadSnapshot();
  if (!snap) return <Empty error={error} store={store} />;
  const cv = snap.companies.find((c) => c.company.symbol === decodeURIComponent(symbol));
  if (!cv) notFound();
  const c = cv.company;
  const q = cv.quarters;
  const label = (fp: string, end: string) => {
    const m = fp.match(/^FY\d{2}(\d{2})-(Q\d)$/);
    return m ? `${m[2]} ${m[1]}` : end.slice(2, 7);
  };
  return (
    <>
      <DemoBanner snap={snap} />
      <Stamp snap={snap} />
      <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="wordmark text-2xl">{c.symbol}</h1>
        <span className="text-muted">{c.name}</span>
        <span className="text-xs text-muted">{c.exchange} · {c.sector}{c.sectorEtf ? ` (vs. ${c.sectorEtf})` : ''} · {c.currency} · origen: {c.origins.join(', ')}</span>
        {cv.lastPrice ? <span className="num ml-auto text-sm">{num(cv.lastPrice.close)} <span className="text-xs text-muted">al cierre del {cv.lastPrice.date} · {cv.lastPrice.source}</span></span> : null}
      </div>
      {cv.dataNotes.length ? <ul className="mb-6 space-y-1 text-xs text-warn">{cv.dataNotes.map((n) => <li key={n}>⚠ {n}</li>)}</ul> : null}

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title={cv.lastReport ? `Último reporte · ${cv.lastReport.reportDate}` : 'Último reporte'} note={cv.lastReport ? `Hora: ${cv.lastReport.reportTime} (${cv.lastReport.reportTimeSource}).` : undefined}>
          {cv.lastReport ? (
            <>
              <ReportTable r={cv.lastReport} />
              {cv.lastReport.releaseUrl ? <a href={cv.lastReport.releaseUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-info hover:underline">Comunicado oficial (SEC 8-K, Item 2.02) →</a> : null}
            </>
          ) : <p className="text-sm text-muted">Sin reportes con datos.</p>}
        </Section>
        <Section title={cv.upcoming ? `Próximo reporte · ${cv.upcoming.reportDate}` : 'Próximo reporte'} note={cv.upcoming ? `${cv.upcoming.daysTo} días · ${cv.upcoming.reportTime} (${cv.upcoming.reportTimeSource})` : undefined}>
          {cv.upcoming ? <ReportTable r={cv.upcoming} /> : <p className="text-sm text-muted">Sin fecha confirmada.</p>}
        </Section>
      </div>

      <Section title="Predicciones" note="Probabilidades del modelo (no hechos). Subida/bajada/lateral se definen con una banda de max(costos, ½·σ·√h) fijada antes del resultado.">
        {cv.predictions.length ? (
          <div className="overflow-x-auto">
            <table className="tbl w-full text-sm">
              <thead><tr><th>Escenario</th><th>Horizonte</th><th>Probabilidades</th><th className="text-right">Esperado</th><th className="text-right">Intervalo 10–90%</th><th>Confianza</th><th>Decisión</th></tr></thead>
              <tbody>
                {cv.predictions.map((p) => {
                  const s = cv.signals.find((x) => x.mode === p.mode && x.horizon === p.horizon && x.reportDate === p.reportDate);
                  return (
                    <tr key={p.id}>
                      <td className="text-xs">{MODE_TEXT[p.mode]}<div className="text-muted">decide {p.decisionDate}</div></td>
                      <td className="text-xs">{HORIZON_TEXT[p.horizon]}</td>
                      <td><ProbBar p={p.probs} /></td>
                      <td className="num text-right">{signed(p.expectedReturn)}</td>
                      <td className="num text-right text-xs">{p.interval ? `${signed(p.interval[0])} a ${signed(p.interval[1])}` : '—'}</td>
                      <td><Confidence c={p.confidence} />{p.insufficientReason ? <div className="max-w-[220px] whitespace-normal text-[11px] text-muted">{p.insufficientReason}</div> : null}</td>
                      <td>{s ? <VerdictBadge v={s.verdict} /> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted">Sin predicción: no hay reporte próximo en 30 días ni reporte reciente.</p>}
        {cv.signals.filter((s) => s.horizon === 5).map((s) => (
          <div key={`${s.mode}`} className="mt-4 rounded border border-line bg-panel p-4 text-sm">
            <div className="mb-2 flex flex-wrap items-center gap-3"><VerdictBadge v={s.verdict} /><span className="text-muted">{MODE_TEXT[s.mode]} · 5 sesiones</span></div>
            <ul className="mb-2 list-disc pl-5 text-xs">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            <div className="grid gap-3 text-xs md:grid-cols-3">
              <div><div className="text-muted">Catalizadores</div>{s.catalysts.length ? s.catalysts.join(' · ') : '—'}</div>
              <div><div className="text-muted">Riesgos</div>{s.risks.length ? s.risks.join(' · ') : '—'}</div>
              <div><div className="text-muted">Niveles</div>{s.entry ? `Entrada hipotética ${num(s.entry)} · stop ${num(s.stop)} · objetivo ${num(s.target)} · B/R ${num(s.rewardRisk)}` : 'Sin niveles (no hay señal operable).'} · costos {pct(s.costsPct, 2)}</div>
            </div>
            <div className="mt-2 text-xs"><span className="text-muted">Cancelar si: </span>{s.cancelIf.join(' · ')}</div>
          </div>
        ))}
      </Section>

      {(() => {
        const p = cv.predictions.find((x) => x.horizon === 5 && x.factors.length);
        return p ? (
          <Section title="Factores que explican la predicción" note={`${MODE_TEXT[p.mode]}, 5 sesiones. Contribución al logit de subida menos el de bajada (variables estandarizadas).`}>
            <ul className="space-y-1 text-sm">
              {p.factors.map((f, _i, all) => {
                const maxAbs = Math.max(...all.map((x) => Math.abs(x.contribution)), 1e-9);
                const w = (Math.abs(f.contribution) / maxAbs) * 100;
                return (
                  <li key={f.feature} className="grid grid-cols-[minmax(0,1fr)_200px_60px] items-center gap-3">
                    <span className="truncate">{f.label}</span>
                    <span className="relative h-2 rounded-sm bg-line/40"><span className="absolute top-0 h-2 rounded-sm" style={{ left: f.contribution >= 0 ? '50%' : `${50 - w / 2}%`, width: `${w / 2}%`, background: f.contribution >= 0 ? 'var(--up)' : 'var(--down)' }} /></span>
                    <span className={`num text-right text-xs ${f.contribution >= 0 ? 'text-up' : 'text-down'}`}>{f.contribution >= 0 ? '▲' : '▼'} {Math.abs(f.contribution).toFixed(2)}</span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 text-xs"><span className="text-muted">Invalidación: </span>{p.invalidation.join(' · ')}</div>
          </Section>
        ) : null;
      })()}

      {cv.score ? (
        <Section title={`Earnings Score: ${cv.score.total === null ? '—' : cv.score.total.toFixed(0)} / 100`} note={`${cv.score.method}${cv.score.missing.length ? ` Faltan: ${cv.score.missing.join(', ')}.` : ''}`}>
          <table className="tbl w-full text-sm">
            <thead><tr><th>Componente</th><th className="text-right">Puntos</th><th className="text-right">Peso</th><th>Detalle</th></tr></thead>
            <tbody>
              {cv.score.components.map((k) => (
                <tr key={k.key}>
                  <td>{k.label}</td>
                  <td className="num text-right">{k.score === null ? '—' : k.score.toFixed(0)}</td>
                  <td className="num text-right">{k.score === null ? '—' : pct(k.weight, 0)}</td>
                  <td className="whitespace-normal text-xs text-muted">{k.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      <Section title="Últimos trimestres (SEC EDGAR)" note="Cifras oficiales del 10-Q/10-K, tomadas de la primera presentación. Cada trimestre cuenta para el modelo solo desde su fecha de presentación.">
        {q.length ? (
          <>
            <div className="mb-4 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              <Bars title="Ingresos" data={q.map((x) => ({ label: label(x.fiscalPeriod, x.periodEnd), value: x.revenue }))} format="big" />
              <Bars title="EPS diluido (GAAP)" data={q.map((x) => ({ label: label(x.fiscalPeriod, x.periodEnd), value: x.epsDiluted }))} format="num" />
              <Bars title="Margen operativo" data={q.map((x) => ({ label: label(x.fiscalPeriod, x.periodEnd), value: x.operatingMargin }))} format="pct" />
              <Bars title="Flujo libre (operativo − capex)" data={q.map((x) => ({ label: label(x.fiscalPeriod, x.periodEnd), value: x.freeCashFlow }))} format="big" />
            </div>
            <div className="overflow-x-auto">
              <table className="tbl w-full text-sm">
                <thead><tr><th>Periodo</th><th>Presentado</th><th className="text-right">Ingresos</th><th className="text-right">Interanual</th><th className="text-right">M. bruto</th><th className="text-right">M. operativo</th><th className="text-right">Δ m. op. (pp)</th><th className="text-right">M. neto</th><th className="text-right">Flujo libre</th><th className="text-right">Dilución</th><th>Alertas de calidad</th></tr></thead>
                <tbody>
                  {[...q].reverse().map((x) => (
                    <tr key={x.periodEnd}>
                      <td>{x.fiscalPeriod}</td>
                      <td className="num text-xs text-muted">{x.filed}</td>
                      <td className="num text-right">{big(x.revenue)}</td>
                      <td className="num text-right">{signed(x.revenueYoY)}</td>
                      <td className="num text-right">{pct(x.grossMargin)}</td>
                      <td className="num text-right">{pct(x.operatingMargin)}</td>
                      <td className="num text-right">{x.operatingMarginChgPp === null ? '—' : x.operatingMarginChgPp.toFixed(1)}</td>
                      <td className="num text-right">{pct(x.netMargin)}</td>
                      <td className="num text-right">{big(x.freeCashFlow)}</td>
                      <td className="num text-right">{signed(x.dilutionYoY)}</td>
                      <td className="whitespace-normal text-xs text-warn">{x.flags.join(' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">Origen del crecimiento (volumen, precio, adquisiciones, partidas extraordinarias): las cifras XBRL no lo separan; se marca lo detectable (utilidad sin respaldo de caja, inventarios y cuentas por cobrar). El desglose fino requiere leer el comunicado.</p>
          </>
        ) : <p className="text-sm text-muted">Sin cifras de EDGAR para esta emisora.</p>}
      </Section>

      <Section title="Reacción en reportes anteriores" note="PRE 1 sesión = reacción inicial (cierre previo → cierre del día 0). POST = deriva desde el cierre del día 0. «Anormal» = menos el S&P 500 en las mismas fechas.">
        {cv.reactions.length ? (
          <>
            {cv.reactionSummary ? <p className="mb-3 text-sm">Movimiento típico ±{pct(cv.reactionSummary.meanAbsMove)} · superó el consenso de EPS {pct(cv.reactionSummary.beatRate, 0)} de las veces · cayó pese a superar: {cv.reactionSummary.fellDespiteBeat} · subió pese a incumplir: {cv.reactionSummary.upAfterMiss}</p> : null}
            <div className="mb-4 max-w-md"><Bars title="Reacción inicial anormal por reporte" data={cv.reactions.map((r) => ({ label: r.reportDate.slice(2, 7), value: r.react1Abn ?? r.react1 }))} format="pct" /></div>
            <div className="overflow-x-auto">
              <table className="tbl w-full text-sm">
                <thead><tr><th>Reporte</th><th>EPS</th><th className="text-right">Sorpresa EPS</th><th className="text-right">Sorpresa ingresos</th><th className="text-right">Reacción</th><th className="text-right">Anormal</th><th className="text-right">+5 anormal</th><th className="text-right">+20 anormal</th><th className="text-right">Volumen ×</th><th className="text-right">σ previa</th></tr></thead>
                <tbody>
                  {[...cv.reactions].reverse().map((r) => (
                    <tr key={r.reportDate}>
                      <td className="num">{r.reportDate} <span className="text-xs text-muted">{r.reportTime}</span></td>
                      <td className="text-xs">{r.epsVerdict}{r.fellDespiteBeat ? <span className="ml-1 text-warn" title="Superó el consenso y aun así cayó">⚠ cayó</span> : null}</td>
                      <td className="num text-right">{signed(r.epsSurprisePct)}</td>
                      <td className="num text-right">{signed(r.revenueSurprisePct)}</td>
                      <td className="num text-right">{signed(r.react1)}</td>
                      <td className="num text-right">{signed(r.react1Abn)}</td>
                      <td className="num text-right">{signed(r.post5Abn)}</td>
                      <td className="num text-right">{signed(r.post20Abn)}</td>
                      <td className="num text-right">{num(r.abnormalVolume, 1)}</td>
                      <td className="num text-right">{pct(r.preVol, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <p className="text-sm text-muted">Sin reportes con precios alineados.</p>}
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Guidance"><p className="text-sm text-muted">{cv.guidance.note}</p></Section>
        <Section title="Noticias"><p className="text-sm text-muted">{cv.news.note}</p></Section>
      </div>
    </>
  );
}
