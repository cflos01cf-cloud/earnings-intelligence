# Earnings Intelligence

Quinto motor del Global Quant Hub: analiza los resultados trimestrales de las empresas que ya sigues
(universo de GBM Weekly Trend + tus posiciones y watchlist) y estima la probabilidad de que la acción
suba, baje o se mueva lateral a 1, 5 y 20 sesiones — **solo cuando el modelo demostró ventaja fuera de muestra**.

> Herramienta analítica. No es asesoría financiera. Las probabilidades son salidas de un modelo, no hechos.

## Qué responde, por empresa

| Pregunta | Dónde | Fuente |
|---|---|---|
| ¿Cuándo reporta? ¿antes o después del mercado? | Calendario | Finnhub / Alpha Vantage; hora oficial del 8-K (Item 2.02) de la SEC |
| ¿Qué espera el mercado? | Calendario, Empresa | Consenso EPS (Alpha Vantage, Finnhub) e ingresos (Finnhub, instantáneas propias) |
| ¿Qué publicó realmente? ¿superó o incumplió? | Empresa | EPS del proveedor; cifras oficiales de 10-Q/10-K (SEC EDGAR XBRL) |
| ¿Qué tan bueno es el trimestre? | Empresa | Márgenes, flujo libre, utilidad vs. caja, inventarios, cuentas por cobrar, dilución |
| ¿Cómo reaccionó antes? | Empresa | Últimos 8 reportes: reacción, anormal vs. S&P 500, +5/+20, volumen, "cayó pese a superar" |
| ¿Probabilidad de subida/bajada/lateral y magnitud? | Predicciones | Modelo `ei-v1`, intervalo 10–90 %, factores, invalidación |
| ¿Comprar, esperar o evitar? | Oportunidades | Motor de decisión con costos de GBM, liquidez, beneficio/riesgo |

Cada número lleva su etiqueta: **Oficial**, **Real (proveedor)**, **Consenso**, **Modelo** o **SIMULADO**.

## Arquitectura

```
GitHub Actions (L-V 17:15 CDMX) ─► npm run ci:daily
  universo   GBM Blobs (solo lectura) + seed GBM + importaciones → universe/registry
  ingesta    Finnhub (calendario + consenso) · SEC EDGAR · Alpha Vantage (presupuesto diario) · TwelveData
  eventos    fusión de fuentes, hora oficial del 8-K, consenso punto-en-el-tiempo
  dataset    variables PRE (cierre previo) y POST (cierre del día 0), etiquetas 1/5/20, sin información futura
  modelos    baseline de frecuencias + logística multinomial (λ por validación temporal) × 2 escenarios × 3 horizontes
  backtest   walk-forward trimestral con purga, Brier/log loss/calibración, cartera simulada con costos
  decisión   ALCISTA / BAJISTA / NEUTRAL / ESPERAR / NO OPERAR
  bitácora   predicciones con hash encadenado, registradas antes del resultado; resultados resueltos después
  publica    latest/earnings (snapshot) · latest/backtest → Netlify Blobs `earnings-intelligence`
Netlify (Next.js) ─► 7 pantallas leen el snapshot
Global Quant Hub ─► lee latest/earnings y envía las alertas por @globalquanthub_bot
```

```
src/lib/providers   edgar, alphavantage, finnhub, twelvedata   (un adaptador por proveedor; sustituibles)
src/lib/universe    seed, normalización de tickers, registro, lector de GBM
src/lib/analysis    sorpresas, fundamentales, fusión de eventos, alineación y reacción
src/lib/model       dataset (anti look-ahead), logística, motor de predicción
src/lib/backtest    walk-forward, métricas, cartera simulada
src/lib/score       Earnings Score calibrado y su validación fuera de muestra
src/lib/decision    motor de decisión
src/lib/ledger      bitácora con hash encadenado
src/lib/pipeline    ingesta y construcción del snapshot
src/app             Resumen, Calendario, Empresa, Predicciones, Oportunidades, Backtesting Lab, Ajustes
```

## Puesta en marcha (PowerShell)

```powershell
cd C:\dev
git clone https://github.com/cflos01cf-cloud/earnings-intelligence
cd earnings-intelligence
npm install
copy .env.example .env.local      # llena las llaves (ver tabla)
npm run probe                     # una petición por proveedor: confirma llave, plan y formato
npm run ci:daily                  # universo + ingesta + modelos + snapshot (en .data\ local)
npm run dev                       # http://localhost:3000
```

Sin llaves, para ver la app con datos **sintéticos**: `npm run demo:build` y `DATA_MODE=demo` en `.env.local`.

| Variable | Para qué | Dónde se obtiene |
|---|---|---|
| `SEC_CONTACT_EMAIL` | EDGAR exige un contacto en el User-Agent | tu correo |
| `ALPHAVANTAGE_API_KEY` | consenso histórico de EPS | alphavantage.co (gratis) |
| `FINNHUB_API_KEY` | calendario y consenso de ingresos | finnhub.io (gratis) |
| `TWELVEDATA_API_KEY` | precios diarios | twelvedata.com (gratis) |
| `GBM_NETLIFY_SITE_ID`, `GBM_BLOBS_TOKEN` | leer universo y posiciones de GBM | los mismos que usa el hub |

La primera corrida completa tarda: Alpha Vantage gratuito da ~25 peticiones al día, así que la historia
de EPS de las 35 empresas se completa en **2 días** (la app lo muestra como PARCIAL mientras tanto).

## Producción

Ver [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Verificación

```powershell
npm test; npx tsc --noEmit; npm run build
npm run backtest -- POST 5        # walk-forward con los datos guardados
```

## Limitaciones conocidas (v1)

- **Consenso de ingresos histórico**: no es gratuito. Se construye día a día desde la primera corrida; antes de eso la sorpresa de ingresos queda "no disponible".
- **Consenso de EPS**: el de Alpha Vantage no publica su fecha de corte; se asume el vigente antes del anuncio y se etiqueta así. El EPS del proveedor suele ser ajustado; se compara contra su propio consenso, nunca contra el GAAP de EDGAR.
- **Sesgo de supervivencia**: el universo son empresas grandes que existen hoy.
- **Guidance, transcripciones y noticias por empresa**: sin fuente gratuita estructurada; el componente de guidance aparece como faltante explícito.
- **Volatilidad implícita / movimiento implícito de opciones**: sin fuente autorizada gratuita.
- **BMV**: fuera del MVP (sin consenso gratuito); las emisoras quedan registradas como `BMV_PENDING`.
- **Emisores extranjeros** (TSM, ASML): sin XBRL trimestral en EDGAR; se analizan con EPS y precios.
- El ajuste por splits/dividendos de TwelveData no está verificado; se detectan saltos sospechosos y ajustes retroactivos.
