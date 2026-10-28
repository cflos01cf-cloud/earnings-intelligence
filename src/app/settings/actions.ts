'use server';
import { revalidatePath } from 'next/cache';
import { appStore } from '@/lib/load';
import { normalizeTicker, parseCsv, parseJsonImport } from '@/lib/universe/normalize';

export interface ImportState { ok: boolean; message: string; added: string[]; rejected: string[] }

/** Guarda símbolos manuales en el almacén (`universe/manual`). La siguiente corrida diaria los incorpora al registro. */
export async function importSymbols(_prev: ImportState | null, form: FormData): Promise<ImportState> {
  if (process.env.DATA_MODE === 'demo') return { ok: false, message: 'Modo demo: la importación está desactivada.', added: [], rejected: [] };
  const text = String(form.get('text') ?? '').trim();
  const file = form.get('file');
  const body = file instanceof File && file.size ? await file.text() : text;
  if (!body) return { ok: false, message: 'Pega símbolos o sube un archivo CSV/JSON.', added: [], rejected: [] };
  if (body.length > 200_000) return { ok: false, message: 'Archivo demasiado grande (máx. 200 KB).', added: [], rejected: [] };
  const parsed = body.startsWith('[') || body.startsWith('{') ? parseJsonImport(body) : parseCsv(body.includes(',') || body.includes(';') || body.includes('\n') ? body : body.split(/\s+/).join('\n'));
  const added: string[] = [];
  const rejected = [...parsed.errors];
  for (const r of parsed.rows) {
    const n = normalizeTicker(r.symbol);
    if (n.market === 'UNKNOWN') rejected.push(`${r.symbol}: formato no reconocido`);
    else added.push(n.symbol);
  }
  const store = appStore();
  const prev = (await store.get<{ symbol: string }[]>('universe/manual')) ?? [];
  const merged = [...new Map([...prev, ...added.map((symbol) => ({ symbol }))].map((x) => [x.symbol, x])).values()];
  await store.put('universe/manual', merged);
  revalidatePath('/settings');
  return { ok: true, message: `${added.length} símbolos guardados. Entran al análisis en la próxima corrida diaria.`, added, rejected };
}
