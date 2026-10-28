import { loadSnapshot } from '@/lib/load';
import { Confidence, DemoBanner, Empty, HORIZON_TEXT, ProbBar, Section, Stamp, SymbolLink, signed } from '@/components/ui';
import type { Mode } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function Predictions() {
  const { snap, error, store } = await loadSnapshot();
  if (!snap) return <Empty error={error} store={store} />;
  const block = (mode: Mode, title: string, note: string) => {
    const cs = snap.companies.filter((c) => c.predictions.some((p) => p.mode === mode));
    return (
      <Section title={title} note={note}>
        {cs.length ? (
          <div className="overflow-x-auto">
            <table className="tbl w-full text-sm">
              <thead><tr><th>Empresa</th><th>Reporte</th><th>1 sesión</th><th>5 sesiones</th><th>20 sesiones</th><th>Escenarios a 5 (pesimista · base · optimista)</th></tr></thead>
              <tbody>
                {cs.map((c) => {
                  const ps = c.predictions.filter((p) => p.mode === mode);
                  const p5 = ps.find((p) => p.horizon === 5);
                  return (
                    <tr key={c.company.symbol}>
                      <td><SymbolLink s={c.company.symbol} /></td>
                      <td className="num text-xs">{ps[0].reportDate}<div className="text-muted">datos al {ps[0].decisionDate}</div></td>
                      {[1, 5, 20].map((h) => {
                        const p = ps.find((x) => x.horizon === h);
                        return <td key={h}>{p ? <><ProbBar p={p.probs} compact /><Confidence c={p.confidence} /></> : '—'}</td>;
                      })}
                      <td className="num text-xs">{p5?.interval ? `${signed(p5.interval[0])} · ${signed(p5.expectedReturn)} · ${signed(p5.interval[1])}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted">Sin predicciones de este tipo hoy.</p>}
      </Section>
    );
  };
  const skillRows = snap.backtests.map((b) => ({ k: `${b.mode} ${HORIZON_TEXT[b.horizon]}`, skill: b.prob?.skill ?? null, n: b.prob?.n ?? 0 }));
  return (
    <>
      <DemoBanner snap={snap} />
      <Stamp snap={snap} />
      <p className="mb-6 max-w-3xl text-sm text-muted">Las probabilidades son salidas del modelo, no hechos. La confianza depende de si el modelo superó al baseline de frecuencias <em>fuera de muestra</em> en ese escenario y horizonte: {skillRows.map((r) => `${r.k}: ${r.skill === null ? 'n/d' : signed(r.skill, 2)} (n=${r.n})`).join(' · ')}.</p>
      {block('POST', 'Después del reporte', 'Decisión al cierre del día de reacción (día 0), ya conocidas las cifras y la reacción inicial. Pesimista/optimista = percentiles 10 y 90; base = esperado.')}
      {block('PRE', 'Antes del reporte', 'Decisión al último cierre antes del anuncio. Atravesar el anuncio es riesgo binario: el motor solo lo permite con confianza ALTA.')}
    </>
  );
}
