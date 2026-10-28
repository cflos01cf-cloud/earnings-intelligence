// Prueba cada proveedor con UNA petición para AAPL y reporta el estado real (llave, plan, formato).
import { EdgarClient, parseCompanyFacts } from '../src/lib/providers/edgar';
import { AlphaVantageClient, parseAvEarnings } from '../src/lib/providers/alphavantage';
import { FinnhubClient } from '../src/lib/providers/finnhub';
import { TwelveDataClient } from '../src/lib/providers/twelvedata';
import { netlifyGbmReader } from '../src/lib/universe/gbm-source';

const env = process.env;
const out = (k: string, v: string) => console.log(`${k.padEnd(14)} ${v}`);
const iso = new Date().toISOString();
const day = iso.slice(0, 10);
if (env.SEC_CONTACT_EMAIL) {
  try {
    const e = new EdgarClient(env.SEC_CONTACT_EMAIL);
    const map = await e.tickerMap();
    const cik = map.get('AAPL')!.cik;
    const f = await e.companyFacts(cik);
    const q = f.data ? parseCompanyFacts(f.data, 'AAPL', iso) : [];
    const last = q.at(-1);
    out('SEC EDGAR', `OK · CIK ${cik} · ${q.length} trimestres · último ${last?.fiscalPeriod} ingresos ${last?.revenue} presentado ${last?.filed}`);
  } catch (err) { out('SEC EDGAR', `ERROR ${(err as Error).message}`); }
} else out('SEC EDGAR', 'sin SEC_CONTACT_EMAIL');
if (env.ALPHAVANTAGE_API_KEY) {
  const r = await new AlphaVantageClient(env.ALPHAVANTAGE_API_KEY).earnings('AAPL');
  const ev = r.data && r.status === 'OK' ? parseAvEarnings(r.data, 'AAPL', iso) : [];
  out('Alpha Vantage', `${r.status} ${r.message ?? ''} · ${ev.length} reportes · primero ${ev[0]?.reportDate} · último ${ev.at(-1)?.reportDate} EPS ${ev.at(-1)?.epsActual.value} vs ${ev.at(-1)?.epsEstimate.value}`);
} else out('Alpha Vantage', 'sin ALPHAVANTAGE_API_KEY');
if (env.FINNHUB_API_KEY) {
  const to = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const r = await new FinnhubClient(env.FINNHUB_API_KEY).calendar(day, to);
  const rows = r.data?.earningsCalendar ?? [];
  out('Finnhub', `HTTP ${r.status} · ${rows.length} reportes en 30 días · con consenso de ingresos: ${rows.filter((x) => x.revenueEstimate != null).length}`);
} else out('Finnhub', 'sin FINNHUB_API_KEY');
if (env.TWELVEDATA_API_KEY) {
  const r = await new TwelveDataClient(env.TWELVEDATA_API_KEY).daily('AAPL', 30);
  out('TwelveData', `${r.status} ${'message' in r && r.message ? r.message : ''} ${'series' in r && r.series ? `· último ${r.series.bars.at(-1)?.time} cierre ${r.series.bars.at(-1)?.close}` : ''}`);
} else out('TwelveData', 'sin TWELVEDATA_API_KEY');
const gbm = netlifyGbmReader(env);
if (gbm) {
  try {
    const r = (await gbm('latest/ranking.json')) as { assets?: unknown[]; generatedAt?: string } | null;
    out('GBM Blobs', r ? `OK · ${r.assets?.length ?? 0} activos · generado ${r.generatedAt}` : 'conectado, pero sin latest/ranking.json');
  } catch (err) { out('GBM Blobs', `ERROR ${(err as Error).message}`); }
} else out('GBM Blobs', 'sin GBM_NETLIFY_SITE_ID / GBM_BLOBS_TOKEN');
