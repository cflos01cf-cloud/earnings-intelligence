/**
 * Normalización de tickers y parsing de importaciones (CSV/JSON).
 * Cada proveedor escribe algunos tickers distinto; aquí está el único lugar donde se traduce.
 */

const BMV_HINT = /\.MX$|^(NAFTRAC|WALMEX|AMXB|GFNORTEO|FEMSAUBD|CEMEXCPO|GMEXICOB|BIMBOA|KOFUBL|GAPB|ASURB|OMAB|ORBIA|PINFRA|GCARSOA1|AC|KIMBERA|CHDRAUIB|LIVEPOLC-1|BBAJIOO)$/;

export interface NormalizedTicker {
  symbol: string;
  market: 'US' | 'BMV' | 'UNKNOWN';
  warnings: string[];
}

/** Forma canónica: mayúsculas, sin prefijos de bolsa, clases con punto (BRK.B). */
export function normalizeTicker(raw: string): NormalizedTicker {
  const warnings: string[] = [];
  let s = String(raw ?? '').trim().toUpperCase();
  s = s.replace(/^(NASDAQ|NYSE|NYSEARCA|AMEX|BMV|US)[:\s]+/, '');
  if (/\.MX$/.test(s)) {
    return { symbol: s.replace(/\.MX$/, ''), market: 'BMV', warnings };
  }
  if (BMV_HINT.test(s)) return { symbol: s, market: 'BMV', warnings };
  // Clases de acción: BRK-B, BRK/B, BRK B → BRK.B
  const m = s.match(/^([A-Z]{1,5})[-/ ]([A-Z])$/);
  if (m) {
    s = `${m[1]}.${m[2]}`;
    warnings.push(`Clase de acción normalizada a ${s}`);
  }
  if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(s)) {
    warnings.push(`Ticker con formato no estándar: "${raw}"`);
    return { symbol: s, market: 'UNKNOWN', warnings };
  }
  return { symbol: s, market: 'US', warnings };
}

/** Traducción del ticker canónico al formato de cada proveedor. */
export function providerSymbol(symbol: string, provider: 'sec' | 'alphavantage' | 'finnhub' | 'twelvedata'): string {
  if (!symbol.includes('.')) return symbol;
  // SEC (company_tickers.json) y Alpha Vantage usan guion; Finnhub y TwelveData usan punto.
  if (provider === 'sec' || provider === 'alphavantage') return symbol.replace('.', '-');
  return symbol;
}

export interface ImportRow {
  symbol: string;
  name?: string;
  exchange?: string;
  currency?: string;
  sector?: string;
}

/** CSV con encabezado (symbol obligatorio; name, exchange, currency, sector opcionales) o una columna de tickers. */
export function parseCsv(text: string): { rows: ImportRow[]; errors: string[] } {
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return { rows: [], errors: ['Archivo vacío'] };
  const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  const hasHeader = head.some((h) => ['symbol', 'ticker', 'simbolo', 'símbolo'].includes(h));
  const idx = (names: string[]) => head.findIndex((h) => names.includes(h));
  const iSym = hasHeader ? idx(['symbol', 'ticker', 'simbolo', 'símbolo']) : 0;
  const iName = hasHeader ? idx(['name', 'nombre', 'empresa']) : -1;
  const iEx = hasHeader ? idx(['exchange', 'bolsa', 'mercado']) : -1;
  const iCur = hasHeader ? idx(['currency', 'moneda']) : -1;
  const iSec = hasHeader ? idx(['sector']) : -1;
  const rows: ImportRow[] = [];
  lines.slice(hasHeader ? 1 : 0).forEach((line, k) => {
    const cells = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    const symbol = cells[iSym];
    if (!symbol) {
      errors.push(`Fila ${k + (hasHeader ? 2 : 1)}: sin símbolo`);
      return;
    }
    rows.push({
      symbol,
      ...(iName >= 0 && cells[iName] ? { name: cells[iName] } : {}),
      ...(iEx >= 0 && cells[iEx] ? { exchange: cells[iEx] } : {}),
      ...(iCur >= 0 && cells[iCur] ? { currency: cells[iCur] } : {}),
      ...(iSec >= 0 && cells[iSec] ? { sector: cells[iSec] } : {}),
    });
  });
  return { rows, errors };
}

/** JSON: arreglo de tickers o de objetos {symbol, ...}. */
export function parseJsonImport(text: string): { rows: ImportRow[]; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { rows: [], errors: [`JSON inválido: ${(e as Error).message}`] };
  }
  const arr = Array.isArray(data) ? data : Array.isArray((data as { symbols?: unknown })?.symbols) ? (data as { symbols: unknown[] }).symbols : null;
  if (!arr) return { rows: [], errors: ['Se esperaba un arreglo o {"symbols": [...]}'] };
  const rows: ImportRow[] = [];
  const errors: string[] = [];
  arr.forEach((x, i) => {
    if (typeof x === 'string') rows.push({ symbol: x });
    else if (x && typeof x === 'object' && typeof (x as ImportRow).symbol === 'string') rows.push(x as ImportRow);
    else errors.push(`Elemento ${i}: sin "symbol"`);
  });
  return { rows, errors };
}
