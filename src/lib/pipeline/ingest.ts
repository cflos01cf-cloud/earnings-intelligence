/**
 * Ingesta diaria. Cada proveedor es opcional e independiente: si falta su llave o falla, se registra
 * su estado real y el resto sigue. Nada se sustituye con datos inventados.
 */
import type { Bar, Company, ConsensusSnapshot, EarningsEvent, PriceSeries, QuarterFundamentals } from '../types';
import { KEYS, type JsonStore } from '../store';
import { EdgarClient, formerCikCandidates, mergeCompanyFacts, parseCompanyFacts, parseEarningsReleases, sameEntity, type EarningsRelease } from '../providers/edgar';
import { AlphaVantageClient, parseAvEarnings } from '../providers/alphavantage';
import { FinnhubClient, parseFhCalendar } from '../providers/finnhub';
import { TwelveDataClient } from '../providers/twelvedata';
import { providerSymbol } from '../universe/normalize';
import { MARKET_BENCHMARK } from '../universe/seed';
import type { UniverseRegistry } from '../types';

export type ProviderName = 'SEC EDGAR' | 'Alpha Vantage' | 'Finnhub' | 'TwelveData' | 'GBM (Netlify Blobs)';

export interface ProviderStatus {
  provider: ProviderName;
  status: 'OK' | 'PARTIAL' | 'ERROR' | 'NOT_CONFIGURED' | 'SKIPPED';
  checkedAt: string;
  lastSuccess: string | null;
  detail: string;
  calls: number;
}

export interface EdgarRaw { fetchedAt: string; cik: string; quarters: QuarterFundamentals[]; releases: EarningsRelease[] }
export interface AvRaw { fetchedAt: string; events: EarningsEvent[] }
export interface CalendarRaw { fetchedAt: string; asOf: string; events: EarningsEvent[] }
export interface Budget { date: string; alphavantage: number }

const DAY = 86_400_000;
const today = (now: Date) => now.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export interface IngestDeps {
  store: JsonStore;
  env: Record<string, string | undefined>;
  now?: Date;
  log?: (s: string) => void;
  clients?: { edgar?: EdgarClient | null; av?: AlphaVantageClient | null; fh?: FinnhubClient | null; td?: TwelveDataClient | null };
}

function prevStatus(prev: ProviderStatus[] | null, p: ProviderName): string | null {
  return prev?.find((x) => x.provider === p)?.lastSuccess ?? null;
}

export async function ingest(registry: UniverseRegistry, scope: Company[], d: IngestDeps): Promise<{ statuses: ProviderStatus[]; registry: UniverseRegistry }> {
  const now = d.now ?? new Date();
  const iso = now.toISOString();
  const day = today(now);
  const log = d.log ?? (() => {});
  const env = d.env;
  const prev = await d.store.get<ProviderStatus[]>('meta/providers');
  const statuses: ProviderStatus[] = [];
  const mk = (provider: ProviderName, status: ProviderStatus['status'], detail: string, calls: number): ProviderStatus => ({ provider, status, detail, calls, checkedAt: iso, lastSuccess: status === 'OK' || status === 'PARTIAL' ? iso : prevStatus(prev, provider) });
  const universe = new Set(scope.map((c) => c.symbol));

  // ── Finnhub: calendario + instantánea de consenso ──
  const fh = d.clients?.fh !== undefined ? d.clients.fh : env.FINNHUB_API_KEY ? new FinnhubClient(env.FINNHUB_API_KEY) : null;
  if (!fh) statuses.push(mk('Finnhub', 'NOT_CONFIGURED', 'Falta FINNHUB_API_KEY: sin calendario ni consenso de ingresos.', 0));
  else {
    // Una consulta por símbolo: la consulta global se trunca a ~1,500 filas.
    const from = addDays(day, -120);
    const to = addDays(day, 90);
    const snapshots: ConsensusSnapshot[] = [];
    const events: EarningsEvent[] = [];
    const errors: string[] = [];
    let calls = 0;
    for (const c of scope) {
      const r = await fh.calendar(from, to, c.symbol);
      calls++;
      if (!r.ok || !r.data?.earningsCalendar) {
        errors.push(`${c.symbol}: HTTP ${r.status}`);
        if (r.status === 401 || r.status === 403) break;
        continue;
      }
      const parsed = parseFhCalendar(r.data, universe, day, iso);
      snapshots.push(...parsed.snapshots);
      events.push(...parsed.events);
    }
    if (events.length || !errors.length) {
      await d.store.put(KEYS.consensus(day), snapshots);
      await d.store.put(KEYS.raw('finnhub', 'calendar'), { fetchedAt: iso, asOf: day, events } satisfies CalendarRaw);
    }
    const status = errors.length ? (events.length ? 'PARTIAL' : 'ERROR') : 'OK';
    statuses.push(mk('Finnhub', status, `${events.length} reportes del universo entre ${from} y ${to}.${errors.length ? ` Problemas: ${errors.slice(0, 5).join('; ')}` : ''}`, calls));
  }
  const cal = await d.store.get<CalendarRaw>(KEYS.raw('finnhub', 'calendar'));

  // ── SEC EDGAR: CIK, cifras XBRL y 8-K de resultados ──
  const edgar = d.clients?.edgar !== undefined ? d.clients.edgar : env.SEC_CONTACT_EMAIL ? new EdgarClient(env.SEC_CONTACT_EMAIL) : null;
  if (!edgar) statuses.push(mk('SEC EDGAR', 'NOT_CONFIGURED', 'Falta SEC_CONTACT_EMAIL (la SEC exige un contacto en el User-Agent).', 0));
  else {
    let calls = 0;
    const errors: string[] = [];
    let refreshed = 0;
    try {
      const needCik = scope.filter((c) => !c.cik && c.coverage === 'US_SEC');
      if (needCik.length) {
        const map = await edgar.tickerMap();
        calls++;
        for (const c of needCik) {
          const hit = map.get(providerSymbol(c.symbol, 'sec'));
          const reg = registry.companies.find((x) => x.symbol === c.symbol);
          if (hit && reg) {
            reg.cik = hit.cik;
            c.cik = hit.cik;
          } else errors.push(`${c.symbol}: sin CIK en la SEC`);
        }
      }
      for (const c of scope.filter((x) => x.cik && x.coverage === 'US_SEC')) {
        const raw = await d.store.get<EdgarRaw>(KEYS.raw('edgar', c.symbol));
        const age = raw ? (now.getTime() - Date.parse(raw.fetchedAt)) / DAY : Infinity;
        const recentReport = (cal?.events ?? []).some((e) => e.symbol === c.symbol && e.reportDate <= day && e.reportDate >= addDays(day, -50));
        if (!(age >= 7 || (recentReport && age >= 1))) continue;
        const [facts, subs] = [await edgar.companyFacts(c.cik!), await edgar.submissions(c.cik!)];
        calls += 2;
        if (!facts.ok || !facts.data) {
          errors.push(`${c.symbol}: companyfacts HTTP ${facts.status}`);
          continue;
        }
        let cf = facts.data;
        let extra = '';
        let oldCik: string | null = null;
        // Pocos trimestres: posible cambio de CIK. Se busca la historia bajo el CIK anterior (misma entidad).
        if (parseCompanyFacts(cf, c.symbol, iso).length < 8) {
          for (const old of formerCikCandidates(cf, c.cik!)) {
            const f2 = await edgar.companyFacts(old);
            calls++;
            if (f2.ok && f2.data && sameEntity(f2.data.entityName, cf.entityName)) {
              cf = mergeCompanyFacts(cf, f2.data);
              extra = ` (incluye historia del CIK anterior ${old})`;
              oldCik = old;
              break;
            }
          }
        }
        const quarters = parseCompanyFacts(cf, c.symbol, iso);
        let releases = subs.ok && subs.data ? parseEarningsReleases(subs.data, c.cik!) : raw?.releases ?? [];
        if (oldCik) {
          const s2 = await edgar.submissions(oldCik);
          calls++;
          if (s2.ok && s2.data) releases = [...parseEarningsReleases(s2.data, oldCik), ...releases].sort((a, b) => a.date.localeCompare(b.date));
        }
        await d.store.put(KEYS.raw('edgar', c.symbol), { fetchedAt: iso, cik: c.cik!, quarters, releases } satisfies EdgarRaw);
        refreshed++;
        log(`EDGAR ${c.symbol}: ${quarters.length} trimestres, ${releases.length} comunicados 8-K 2.02${extra}`);
      }
      statuses.push(mk('SEC EDGAR', errors.length ? 'PARTIAL' : 'OK', `${refreshed} empresas actualizadas.${errors.length ? ` Problemas: ${errors.slice(0, 5).join('; ')}` : ''}`, calls));
    } catch (e) {
      statuses.push(mk('SEC EDGAR', 'ERROR', (e as Error).message, calls));
    }
  }

  // ── Alpha Vantage: historia de EPS real vs. consenso, con presupuesto diario ──
  const av = d.clients?.av !== undefined ? d.clients.av : env.ALPHAVANTAGE_API_KEY ? new AlphaVantageClient(env.ALPHAVANTAGE_API_KEY, Number(env.ALPHAVANTAGE_RATE_PER_MIN || 5)) : null;
  if (!av) statuses.push(mk('Alpha Vantage', 'NOT_CONFIGURED', 'Falta ALPHAVANTAGE_API_KEY: sin historia de consenso de EPS.', 0));
  else {
    const limit = Number(env.ALPHAVANTAGE_DAILY_LIMIT || 20);
    const b0 = await d.store.get<Budget>(KEYS.budget);
    const budget: Budget = b0?.date === day ? b0 : { date: day, alphavantage: 0 };
    const queue: { c: Company; prio: number }[] = [];
    for (const c of scope) {
      const raw = await d.store.get<AvRaw>(KEYS.raw('av', c.symbol));
      if (!raw) {
        queue.push({ c, prio: 0 });
        continue;
      }
      const last = raw.fetchedAt.slice(0, 10);
      const reportedSince = (cal?.events ?? []).some((e) => e.symbol === c.symbol && e.reportDate >= last && e.reportDate < day);
      const age = (now.getTime() - Date.parse(raw.fetchedAt)) / DAY;
      if (reportedSince) queue.push({ c, prio: 1 });
      else if (age > 30) queue.push({ c, prio: 2 + age / 1000 });
    }
    queue.sort((a, b) => a.prio - b.prio);
    let calls = 0;
    let ok = 0;
    let stopReason = '';
    for (const { c } of queue) {
      if (budget.alphavantage >= limit) {
        stopReason = `presupuesto diario agotado (${limit})`;
        break;
      }
      const r = await av.earnings(c.symbol);
      calls += r.calls;
      budget.alphavantage += r.calls;
      if (r.status === 'RATE_LIMITED') {
        // Cuota diaria del proveedor agotada: no se insiste hoy.
        stopReason = `límite diario del proveedor: ${r.message?.slice(0, 120)}`;
        budget.alphavantage = Math.max(budget.alphavantage, limit);
        break;
      }
      if (r.status === 'BURST') {
        stopReason = `el proveedor pidió espaciar las consultas y no se recuperó tras reintentar: ${r.message?.slice(0, 120)}`;
        break;
      }
      if (r.status !== 'OK' || !r.data) {
        log(`Alpha Vantage ${c.symbol}: ${r.status} ${r.message ?? ''}`);
        continue;
      }
      await d.store.put(KEYS.raw('av', c.symbol), { fetchedAt: iso, events: parseAvEarnings(r.data, c.symbol, iso) } satisfies AvRaw);
      ok++;
    }
    await d.store.put(KEYS.budget, budget);
    const pending = queue.length - ok;
    statuses.push(mk('Alpha Vantage', ok || !queue.length ? (pending > 0 ? 'PARTIAL' : 'OK') : calls ? 'ERROR' : 'SKIPPED', `${ok} actualizadas, ${pending} en cola${stopReason ? ` (${stopReason})` : ''}. Usadas hoy: ${budget.alphavantage}/${limit}.`, calls));
  }

  // ── TwelveData: velas diarias del universo + S&P 500 + ETFs sectoriales ──
  const td = d.clients?.td !== undefined ? d.clients.td : env.TWELVEDATA_API_KEY ? new TwelveDataClient(env.TWELVEDATA_API_KEY, Number(env.TWELVEDATA_RATE_PER_MIN || 8)) : null;
  if (!td) statuses.push(mk('TwelveData', 'NOT_CONFIGURED', 'Falta TWELVEDATA_API_KEY: sin precios no hay reacciones ni predicciones.', 0));
  else {
    const symbols = [...new Set([MARKET_BENCHMARK, ...scope.map((c) => c.symbol), ...scope.map((c) => c.sectorEtf).filter((x): x is string => !!x)])];
    let calls = 0;
    const errors: string[] = [];
    let updated = 0;
    for (const s of symbols) {
      const prevS = await d.store.get<PriceSeries>(KEYS.raw('prices', s));
      if (prevS && prevS.prov.fetchedAt.slice(0, 10) === day) continue;
      const r = await td.daily(s, prevS ? 40 : 5000);
      calls++;
      if (r.status !== 'OK' || !('series' in r) || !r.series) {
        errors.push(`${s}: ${r.status}${'message' in r && r.message ? ` ${r.message.slice(0, 80)}` : ''}`);
        if (r.status === 'RATE_LIMITED') break;
        continue;
      }
      const merged = prevS ? mergeBars(prevS, r.series) : { series: r.series, needFull: false };
      let series = merged.series;
      if (merged.needFull) {
        // Ajuste retroactivo (split/dividendo) detectado: se descarga la serie completa otra vez.
        const full = await td.daily(s, 5000);
        calls++;
        if (full.status === 'OK' && 'series' in full && full.series) series = full.series;
        log(`TwelveData ${s}: ajuste retroactivo detectado, serie completa re-descargada`);
      }
      await d.store.put(KEYS.raw('prices', s), series);
      updated++;
    }
    statuses.push(mk('TwelveData', errors.length ? (updated ? 'PARTIAL' : 'ERROR') : 'OK', `${updated} series actualizadas de ${symbols.length}.${errors.length ? ` Problemas: ${errors.slice(0, 5).join('; ')}` : ''}`, calls));
  }

  await d.store.put('meta/providers', statuses);
  return { statuses, registry };
}

/** Une velas nuevas con las guardadas. Si en el traslape los cierres difieren > 0.5%, pide la serie completa. */
export function mergeBars(prev: PriceSeries, fresh: PriceSeries): { series: PriceSeries; needFull: boolean } {
  const by = new Map<string, Bar>(prev.bars.map((b) => [b.time, b]));
  let needFull = false;
  for (const b of fresh.bars) {
    const old = by.get(b.time);
    if (old && Math.abs(old.close / b.close - 1) > 0.005 && b.time < fresh.bars.at(-1)!.time) needFull = true;
    by.set(b.time, b);
  }
  return { series: { ...fresh, bars: [...by.values()].sort((a, b) => a.time.localeCompare(b.time)) }, needFull };
}

/** Lee todas las instantáneas de consenso guardadas. */
export async function readConsensus(store: JsonStore): Promise<ConsensusSnapshot[]> {
  const keys = (await store.list?.('consensus/')) ?? [];
  const out: ConsensusSnapshot[] = [];
  for (const k of keys) out.push(...((await store.get<ConsensusSnapshot[]>(k)) ?? []));
  return out;
}
