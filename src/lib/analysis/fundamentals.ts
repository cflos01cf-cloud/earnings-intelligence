/**
 * Métricas de calidad del trimestre a partir de cifras oficiales de EDGAR.
 * Punto en el tiempo: `asOfQuarter` solo considera trimestres presentados ANTES de la fecha dada.
 */
import type { QuarterFundamentals } from '../types';
import { yoy } from './surprise';

const DAY = 86_400_000;

export interface QuarterMetrics {
  fiscalPeriod: string;
  periodEnd: string;
  filed: string;
  revenue: number | null;
  revenueYoY: number | null;
  epsDiluted: number | null;
  epsYoYDiff: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  grossMarginChgPp: number | null; // vs mismo trimestre del año anterior, en puntos porcentuales
  operatingMarginChgPp: number | null;
  freeCashFlow: number | null;
  fcfMargin: number | null;
  /** (Utilidad neta − flujo operativo) / ingresos. Alto = utilidades poco respaldadas por caja. */
  accrualRatio: number | null;
  dilutionYoY: number | null;
  currentRatio: number | null;
  inventoryGrowthMinusRevenueGrowth: number | null;
  receivablesGrowthMinusRevenueGrowth: number | null;
  derived: string[];
  flags: string[];
}

const ratio = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? a / b : null);

export function findYearAgo(qs: QuarterFundamentals[], q: QuarterFundamentals): QuarterFundamentals | null {
  const target = Date.parse(q.periodEnd) - 365 * DAY;
  let best: QuarterFundamentals | null = null;
  for (const x of qs) {
    const d = Math.abs(Date.parse(x.periodEnd) - target);
    if (d <= 20 * DAY && (!best || d < Math.abs(Date.parse(best.periodEnd) - target))) best = x;
  }
  return best;
}

export function quarterMetrics(qs: QuarterFundamentals[], q: QuarterFundamentals): QuarterMetrics {
  const p = findYearAgo(qs, q);
  const gm = ratio(q.grossProfit, q.revenue);
  const om = ratio(q.operatingIncome, q.revenue);
  const nm = ratio(q.netIncome, q.revenue);
  const gmP = p ? ratio(p.grossProfit, p.revenue) : null;
  const omP = p ? ratio(p.operatingIncome, p.revenue) : null;
  const fcf = q.operatingCashFlow !== null && q.capex !== null ? q.operatingCashFlow - q.capex : null;
  const revY = yoy(q.revenue, p?.revenue ?? null);
  const flags: string[] = [];
  const accrual = q.netIncome !== null && q.operatingCashFlow !== null && q.revenue ? (q.netIncome - q.operatingCashFlow) / q.revenue : null;
  if (accrual !== null && accrual > 0.1) flags.push('Utilidad muy por encima del flujo operativo (posibles partidas no monetarias o extraordinarias).');
  const invG = yoy(q.inventory, p?.inventory ?? null);
  const recG = yoy(q.receivables, p?.receivables ?? null);
  const invMinus = invG !== null && revY !== null ? invG - revY : null;
  const recMinus = recG !== null && revY !== null ? recG - revY : null;
  if (invMinus !== null && invMinus > 0.15) flags.push('Inventarios crecen mucho más rápido que las ventas.');
  if (recMinus !== null && recMinus > 0.15) flags.push('Cuentas por cobrar crecen mucho más rápido que las ventas.');
  const dil = yoy(q.sharesDiluted, p?.sharesDiluted ?? null);
  if (dil !== null && dil > 0.03) flags.push(`Dilución de ${(dil * 100).toFixed(1)}% en acciones diluidas.`);
  if (q.derived.length) flags.push(`Cifras derivadas de acumulados: ${q.derived.join(', ')}.`);
  return {
    fiscalPeriod: q.fiscalPeriod,
    periodEnd: q.periodEnd,
    filed: q.filed,
    revenue: q.revenue,
    revenueYoY: revY,
    epsDiluted: q.epsDiluted,
    epsYoYDiff: q.epsDiluted !== null && p?.epsDiluted != null ? q.epsDiluted - p.epsDiluted : null,
    grossMargin: gm,
    operatingMargin: om,
    netMargin: nm,
    grossMarginChgPp: gm !== null && gmP !== null ? (gm - gmP) * 100 : null,
    operatingMarginChgPp: om !== null && omP !== null ? (om - omP) * 100 : null,
    freeCashFlow: fcf,
    fcfMargin: ratio(fcf, q.revenue),
    accrualRatio: accrual,
    dilutionYoY: dil,
    currentRatio: ratio(q.currentAssets, q.currentLiabilities),
    inventoryGrowthMinusRevenueGrowth: invMinus,
    receivablesGrowthMinusRevenueGrowth: recMinus,
    derived: q.derived,
    flags,
  };
}

/** Último trimestre presentado estrictamente antes de `date` (YYYY-MM-DD). */
export function asOfQuarter(qs: QuarterFundamentals[], date: string): QuarterFundamentals | null {
  let best: QuarterFundamentals | null = null;
  for (const q of qs) if (q.filed < date && (!best || q.periodEnd > best.periodEnd)) best = q;
  return best;
}
