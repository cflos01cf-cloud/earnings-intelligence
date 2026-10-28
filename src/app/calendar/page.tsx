import { loadSnapshot } from '@/lib/load';
import { DemoBanner, Empty, Section, Stamp, SymbolLink, big, num } from '@/components/ui';

export const dynamic = 'force-dynamic';

const TIME: Record<string, string> = { 'pre-market': 'Antes de la apertura', 'post-market': 'Después del cierre', 'during-market': 'En horario', unknown: 'Hora no confirmada' };

function weekOf(d: string): string {
  const x = new Date(`${d}T00:00:00Z`);
  const wd = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - wd);
  return x.toISOString().slice(0, 10);
}

export default async function CalendarPage() {
  const { snap, error, store } = await loadSnapshot();
  if (!snap) return <Empty error={error} store={store} />;
  const weeks = new Map<string, typeof snap.calendar>();
  for (const c of snap.calendar) {
    const w = weekOf(c.reportDate);
    if (!weeks.has(w)) weeks.set(w, []);
    weeks.get(w)!.push(c);
  }
  return (
    <>
      <DemoBanner snap={snap} />
      <Stamp snap={snap} />
      <Section title="Calendario de resultados" note="Hora oficial del comunicado tomada del 8-K (Item 2.02) cuando existe; si no, la del proveedor. Volatilidad implícita: no disponible (sin fuente autorizada de opciones en el plan gratuito).">
        {!snap.calendar.length ? <p className="text-sm text-muted">Sin reportes en la ventana (−7 a +60 días). Requiere Finnhub o Alpha Vantage.</p> : null}
        {[...weeks].map(([w, items]) => (
          <div key={w} className="mb-6">
            <h3 className="mb-2 text-sm text-muted">Semana del {w}</h3>
            <div className="overflow-x-auto">
              <table className="tbl w-full text-sm">
                <thead><tr><th>Fecha</th><th>Empresa</th><th>Hora</th><th className="text-right">EPS esperado</th><th className="text-right">Ingresos esperados</th><th className="text-right">EPS real</th><th className="text-right">Ingresos reales</th><th>Vol. implícita</th><th>Estado</th></tr></thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={`${c.symbol}${c.reportDate}`}>
                      <td className="num">{c.reportDate}</td>
                      <td><SymbolLink s={c.symbol} /> <span className="text-xs text-muted">{c.name}</span></td>
                      <td className="text-xs" title={c.reportTimeSource}>{TIME[c.reportTime]}</td>
                      <td className="num text-right">{num(c.epsEstimate)}</td>
                      <td className="num text-right">{big(c.revenueEstimate)}</td>
                      <td className="num text-right">{num(c.epsActual)}</td>
                      <td className="num text-right">{big(c.revenueActual)}</td>
                      <td className="text-xs text-muted">n/d</td>
                      <td className="text-xs">{c.status === 'reported' ? <span className="text-up">Publicado</span> : c.dataComplete ? 'Pendiente' : <span className="text-warn">Datos incompletos</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Section>
    </>
  );
}
