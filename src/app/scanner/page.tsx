import Link from 'next/link';
import { loadSnapshot } from '@/lib/load';
import { DemoBanner, Empty, HORIZON_TEXT, MODE_TEXT, ProbBar, Section, Stamp, SymbolLink, VerdictBadge, num, pct } from '@/components/ui';
import type { Verdict } from '@/lib/types';

export const dynamic = 'force-dynamic';

const ORDER: Verdict[] = ['ALCISTA', 'BAJISTA', 'ESPERAR', 'NEUTRAL', 'NO_OPERAR'];

export default async function Scanner({ searchParams }: { searchParams: Promise<{ v?: string; h?: string }> }) {
  const sp = await searchParams;
  const { snap, error, store } = await loadSnapshot();
  if (!snap) return <Empty error={error} store={store} />;
  const v = ORDER.includes(sp.v as Verdict) ? (sp.v as Verdict) : null;
  const h = ['1', '5', '20'].includes(sp.h ?? '') ? Number(sp.h) : null;
  const list = snap.signals.filter((s) => (!v || s.verdict === v) && (!h || s.horizon === h)).sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || b.quality - a.quality);
  const link = (nv: string | null, nh: number | null) => `/scanner?${new URLSearchParams({ ...(nv ? { v: nv } : {}), ...(nh ? { h: String(nh) } : {}) })}`;
  const chip = (active: boolean) => `rounded border px-2 py-0.5 text-xs ${active ? 'border-brass text-fg' : 'border-line text-muted hover:text-fg'}`;
  return (
    <>
      <DemoBanner snap={snap} />
      <Stamp snap={snap} />
      <Section title="Opportunity Scanner" note="Orden: calidad estadística = habilidad fuera de muestra × |P(subida) − P(bajada)| × beneficio/riesgo. Una probabilidad alta de un modelo sin habilidad demostrada vale cero.">
        <div className="mb-4 flex flex-wrap gap-2">
          <Link className={chip(!v)} href={link(null, h)}>Todas</Link>
          {ORDER.map((x) => <Link key={x} className={chip(v === x)} href={link(x, h)}>{x.replace('_', ' ').toLowerCase()}</Link>)}
          <span className="mx-2 border-l border-line" />
          <Link className={chip(!h)} href={link(v, null)}>Todos los horizontes</Link>
          {[1, 5, 20].map((x) => <Link key={x} className={chip(h === x)} href={link(v, x)}>{HORIZON_TEXT[x]}</Link>)}
        </div>
        {list.length ? (
          <div className="overflow-x-auto">
            <table className="tbl w-full text-sm">
              <thead><tr><th>Decisión</th><th>Empresa</th><th>Escenario</th><th>Reporte</th><th>Probabilidades</th><th className="text-right">Referencia</th><th className="text-right">Stop</th><th className="text-right">Objetivo</th><th className="text-right">B/R</th><th className="text-right">Calidad</th><th>Motivo</th></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={`${s.symbol}${s.mode}${s.horizon}${s.reportDate}`}>
                    <td><VerdictBadge v={s.verdict} /></td>
                    <td><SymbolLink s={s.symbol} /></td>
                    <td className="text-xs">{MODE_TEXT[s.mode]} · {HORIZON_TEXT[s.horizon]}</td>
                    <td className="num text-xs">{s.reportDate}</td>
                    <td><ProbBar p={s.probs} compact /></td>
                    <td className="num text-right text-xs">{num(s.referencePrice)}<div className="text-muted">{s.referenceTime}</div></td>
                    <td className="num text-right">{num(s.stop)}</td>
                    <td className="num text-right">{num(s.target)}</td>
                    <td className="num text-right">{num(s.rewardRisk)}</td>
                    <td className="num text-right">{s.quality.toFixed(1)}</td>
                    <td className="max-w-[320px] whitespace-normal text-xs text-muted">{s.reasons[0]}{s.verdict === 'ALCISTA' ? ` Costos ${pct(s.costsPct, 2)} incluidos.` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted">Sin señales con ese filtro.</p>}
      </Section>
    </>
  );
}
