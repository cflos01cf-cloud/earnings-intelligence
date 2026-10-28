/**
 * Bitácora de predicciones: SOLO SE AGREGA, nunca se reescribe.
 *
 *  - Cada predicción se registra con su instante de creación y un hash encadenado
 *    (sha256 del registro + hash anterior). Alterar un registro viejo rompe la cadena y `verifyChain` lo detecta.
 *  - Una predicción con el mismo id (símbolo:fecha:modo:horizonte) NO se reemplaza: cuenta la primera.
 *  - Una predicción solo se acepta si se crea ANTES de que termine su horizonte (si no, sería una "predicción" del pasado).
 *  - Los resultados se resuelven después, en un archivo aparte, al cumplirse el horizonte.
 */
import { createHash } from 'node:crypto';
import type { Outcome, Prediction } from '../types';
import { KEYS, type JsonStore } from '../store';

export interface LedgerEntry {
  seq: number;
  recordedAt: string;
  prediction: Prediction;
  prevHash: string;
  hash: string;
}

export interface LedgerHead {
  seq: number;
  hash: string;
  months: string[];
  ids: string[];
}

export interface ResolvedOutcome {
  id: string;
  resolvedAt: string;
  endDate: string;
  ret: number;
  outcome: Outcome;
}

const GENESIS = '0'.repeat(64);

export function hashEntry(seq: number, recordedAt: string, prediction: Prediction, prevHash: string): string {
  return createHash('sha256').update(JSON.stringify({ seq, recordedAt, prediction, prevHash })).digest('hex');
}

export async function readHead(store: JsonStore): Promise<LedgerHead> {
  return (await store.get<LedgerHead>(KEYS.ledgerHead)) ?? { seq: 0, hash: GENESIS, months: [], ids: [] };
}

/**
 * Agrega predicciones nuevas. `labelKnownAt(p)` devuelve la fecha en que el resultado ya sería conocido
 * (fin del horizonte) o null si aún no se conoce; si ya se conoce, la predicción se rechaza.
 */
export async function appendPredictions(store: JsonStore, preds: Prediction[], o: { now?: string; labelKnownAt?: (p: Prediction) => string | null } = {}): Promise<{ added: number; skippedExisting: number; rejectedLate: string[] }> {
  const now = o.now ?? new Date().toISOString();
  const head = await readHead(store);
  const ids = new Set(head.ids);
  const ym = now.slice(0, 7);
  const monthKey = KEYS.ledgerMonth(ym);
  const month = (await store.get<LedgerEntry[]>(monthKey)) ?? [];
  let added = 0;
  let skippedExisting = 0;
  const rejectedLate: string[] = [];
  let { seq, hash } = head;
  for (const p of preds) {
    if (ids.has(p.id)) {
      skippedExisting++;
      continue;
    }
    const known = o.labelKnownAt?.(p) ?? null;
    if (known !== null && known <= now.slice(0, 10)) {
      rejectedLate.push(p.id);
      continue;
    }
    seq += 1;
    const h = hashEntry(seq, now, p, hash);
    month.push({ seq, recordedAt: now, prediction: p, prevHash: hash, hash: h });
    hash = h;
    ids.add(p.id);
    added++;
  }
  if (added) {
    await store.put(monthKey, month);
    await store.put(KEYS.ledgerHead, { seq, hash, months: [...new Set([...head.months, ym])].sort(), ids: [...ids] } satisfies LedgerHead);
  }
  return { added, skippedExisting, rejectedLate };
}

export async function readLedger(store: JsonStore): Promise<LedgerEntry[]> {
  const head = await readHead(store);
  const out: LedgerEntry[] = [];
  for (const m of head.months) out.push(...((await store.get<LedgerEntry[]>(KEYS.ledgerMonth(m))) ?? []));
  return out.sort((a, b) => a.seq - b.seq);
}

export function verifyChain(entries: LedgerEntry[]): { ok: boolean; brokenAt: number | null } {
  let prev = GENESIS;
  for (const e of entries) {
    if (e.prevHash !== prev || hashEntry(e.seq, e.recordedAt, e.prediction, e.prevHash) !== e.hash) return { ok: false, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true, brokenAt: null };
}

export async function recordOutcomes(store: JsonStore, outcomes: ResolvedOutcome[]): Promise<number> {
  const prev = (await store.get<ResolvedOutcome[]>(KEYS.outcomes)) ?? [];
  const have = new Set(prev.map((o) => o.id));
  const fresh = outcomes.filter((o) => !have.has(o.id));
  if (fresh.length) await store.put(KEYS.outcomes, [...prev, ...fresh]);
  return fresh.length;
}
