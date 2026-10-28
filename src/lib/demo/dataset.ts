/**
 * Dataset de DEMOSTRACIÓN (todo sintético, símbolos DEMO-*). Sirve para ver la app funcionando sin llaves.
 * La app lo marca con una franja roja permanente.
 */
import type { UniverseRegistry } from '../types';
import type { Dataset } from '../pipeline/build';
import { nextWeekday } from '../pipeline/build';
import { syntheticWorld } from './synthetic';

export function demoDataset(seed = 11): { ds: Dataset; now: Date } {
  const w = syntheticWorld({ nSymbols: 24, signal: 3, seed });
  const lastDate = w.spy.at(-1)!.time;
  const now = new Date(`${lastDate}T23:30:00Z`);
  const sim = (note: string) => ({ source: 'DEMO (sintético)', publishedAt: null, fetchedAt: now.toISOString(), verification: 'SIMULATED' as const, note });
  w.symbols.forEach((s, k) => {
    const up = s.events.find((e) => e.status === 'scheduled')!;
    if (k % 3 === 0) {
      // Reportó ayer después del cierre: hoy es su día 0.
      const prevDay = s.bars.at(-2)!.time;
      const est = up.epsEstimate.value!;
      const actual = est * (1 + (k % 2 ? 0.08 : -0.06));
      s.events.splice(s.events.indexOf(up), 1, {
        ...up, reportDate: prevDay, status: 'reported',
        epsActual: { value: actual, prov: sim('EPS sintético') },
        revenueActual: { value: up.revenueEstimate.value! * (k % 2 ? 1.02 : 0.99), prov: sim('Ingresos sintéticos') },
      });
    } else {
      // Próximo reporte en 1 a 10 sesiones.
      let d = lastDate;
      for (let i = 0; i < 1 + (k % 10); i++) d = nextWeekday(d);
      up.reportDate = d;
      up.reportTime = k % 2 ? 'post-market' : 'pre-market';
    }
  });
  const registry: UniverseRegistry = {
    version: 1,
    updatedAt: now.toISOString(),
    companies: w.symbols.map((s) => ({ ...s.company, sectorEtf: s.company.sector })),
    sources: [{ origin: 'manual', status: 'OK', detail: 'Universo SINTÉTICO de demostración', checkedAt: now.toISOString(), count: w.symbols.length }],
  };
  const providers = (['SEC EDGAR', 'Alpha Vantage', 'Finnhub', 'TwelveData'] as const).map((p) => ({ provider: p, status: 'SKIPPED' as const, checkedAt: now.toISOString(), lastSuccess: null, detail: 'Modo demo: no se consultan proveedores.', calls: 0 }));
  return {
    now,
    ds: {
      mode: 'demo',
      registry,
      symbols: w.symbols.map((s) => ({ ...s, company: { ...s.company, sectorEtf: s.company.sector } })),
      withoutPrices: [],
      spy: w.spy,
      sectors: w.sectors,
      priceSource: {},
      providers,
    },
  };
}
