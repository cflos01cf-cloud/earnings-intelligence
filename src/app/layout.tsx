import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = { title: 'Earnings Intelligence', description: 'Reacción bursátil a resultados trimestrales' };

const NAV = [
  ['/', 'Resumen'],
  ['/calendar', 'Calendario'],
  ['/predictions', 'Predicciones'],
  ['/scanner', 'Oportunidades'],
  ['/backtest', 'Backtesting Lab'],
  ['/settings', 'Ajustes e integraciones'],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..700&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen font-sans">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-7xl flex-wrap items-baseline gap-x-8 gap-y-2 px-4 py-4">
            <Link href="/" className="wordmark text-xl text-fg">Earnings Intelligence</Link>
            <nav className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} className="hover:text-fg">{label}</Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 pt-4 text-xs leading-relaxed text-muted">
          Herramienta analítica y educativa. Las probabilidades salen de un modelo estadístico y no garantizan resultados. Invertir implica riesgo de pérdida de capital. No es asesoría financiera.
        </footer>
      </body>
    </html>
  );
}
