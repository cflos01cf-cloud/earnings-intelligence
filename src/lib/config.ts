/**
 * Parámetros fijados ANTES de entrenar o probar. Cambiarlos cambia `MODEL_VERSION`.
 */
export const MODEL_VERSION = 'ei-v2';

/** Costos por lado en GBM para acciones de EE.UU.: comisión 0.25% + IVA 16%, más deslizamiento estimado. */
export interface Costs { commissionPct: number; vatPct: number; slippagePct: number; spreadPct: number }

export function costsFromEnv(env: Record<string, string | undefined> = process.env): Costs {
  const n = (k: string, d: number) => {
    const v = Number(env[k]);
    return Number.isFinite(v) && env[k] !== '' && env[k] !== undefined ? v : d;
  };
  return { commissionPct: n('COST_COMMISSION_PCT', 0.25), vatPct: n('COST_VAT_PCT', 16), slippagePct: n('COST_SLIPPAGE_PCT', 0.05), spreadPct: n('COST_SPREAD_PCT', 0.03) };
}

/** Costo ida y vuelta como fracción (0.0066 = 0.66%). */
export function roundTripCost(c: Costs): number {
  const perSide = (c.commissionPct * (1 + c.vatPct / 100) + c.slippagePct + c.spreadPct / 2) / 100;
  return 2 * perSide;
}

export const MIN_TRAIN_EVENTS = 80; // por debajo: "Evidencia insuficiente" (salvo baseline con aviso)
export const MIN_EVENTS_PER_SYMBOL_HISTORY = 4;
export const L2 = 1.0; // regularización de la regresión logística
export const WALK_FORWARD_STEP_MONTHS = 3;
