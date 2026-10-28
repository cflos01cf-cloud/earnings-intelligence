/**
 * SEC EDGAR — fuente OFICIAL y gratuita.
 *   - company_tickers.json      → ticker → CIK
 *   - api/xbrl/companyfacts     → cifras XBRL de 10-Q/10-K (cada hecho con su fecha `filed`)
 *   - submissions               → 8-K con Item 2.02 (Results of Operations): fecha y HORA oficial del comunicado
 *
 * Punto en el tiempo: de cada periodo se toma el valor de la PRIMERA presentación (las reexpresiones
 * posteriores no existían en su momento). Las cifras de flujo que la SEC solo trae acumuladas (YTD)
 * se convierten a trimestre restando acumulados; esos campos quedan marcados en `derived`.
 *
 * La SEC exige un User-Agent con contacto y ≤10 peticiones por segundo.
 */
import type { QuarterFundamentals, ReportTime } from '../types';
import { getJson, RateLimiter, type Fetcher } from '../util/http';

export interface XbrlFact { start?: string; end: string; val: number; accn?: string; fy?: number; fp?: string; form?: string; filed: string; frame?: string }
export interface CompanyFacts { cik?: number; entityName?: string; facts?: Record<string, Record<string, { units?: Record<string, XbrlFact[]> }>> }

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

const CONCEPTS = {
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'RevenuesNetOfInterestExpense'],
  costOfRevenue: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['OperatingIncomeLoss'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  epsDiluted: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  sharesDiluted: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
  inventory: ['InventoryNet'],
  receivables: ['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  debt: ['LongTermDebt', 'LongTermDebtNoncurrent', 'DebtLongtermAndShorttermCombinedAmount'],
  currentAssets: ['AssetsCurrent'],
  currentLiabilities: ['LiabilitiesCurrent'],
} as const;

type Key = keyof typeof CONCEPTS;

interface PeriodVal { start?: string; end: string; val: number; filed: string; form?: string; accn?: string; fy?: number; fp?: string }

/** Para un concepto: valor de la primera presentación por (inicio, fin). */
function firstFiled(facts: XbrlFact[]): Map<string, PeriodVal> {
  const m = new Map<string, PeriodVal>();
  for (const f of facts) {
    if (!Number.isFinite(f.val) || !f.end || !f.filed) continue;
    if (f.form && !/^(10-Q|10-K|10-KT|10-Q\/A|10-K\/A)$/.test(f.form)) continue;
    const k = `${f.start ?? ''}|${f.end}`;
    const prev = m.get(k);
    if (!prev || f.filed < prev.filed) m.set(k, { start: f.start, end: f.end, val: f.val, filed: f.filed, form: f.form, accn: f.accn, fy: f.fy, fp: f.fp });
  }
  return m;
}

/**
 * Elige, entre los conceptos candidatos, el que tenga el dato más reciente (las empresas cambian de etiqueta
 * con los años). Los demás conceptos SOLO completan periodos que el vigente no cubre: nunca se mezclan dos
 * definiciones distintas para el mismo periodo.
 */
function conceptPeriods(cf: CompanyFacts, key: Key): Map<string, PeriodVal> {
  const gaap = cf.facts?.['us-gaap'] ?? {};
  const ranked: { facts: XbrlFact[]; last: string }[] = [];
  for (const name of CONCEPTS[key]) {
    const units = gaap[name]?.units;
    if (!units) continue;
    const facts = units.USD ?? units['USD/shares'] ?? units.shares ?? [];
    if (!facts.length) continue;
    ranked.push({ facts, last: facts.reduce((a, f) => (f.end > a ? f.end : a), '') });
  }
  ranked.sort((a, b) => b.last.localeCompare(a.last));
  const out = new Map<string, PeriodVal>();
  for (const r of ranked) for (const [k, v] of firstFiled(r.facts)) if (!out.has(k)) out.set(k, v);
  return out;
}

interface Quarter { start: string; end: string }

/** Trimestres definidos a partir de un concepto de flujo: directos (≈3 meses) y el Q4 derivado del anual. */
function quarterGrid(periods: Map<string, PeriodVal>): Quarter[] {
  const qs = new Map<string, Quarter>();
  const all = [...periods.values()].filter((p) => p.start);
  for (const p of all) {
    const d = days(p.start!, p.end);
    if (d >= 80 && d <= 100) qs.set(p.end, { start: p.start!, end: p.end });
  }
  // Q4: periodo anual (≈12 meses) cuyo final no tiene trimestre directo → inicia el día siguiente al fin del 9M.
  for (const p of all) {
    const d = days(p.start!, p.end);
    if (d < 350 || d > 380 || qs.has(p.end)) continue;
    const nine = all.find((x) => x.start === p.start && days(x.start!, x.end) >= 260 && days(x.start!, x.end) <= 285);
    if (nine) qs.set(p.end, { start: new Date(Date.parse(nine.end) + DAY).toISOString().slice(0, 10), end: p.end });
  }
  return [...qs.values()].sort((a, b) => a.end.localeCompare(b.end));
}

/** Valor del trimestre: directo, o acumulado(fin) − acumulado(fin del trimestre anterior) del mismo ejercicio. */
function quarterValue(periods: Map<string, PeriodVal>, q: Quarter): { val: number; filed: string; derived: boolean; src: PeriodVal } | null {
  const direct = periods.get(`${q.start}|${q.end}`);
  if (direct) return { val: direct.val, filed: direct.filed, derived: false, src: direct };
  // Buscar acumulado que termina en q.end y otro del mismo inicio que termina justo antes de q.start.
  const prevEnd = new Date(Date.parse(q.start) - DAY).toISOString().slice(0, 10);
  for (const ytd of periods.values()) {
    if (!ytd.start || ytd.end !== q.end || days(ytd.start, ytd.end) < 150) continue;
    const before = periods.get(`${ytd.start}|${prevEnd}`);
    if (before) return { val: ytd.val - before.val, filed: ytd.filed > before.filed ? ytd.filed : before.filed, derived: true, src: ytd };
  }
  return null;
}

function instantValue(periods: Map<string, PeriodVal>, end: string): PeriodVal | null {
  return periods.get(`|${end}`) ?? null;
}

/** Convierte companyfacts en trimestres punto-en-el-tiempo. Pura: se prueba con fixtures. */
export function parseCompanyFacts(cf: CompanyFacts, symbol: string, fetchedAt: string): QuarterFundamentals[] {
  const per = Object.fromEntries((Object.keys(CONCEPTS) as Key[]).map((k) => [k, conceptPeriods(cf, k)])) as Record<Key, Map<string, PeriodVal>>;
  const anchor = per.revenue.size ? per.revenue : per.netIncome;
  const grid = quarterGrid(anchor);
  const out: QuarterFundamentals[] = [];
  for (const q of grid) {
    const derived: string[] = [];
    const flow = (k: Key) => {
      const v = quarterValue(per[k], q);
      if (v?.derived) derived.push(k);
      return v;
    };
    const rev = flow('revenue');
    const ni = flow('netIncome');
    const main = rev ?? ni;
    if (!main) continue;
    const gp = flow('grossProfit');
    const cor = gp ? null : flow('costOfRevenue');
    const grossProfit = gp ? gp.val : rev && cor ? rev.val - cor.val : null;
    if (!gp && grossProfit !== null) derived.push('grossProfit');
    const inst = (k: Key) => instantValue(per[k], q.end)?.val ?? null;
    // Fecha de existencia del trimestre: la presentación más tardía entre las cifras principales usadas.
    const filed = [rev?.filed, ni?.filed].filter(Boolean).sort().pop()!;
    const fy = main.src.fy;
    const fp = main.src.fp;
    out.push({
      symbol,
      periodEnd: q.end,
      fiscalPeriod: fy && fp ? `FY${fy}-${fp === 'FY' ? 'Q4' : fp}` : q.end,
      filed,
      form: main.src.form ?? '10-Q',
      ...(main.src.accn ? { accession: main.src.accn } : {}),
      revenue: rev?.val ?? null,
      grossProfit,
      operatingIncome: flow('operatingIncome')?.val ?? null,
      netIncome: ni?.val ?? null,
      epsDiluted: flow('epsDiluted')?.val ?? null,
      operatingCashFlow: flow('operatingCashFlow')?.val ?? null,
      capex: flow('capex')?.val ?? null,
      sharesDiluted: flow('sharesDiluted')?.val ?? null,
      inventory: inst('inventory'),
      receivables: inst('receivables'),
      cash: inst('cash'),
      totalDebt: inst('debt'),
      currentAssets: inst('currentAssets'),
      currentLiabilities: inst('currentLiabilities'),
      derived: [...new Set(derived)],
      prov: {
        source: 'SEC EDGAR',
        url: cf.cik ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${String(cf.cik).padStart(10, '0')}&type=10-Q` : undefined,
        publishedAt: filed,
        fetchedAt,
        fiscalPeriod: fy && fp ? `FY${fy}-${fp}` : q.end,
        verification: 'OFFICIAL_FILING',
        ...(derived.length ? { note: `Derivado de acumulados: ${[...new Set(derived)].join(', ')}` } : {}),
      },
    });
  }
  return out;
}

// ───────────── 8-K Item 2.02: fecha y hora oficial del comunicado de resultados ─────────────

export interface Submissions { filings?: { recent?: { form: string[]; items: string[]; acceptanceDateTime: string[]; filingDate: string[]; accessionNumber: string[]; primaryDocument: string[] } } }

export interface EarningsRelease { date: string; acceptedAt: string; reportTime: ReportTime; url: string }

/** Hora de Nueva York (con horario de verano) de un instante UTC. */
export function nyClock(iso: string): { date: string; minutes: number } {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, minutes: Number(g('hour')) * 60 + Number(g('minute')) };
}

export function classifyNyTime(minutes: number): ReportTime {
  if (minutes < 9 * 60 + 30) return 'pre-market';
  if (minutes >= 16 * 60) return 'post-market';
  return 'during-market';
}

export function parseEarningsReleases(sub: Submissions, cik: string): EarningsRelease[] {
  const r = sub.filings?.recent;
  if (!r) return [];
  const out: EarningsRelease[] = [];
  for (let i = 0; i < r.form.length; i++) {
    if (!/^8-K/.test(r.form[i]) || !/\b2\.02\b/.test(r.items[i] ?? '')) continue;
    // acceptanceDateTime viene como "2026-07-30T16:31:07.000Z" (UTC).
    const ny = nyClock(r.acceptanceDateTime[i]);
    const acc = r.accessionNumber[i].replace(/-/g, '');
    out.push({
      date: ny.date,
      acceptedAt: r.acceptanceDateTime[i],
      reportTime: classifyNyTime(ny.minutes),
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/${r.primaryDocument[i]}`,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ───────────── Cliente ─────────────

export class EdgarClient {
  private readonly limiter = new RateLimiter(8, 1000);
  constructor(private readonly contactEmail: string, private readonly fetcher?: Fetcher) {
    if (!contactEmail) throw new Error('Falta SEC_CONTACT_EMAIL: la SEC exige identificar al cliente automatizado con un contacto.');
  }
  private headers() {
    return { 'User-Agent': `EarningsIntelligence/0.1 (${this.contactEmail})`, Accept: 'application/json' };
  }
  async tickerMap(): Promise<Map<string, { cik: string; title: string }>> {
    const r = await getJson<Record<string, { cik_str: number; ticker: string; title: string }>>('https://www.sec.gov/files/company_tickers.json', { headers: this.headers(), limiter: this.limiter, fetcher: this.fetcher });
    if (!r.ok || !r.data) throw new Error(`SEC company_tickers.json: HTTP ${r.status} ${r.error ?? ''}`);
    const m = new Map<string, { cik: string; title: string }>();
    for (const v of Object.values(r.data)) m.set(v.ticker.toUpperCase(), { cik: String(v.cik_str).padStart(10, '0'), title: v.title });
    return m;
  }
  async companyFacts(cik: string) {
    return getJson<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: this.headers(), limiter: this.limiter, fetcher: this.fetcher, timeoutMs: 60_000 });
  }
  async submissions(cik: string) {
    return getJson<Submissions>(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: this.headers(), limiter: this.limiter, fetcher: this.fetcher });
  }
}
