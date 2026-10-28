import 'server-only';
import { fileStore, getStore, KEYS, type JsonStore } from './store';
import type { EarningsSnapshot } from './pipeline/snapshot-types';
import type { WalkForwardResult } from './backtest/walkforward';
import type { UniverseRegistry } from './types';

/** DATA_MODE=demo lee el snapshot SINTÉTICO de .data/demo; si no, el almacén configurado. */
export function appStore(): JsonStore {
  return process.env.DATA_MODE === 'demo' ? fileStore('.data/demo') : getStore();
}

export async function loadSnapshot(): Promise<{ snap: EarningsSnapshot | null; error: string | null; store: string }> {
  const store = appStore();
  try {
    return { snap: await store.get<EarningsSnapshot>(KEYS.snapshot), error: null, store: store.label };
  } catch (e) {
    return { snap: null, error: (e as Error).message, store: store.label };
  }
}

export async function loadBacktest(): Promise<Omit<WalkForwardResult, 'liveSet'>[] | null> {
  try {
    return await appStore().get<Omit<WalkForwardResult, 'liveSet'>[]>(KEYS.backtest);
  } catch {
    return null;
  }
}

export async function loadRegistry(): Promise<UniverseRegistry | null> {
  try {
    return await appStore().get<UniverseRegistry>(KEYS.registry);
  } catch {
    return null;
  }
}
