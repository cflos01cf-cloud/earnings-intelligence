'use client';
import { useActionState } from 'react';
import { importSymbols, type ImportState } from './actions';

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState | null, FormData>(importSymbols, null);
  return (
    <form action={action} className="space-y-3 text-sm">
      <textarea name="text" rows={4} placeholder={'AAPL\nMSFT\nBRK-B\n…o CSV con encabezado symbol,name,sector'} className="w-full rounded border border-line bg-panel p-2 font-mono text-xs" />
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" name="file" accept=".csv,.json,text/csv,application/json" className="text-xs text-muted" />
        <button disabled={pending} className="rounded border border-brass px-3 py-1 text-sm text-fg hover:bg-brass/10 disabled:opacity-50">{pending ? 'Guardando…' : 'Importar'}</button>
      </div>
      {state ? (
        <div className={`text-xs ${state.ok ? 'text-up' : 'text-down'}`}>
          {state.message}
          {state.added.length ? <div className="text-muted">Normalizados: {state.added.join(', ')}</div> : null}
          {state.rejected.length ? <div className="text-warn">Rechazados: {state.rejected.join('; ')}</div> : null}
        </div>
      ) : null}
    </form>
  );
}
