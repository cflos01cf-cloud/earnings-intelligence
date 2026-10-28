import Link from 'next/link';
import type { Prediction, Probabilities, Provenance, Verdict } from '@/lib/types';
import type { EarningsSnapshot } from '@/lib/pipeline/snapshot-types';

export const pct = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`);
export const signed = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%`);
export const num = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }));
export function big(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1e12) return `${(x / 1e12).toFixed(2)} B`;
  if (a >= 1e9) return `${(x / 1e9).toFixed(2)} mil M`;
  if (a >= 1e6) return `${(x / 1e6).toFixed(1)} M`;
  return x.toFixed(0);
}

export function Section({ title, children, note, right }: { title: string; children: React.ReactNode; note?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {right}
      </div>
      {note ? <p className="-mt-2 mb-3 max-w-3xl text-sm text-muted">{note}</p> : null}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'up' | 'down' | 'warn' }) {
  const c = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : tone === 'warn' ? 'text-warn' : 'text-fg';
  return (
    <div className="rounded border border-line bg-panel px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`num mt-1 text-2xl font-semibold ${c}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

const VERDICT: Record<Verdict, { cls: string; text: string; icon: string }> = {
  ALCISTA: { cls: 'border-up/60 bg-up/10 text-up', text: 'Alcista', icon: '▲' },
  BAJISTA: { cls: 'border-down/60 bg-down/10 text-down', text: 'Bajista', icon: '▼' },
  NEUTRAL: { cls: 'border-info/50 bg-info/10 text-info', text: 'Neutral', icon: '◆' },
  ESPERAR: { cls: 'border-warn/60 bg-warn/10 text-warn', text: 'Esperar', icon: '⏸' },
  NO_OPERAR: { cls: 'border-line text-muted', text: 'No operar', icon: '✕' },
};
export function VerdictBadge({ v }: { v: Verdict }) {
  const s = VERDICT[v];
  return <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${s.cls}`}><span aria-hidden>{s.icon}</span>{s.text}</span>;
}

const CONF: Record<Prediction['confidence'], string> = { ALTA: 'text-up', MEDIA: 'text-info', BAJA: 'text-muted', EVIDENCIA_INSUFICIENTE: 'text-warn' };
export function Confidence({ c }: { c: Prediction['confidence'] }) {
  return <span className={`text-xs ${CONF[c]}`}>{c === 'EVIDENCIA_INSUFICIENTE' ? 'Evidencia insuficiente' : `Confianza ${c.toLowerCase()}`}</span>;
}

/** Barra apilada subida / lateral / bajada con etiquetas siempre visibles (no solo color). */
export function ProbBar({ p, compact }: { p: Probabilities | null; compact?: boolean }) {
  if (!p) return <span className="text-xs text-warn">Evidencia insuficiente</span>;
  const seg = (w: number, color: string, label: string) => (w > 0 ? <div title={`${label}: ${pct(w, 0)}`} style={{ width: `${w * 100}%`, background: color }} /> : null);
  return (
    <div className={compact ? 'w-36' : 'w-56'}>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-sm" role="img" aria-label={`Subida ${pct(p.up, 0)}, lateral ${pct(p.flat, 0)}, bajada ${pct(p.down, 0)}`}>
        {seg(p.up, 'var(--up)', 'Subida')}
        {seg(p.flat, 'var(--flat)', 'Lateral')}
        {seg(p.down, 'var(--down)', 'Bajada')}
      </div>
      <div className="num mt-1 flex justify-between text-[11px] text-muted">
        <span>▲ {pct(p.up, 0)}</span>
        <span>◆ {pct(p.flat, 0)}</span>
        <span>▼ {pct(p.down, 0)}</span>
      </div>
    </div>
  );
}

const VER_LABEL: Record<Provenance['verification'], { t: string; cls: string }> = {
  OFFICIAL_FILING: { t: 'Oficial', cls: 'text-up' },
  PROVIDER_ACTUAL: { t: 'Real (proveedor)', cls: 'text-info' },
  CONSENSUS: { t: 'Consenso', cls: 'text-brass' },
  MODEL: { t: 'Modelo', cls: 'text-info' },
  DERIVED: { t: 'Derivado', cls: 'text-muted' },
  SIMULATED: { t: 'SIMULADO', cls: 'text-down' },
  UNAVAILABLE: { t: 'No disponible', cls: 'text-muted' },
};
/** Etiqueta de procedencia: hecho, consenso, modelo o simulado, con fuente y fechas al pasar el cursor. */
export function Prov({ p }: { p: Provenance }) {
  const v = VER_LABEL[p.verification];
  const title = [`Fuente: ${p.source}`, p.publishedAt ? `Publicado: ${p.publishedAt}` : 'Fecha de publicación: no informada', `Consultado: ${p.fetchedAt.slice(0, 16).replace('T', ' ')}`, p.fiscalPeriod ? `Periodo: ${p.fiscalPeriod}` : '', p.note ?? ''].filter(Boolean).join('\n');
  const body = <span className={`text-[11px] ${v.cls}`} title={title}>{v.t} · {p.source}</span>;
  return p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">{body}</a> : body;
}

export function DemoBanner({ snap }: { snap: EarningsSnapshot }) {
  if (snap.dataMode !== 'demo') return null;
  return <div className="mb-4 rounded border border-down/60 bg-down/10 px-4 py-2 text-sm text-down">MODO DEMO — todos los datos de esta app son SINTÉTICOS (símbolos DEMO-*). No describen empresas reales.</div>;
}

export function Empty({ error, store }: { error: string | null; store: string }) {
  return (
    <div className="rounded border border-line bg-panel p-6 text-sm">
      <p className="mb-2 font-semibold">Todavía no hay snapshot publicado.</p>
      {error ? <p className="mb-2 text-down">Error al leer {store}: {error}</p> : <p className="mb-2 text-muted">Almacén: {store}.</p>}
      <p className="text-muted">Corre <code className="text-fg">npm run ci:daily</code> (o espera a la corrida de GitHub Actions). Para ver la app con datos sintéticos: <code className="text-fg">npm run demo:build</code> y <code className="text-fg">DATA_MODE=demo</code>.</p>
    </div>
  );
}

export function Stamp({ snap }: { snap: EarningsSnapshot }) {
  return <p className="mb-4 text-xs text-muted">Actualizado {snap.generatedAt.slice(0, 16).replace('T', ' ')} UTC · modelo {snap.modelVersion} · costo ida y vuelta {pct(snap.roundTrip, 2)}</p>;
}

export function SymbolLink({ s }: { s: string }) {
  return <Link href={`/company/${encodeURIComponent(s)}`} className="font-semibold text-fg hover:text-brass">{s}</Link>;
}

export const MODE_TEXT = { PRE: 'Antes del reporte', POST: 'Después del reporte' } as const;
export const HORIZON_TEXT: Record<number, string> = { 1: '1 sesión', 5: '5 sesiones', 20: '20 sesiones' };
