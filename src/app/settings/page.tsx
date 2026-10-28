import { loadRegistry, loadSnapshot } from '@/lib/load';
import { DemoBanner, Empty, Section, Stamp, pct } from '@/components/ui';
import { costsFromEnv, MIN_TRAIN_EVENTS, MODEL_VERSION } from '@/lib/config';
import { MIN_DOLLAR_VOLUME, MIN_EDGE, MIN_RR } from '@/lib/decision/engine';
import { GATE_MIN_N, GATE_MIN_SKILL } from '@/lib/backtest/walkforward';
import { ImportForm } from './import-form';

export const dynamic = 'force-dynamic';

const ENV: [string, string][] = [
  ['SEC_CONTACT_EMAIL', 'SEC EDGAR (contacto obligatorio)'],
  ['ALPHAVANTAGE_API_KEY', 'Alpha Vantage (consenso histórico de EPS)'],
  ['FINNHUB_API_KEY', 'Finnhub (calendario y consenso de ingresos)'],
  ['TWELVEDATA_API_KEY', 'TwelveData (precios diarios)'],
  ['GBM_NETLIFY_SITE_ID', 'GBM Weekly Trend: Site ID (universo y posiciones)'],
  ['GBM_BLOBS_TOKEN', 'GBM Weekly Trend: token de lectura'],
  ['NETLIFY_SITE_ID', 'Almacén propio (Netlify Blobs) desde GitHub Actions'],
  ['NETLIFY_BLOBS_TOKEN', 'Token del almacén propio'],
  ['APP_PASSWORD', 'Contraseña de la app'],
];

const STATUS_CLS: Record<string, string> = { OK: 'text-up', PARTIAL: 'text-warn', ERROR: 'text-down', NOT_CONFIGURED: 'text-muted', SKIPPED: 'text-muted' };

export default async function Settings() {
  const { snap, error, store } = await loadSnapshot();
  const reg = await loadRegistry();
  const costs = costsFromEnv();
  return (
    <>
      {snap ? <><DemoBanner snap={snap} /><Stamp snap={snap} /></> : <Empty error={error} store={store} />}
      <Section title="Proveedores de datos" note="Estado de la última corrida (probado, no supuesto). El cambio de proveedor solo toca su adaptador en src/lib/providers.">
        {snap?.providers.length ? (
          <div className="overflow-x-auto"><table className="tbl w-full text-sm">
            <thead><tr><th>Proveedor</th><th>Estado</th><th>Último éxito</th><th>Llamadas</th><th>Detalle</th></tr></thead>
            <tbody>{snap.providers.map((p) => <tr key={p.provider}><td>{p.provider}</td><td className={STATUS_CLS[p.status]}>{p.status}</td><td className="num text-xs">{p.lastSuccess?.slice(0, 16).replace('T', ' ') ?? '—'}</td><td className="num">{p.calls}</td><td className="whitespace-normal text-xs text-muted">{p.detail}</td></tr>)}</tbody>
          </table></div>
        ) : <p className="text-sm text-muted">Sin corridas registradas.</p>}
      </Section>

      <Section title="Credenciales en este servidor" note="Solo se indica si la variable existe. Los valores nunca se muestran ni salen del servidor. Las llaves de la corrida diaria viven en los secretos de GitHub Actions.">
        <table className="tbl w-full text-sm"><tbody>{ENV.map(([k, d]) => <tr key={k}><td className="font-mono text-xs">{k}</td><td className="text-xs text-muted">{d}</td><td className={process.env[k] ? 'text-up' : 'text-muted'}>{process.env[k] ? 'configurada' : 'no configurada'}</td></tr>)}</tbody></table>
      </Section>

      <Section title="Universo de activos" note={`Registro central: ${reg?.companies.length ?? 0} símbolos. Publicado en el almacén como universe/registry para que lo lean las otras apps.`}>
        {reg ? (
          <>
            <ul className="mb-4 space-y-1 text-xs">{reg.sources.map((s, i) => <li key={i}><span className={STATUS_CLS[s.status]}>{s.status}</span> · {s.origin} · {s.detail} ({s.count})</li>)}</ul>
            <div className="max-h-96 overflow-auto">
              <table className="tbl w-full text-sm">
                <thead><tr><th>Símbolo</th><th>Nombre</th><th>Bolsa</th><th>Moneda</th><th>Sector</th><th>Cobertura</th><th>CIK</th><th>Origen</th></tr></thead>
                <tbody>{reg.companies.map((c) => <tr key={c.symbol}><td>{c.symbol}</td><td className="text-xs">{c.name}</td><td className="text-xs">{c.exchange}</td><td className="text-xs">{c.currency}</td><td className="text-xs">{c.sector}</td><td className="text-xs">{c.coverage}</td><td className="num text-xs text-muted">{c.cik ?? '—'}</td><td className="text-xs text-muted">{c.origins.join(', ')}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        ) : <p className="text-sm text-muted">Sin registro todavía.</p>}
      </Section>

      <Section title="Importar símbolos" note="CSV (symbol, name, exchange, currency, sector), JSON (arreglo) o una lista. Se normalizan (BRK-B → BRK.B) y se deduplican.">
        <ImportForm />
      </Section>

      <Section title="Umbrales y costos" note="Fijados antes de entrenar. Los costos se cambian con variables de entorno (COST_*).">
        <table className="tbl text-sm"><tbody>
          <tr><td>Versión del modelo</td><td className="num">{MODEL_VERSION}</td></tr>
          <tr><td>Comisión GBM por lado (+ IVA {costs.vatPct}%)</td><td className="num">{costs.commissionPct}%</td></tr>
          <tr><td>Deslizamiento por lado / spread</td><td className="num">{costs.slippagePct}% / {costs.spreadPct}%</td></tr>
          <tr><td>Movimiento lateral</td><td>banda = max(costo ida y vuelta, ½·σ diaria previa·√h)</td></tr>
          <tr><td>Mínimo de eventos para el modelo</td><td className="num">{MIN_TRAIN_EVENTS}</td></tr>
          <tr><td>Habilidad mínima para operar</td><td className="num">&gt; {GATE_MIN_SKILL} con ≥ {GATE_MIN_N} eventos fuera de muestra</td></tr>
          <tr><td>Ventaja mínima P(subida) − P(bajada)</td><td className="num">{pct(MIN_EDGE, 0)}</td></tr>
          <tr><td>Beneficio/riesgo mínimo</td><td className="num">{MIN_RR}</td></tr>
          <tr><td>Liquidez mínima (promedio 20 días)</td><td className="num">{(MIN_DOLLAR_VOLUME / 1e6).toFixed(0)} M USD</td></tr>
        </tbody></table>
      </Section>

      <Section title="Alertas" note="Las envía el Global Quant Hub por su bot de Telegram (@globalquanthub_bot), con su deduplicación y registro de envíos. Este motor solo publica alertas candidatas en el snapshot.">
        {snap?.alerts.length ? <ul className="space-y-1 text-xs">{snap.alerts.map((a) => <li key={a.id}><span className={a.priority === 'high' ? 'text-warn' : 'text-muted'}>{a.kind}</span> · {a.title}</li>)}</ul> : <p className="text-sm text-muted">Sin alertas candidatas en la última corrida.</p>}
      </Section>
    </>
  );
}
