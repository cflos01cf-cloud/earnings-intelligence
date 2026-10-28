'use client';
/**
 * Gráficos SVG propios (sin dependencias). Reglas de la casa:
 *  - un solo eje Y; marcas delgadas; grilla tenue; texto en tintas de texto, nunca en el color de la serie;
 *  - leyenda con ≥ 2 series + etiqueta directa al final de cada línea; tooltip al pasar el cursor;
 *  - colores categóricos en orden fijo (--series-1…4), validados contra el fondo del panel.
 */
import { useMemo, useRef, useState } from 'react';

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
const fmtPct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;

function niceTicks(min: number, max: number, n = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-12; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

export type BarFormat = 'big' | 'pct' | 'num';
function formatter(f: BarFormat): (v: number) => string {
  if (f === 'pct') return (v) => `${(v * 100).toFixed(0)}%`;
  if (f === 'num') return (v) => v.toFixed(2);
  return (v) => {
    const a = Math.abs(v);
    return a >= 1e9 ? `${(v / 1e9).toFixed(1)} mil M` : a >= 1e6 ? `${(v / 1e6).toFixed(0)} M` : v.toFixed(0);
  };
}

/** Barras de una sola serie (con valores negativos), tooltip por barra. */
export function Bars({ data, format: fmtKey, height = 140, title }: { data: { label: string; value: number | null }[]; format: BarFormat; height?: number; title: string }) {
  const format = formatter(fmtKey);
  const W = 360;
  const H = height;
  const pad = { l: 44, r: 8, t: 8, b: 22 };
  const vals = data.map((d) => d.value).filter((v): v is number => v !== null);
  const [hover, setHover] = useState<number | null>(null);
  if (!vals.length) return <p className="text-xs text-muted">{title}: sin datos.</p>;
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const y = (v: number) => pad.t + ((max - v) / (max - min || 1)) * (H - pad.t - pad.b);
  const bw = (W - pad.l - pad.r) / data.length;
  const ticks = niceTicks(min, max);
  return (
    <figure>
      <figcaption className="mb-1 text-xs text-muted">{title}</figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={t === 0 ? 1 : 0.5} />
              <text x={pad.l - 4} y={y(t) + 3} textAnchor="end" fontSize="9" fill="var(--muted)">{format(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = pad.l + i * bw + 2;
            const v = d.value;
            const top = v === null ? y(0) : y(Math.max(0, v));
            const h = v === null ? 0 : Math.abs(y(v) - y(0));
            return (
              <g key={d.label} className="bar-hit" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
                {v !== null ? <rect className="bar-mark" x={x} y={top} width={Math.max(1, bw - 4)} height={Math.max(1, h)} rx={2} fill={v >= 0 ? 'var(--series-1)' : 'var(--down)'} /> : <text x={x + bw / 2 - 2} y={y(0) - 3} fontSize="9" textAnchor="middle" fill="var(--muted)">n/d</text>}
                <text x={pad.l + i * bw + bw / 2} y={H - 6} fontSize="8.5" textAnchor="middle" fill="var(--muted)">{d.label}</text>
              </g>
            );
          })}
        </svg>
        {hover !== null ? (
          <div className="pointer-events-none absolute right-1 top-0 rounded border border-line bg-ink px-2 py-1 text-[11px]">
            <span className="text-muted">{data[hover].label}: </span>
            <span className="num">{data[hover].value === null ? 'sin dato' : format(data[hover].value!)}</span>
          </div>
        ) : null}
      </div>
    </figure>
  );
}

/** Curvas de capital (valor 1 = inicio) de varias estrategias, eje único, crosshair + tooltip. */
export function Lines({ series, title, height = 220, percentFromOne = true }: { series: { name: string; points: { date: string; value: number }[] }[]; title: string; height?: number; percentFromOne?: boolean }) {
  const W = 720;
  const H = height;
  const pad = { l: 52, r: 150, t: 10, b: 24 };
  const ref = useRef<SVGSVGElement>(null);
  const [hx, setHx] = useState<number | null>(null);
  const live = series.filter((s) => s.points.length > 1).slice(0, 4);
  const dom = useMemo(() => {
    const all = live.flatMap((s) => s.points);
    if (!all.length) return null;
    const t0 = Math.min(...all.map((p) => Date.parse(p.date)));
    const t1 = Math.max(...all.map((p) => Date.parse(p.date)));
    const v0 = Math.min(...all.map((p) => p.value));
    const v1 = Math.max(...all.map((p) => p.value));
    return { t0, t1, v0, v1 };
  }, [live]);
  if (!dom) return <p className="text-xs text-muted">{title}: sin operaciones en el periodo.</p>;
  const x = (d: string) => pad.l + ((Date.parse(d) - dom.t0) / (dom.t1 - dom.t0 || 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((dom.v1 - v) / (dom.v1 - dom.v0 || 1)) * (H - pad.t - pad.b);
  const ticks = niceTicks(dom.v0, dom.v1);
  const fmt = (v: number) => (percentFromOne ? fmtPct(v - 1) : fmtPct(v));
  const years = [...new Set(live.flatMap((s) => s.points.map((p) => p.date.slice(0, 4))))];
  const at = (s: (typeof live)[number], px: number) => {
    let best = s.points[0];
    for (const p of s.points) if (Math.abs(x(p.date) - px) < Math.abs(x(best.date) - px)) best = p;
    return best;
  };
  return (
    <figure>
      <figcaption className="mb-2 text-xs text-muted">{title}</figcaption>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {live.map((s, i) => (
          <span key={s.name} className="inline-flex items-center gap-1.5"><span className="inline-block h-[2px] w-4" style={{ background: SERIES[i] }} />{s.name}</span>
        ))}
      </div>
      <div className="relative">
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}
          onMouseMove={(e) => {
            const r = ref.current!.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            setHx(px >= pad.l && px <= W - pad.r ? px : null);
          }}
          onMouseLeave={() => setHx(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={Math.abs(t - 1) < 1e-9 && percentFromOne ? 1 : 0.5} />
              <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted)">{fmt(t)}</text>
            </g>
          ))}
          {years.map((yr) => {
            const xx = x(`${yr}-01-01`);
            return xx >= pad.l && xx <= W - pad.r ? <text key={yr} x={xx} y={H - 6} fontSize="10" textAnchor="middle" fill="var(--muted)">{yr}</text> : null;
          })}
          {live.map((s, i) => (
            <g key={s.name}>
              <polyline fill="none" stroke={SERIES[i]} strokeWidth={2} strokeLinejoin="round" points={s.points.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')} />
              <text x={W - pad.r + 6} y={y(s.points.at(-1)!.value) + 3} fontSize="10" fill="var(--fg)">{s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name} {fmt(s.points.at(-1)!.value)}</text>
            </g>
          ))}
          {hx !== null ? (
            <g>
              <line x1={hx} x2={hx} y1={pad.t} y2={H - pad.b} stroke="var(--muted)" strokeWidth={0.75} strokeDasharray="3 3" />
              {live.map((s, i) => {
                const p = at(s, hx);
                return <circle key={s.name} cx={x(p.date)} cy={y(p.value)} r={4} fill={SERIES[i]} stroke="var(--panel)" strokeWidth={2} />;
              })}
            </g>
          ) : null}
        </svg>
        {hx !== null ? (
          <div className="pointer-events-none absolute left-14 top-2 rounded border border-line bg-ink px-2 py-1 text-[11px]">
            <div className="text-muted">{at(live[0], hx).date}</div>
            {live.map((s, i) => (
              <div key={s.name} className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: SERIES[i] }} /><span className="text-muted">{s.name}</span><span className="num ml-auto pl-3">{fmt(at(s, hx).value)}</span></div>
            ))}
          </div>
        ) : null}
      </div>
    </figure>
  );
}

/** Calibración: probabilidad predicha vs. frecuencia observada, con diagonal de referencia. */
export function Calibration({ bins, title }: { bins: { bin: string; predicted: number; observed: number; n: number }[]; title: string }) {
  const S = 220;
  const pad = 30;
  const sc = (v: number) => pad + v * (S - 2 * pad);
  const [hover, setHover] = useState<number | null>(null);
  const maxN = Math.max(1, ...bins.map((b) => b.n));
  return (
    <figure>
      <figcaption className="mb-1 text-xs text-muted">{title}</figcaption>
      <div className="relative w-full max-w-[280px]">
        <svg viewBox={`0 0 ${S} ${S}`} className="w-full" role="img" aria-label={title}>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={pad} x2={S - pad} y1={S - sc(t)} y2={S - sc(t)} stroke="var(--line)" strokeWidth={0.5} />
              <text x={pad - 4} y={S - sc(t) + 3} fontSize="8" textAnchor="end" fill="var(--muted)">{(t * 100).toFixed(0)}%</text>
              <text x={sc(t)} y={S - pad + 12} fontSize="8" textAnchor="middle" fill="var(--muted)">{(t * 100).toFixed(0)}%</text>
            </g>
          ))}
          <line x1={sc(0)} y1={S - sc(0)} x2={sc(1)} y2={S - sc(1)} stroke="var(--muted)" strokeDasharray="3 3" strokeWidth={0.75} />
          <polyline fill="none" stroke="var(--series-1)" strokeWidth={2} points={bins.map((b) => `${sc(b.predicted)},${S - sc(b.observed)}`).join(' ')} />
          {bins.map((b, i) => (
            <g key={b.bin} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <circle cx={sc(b.predicted)} cy={S - sc(b.observed)} r={10} fill="transparent" />
              <circle cx={sc(b.predicted)} cy={S - sc(b.observed)} r={3 + 4 * Math.sqrt(b.n / maxN)} fill="var(--series-1)" stroke="var(--panel)" strokeWidth={2} />
            </g>
          ))}
          <text x={S / 2} y={S - 4} fontSize="8.5" textAnchor="middle" fill="var(--muted)">P(subida) predicha</text>
        </svg>
        {hover !== null ? (
          <div className="pointer-events-none absolute right-0 top-0 rounded border border-line bg-ink px-2 py-1 text-[11px]">
            Rango {bins[hover].bin}: predicho {(bins[hover].predicted * 100).toFixed(0)}% · observado {(bins[hover].observed * 100).toFixed(0)}% · {bins[hover].n} eventos
          </div>
        ) : null}
      </div>
    </figure>
  );
}
