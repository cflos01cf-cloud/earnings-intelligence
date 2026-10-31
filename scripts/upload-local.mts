// Sube a Netlify Blobs (producción) todo lo descargado en tu PC (.data): precios, EDGAR, Alpha Vantage,
// consenso, universo, snapshot y la bitácora con su cadena de hashes intacta. Así producción continúa donde
// te quedaste y no repite consultas. Uso (una sola vez): npm run upload:local
// Requiere NETLIFY_SITE_ID y NETLIFY_BLOBS_TOKEN del sitio de Earnings Intelligence en .env.local.
import { fileStore, netlifyBlobsStore } from '../src/lib/store';

const env = process.env;
if (!env.NETLIFY_SITE_ID || !env.NETLIFY_BLOBS_TOKEN) {
  console.error('Faltan NETLIFY_SITE_ID y NETLIFY_BLOBS_TOKEN (del sitio earnings-intelligence) en .env.local');
  process.exit(1);
}
const local = fileStore('.data');
const remote = netlifyBlobsStore(env);
// .data/demo es el snapshot SINTÉTICO del modo demo: nunca se sube a producción.
const keys = (await local.list!('')).filter((k) => !k.startsWith('demo/'));
console.log(`Subiendo ${keys.length} archivos de .data a ${remote.label}…`);
let n = 0;
for (const k of keys) {
  const v = await local.get(k);
  if (v === null) continue;
  for (let attempt = 1; ; attempt++) {
    try {
      await remote.put(k, v);
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  if (++n % 25 === 0 || n === keys.length) console.log(`  ${n}/${keys.length}`);
}
const head = await remote.get<{ seq: number }>('ledger/head');
console.log(`Listo. Bitácora en producción: ${head?.seq ?? 0} predicciones.`);
