# Despliegue y manual de operación

## 1. Sitio en Netlify

1. Netlify → *Add new site* → *Import from Git* → `cflos01cf-cloud/earnings-intelligence`. Build: `npm run build` (ya en `netlify.toml`).
2. *Site configuration → Environment variables*:
   - `APP_PASSWORD` (la app queda protegida con contraseña).
   - `STORAGE=netlify-blobs`.
   - No hacen falta las llaves de datos en Netlify: la ingesta corre en GitHub Actions.
3. Anota el **Site ID** (*Site configuration → Site details*).
4. Crea un **token personal** de Netlify (*User settings → Applications → Personal access tokens*).

## 2. GitHub Actions

En el repo → *Settings → Secrets and variables → Actions*:

| Secret | Valor |
|---|---|
| `NETLIFY_SITE_ID` | Site ID del paso 1.3 |
| `NETLIFY_BLOBS_TOKEN` | token del paso 1.4 |
| `SEC_CONTACT_EMAIL` | tu correo |
| `ALPHAVANTAGE_API_KEY`, `FINNHUB_API_KEY`, `TWELVEDATA_API_KEY` | tus llaves |
| `GBM_NETLIFY_SITE_ID`, `GBM_BLOBS_TOKEN` | los de GBM (opcional; sin ellos se usa la copia del seed) |

Variables opcionales: `ALPHAVANTAGE_DAILY_LIMIT` (20), `TWELVEDATA_RATE_PER_MIN` (8).

Corre el workflow a mano una vez (*Actions → Earnings Intelligence diario → Run workflow*). Después corre de lunes a viernes a las 17:15 de Ciudad de México.

## 3. Alertas por el hub

En el sitio del **Global Quant Hub** (Netlify → Environment variables) agrega, tras fusionar el PR del hub:

| Variable | Valor |
|---|---|
| `EARNINGS_NETLIFY_SITE_ID` | Site ID de earnings-intelligence |
| `EARNINGS_BLOBS_TOKEN` | token personal de Netlify |
| `EARNINGS_DASHBOARD_URL` | URL pública de esta app |
| `EARNINGS_ALERT_KINDS` | opcional, p. ej. `REPORTED,UPCOMING,RISK,DATA` |

Prueba del canal (en tu PC, dentro del repo del hub, con esas variables en `.env.local`): `npm run earnings:test`.

## 4. Operación diaria

| Qué revisar | Dónde |
|---|---|
| ¿Corrió hoy? ¿qué proveedor falló? | Ajustes → Proveedores; log de GitHub Actions |
| ¿La bitácora está íntegra? | Resumen → "cadena íntegra" (si dice ROTA, el workflow falla a propósito) |
| ¿El modelo tiene ventaja? | Backtesting Lab → habilidad > 0 y calibración cerca de la diagonal |
| Agregar símbolos | Ajustes → Importar (entran en la siguiente corrida) |

Reglas que no cambian sin subir `MODEL_VERSION` en `src/lib/config.ts`: definición de lateral, costos por defecto,
mínimos de eventos, compuerta de habilidad (> 0.005 con ≥ 100 eventos fuera de muestra).

## 5. Si algo falla

- **Alpha Vantage "RATE_LIMITED"**: normal en los primeros días; la cola continúa al día siguiente.
- **TwelveData `INVALID_SYMBOL` en BRK.B**: revisa con `npm run probe` qué formato acepta tu plan y ajústalo en `src/lib/universe/normalize.ts` (`providerSymbol`).
- **EDGAR 403**: falta o es inválido `SEC_CONTACT_EMAIL`.
- **Snapshot vacío en la app**: el workflow aún no ha publicado o el Site ID/token no corresponden al sitio.
