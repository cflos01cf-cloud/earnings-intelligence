# Earnings Intelligence

Quinto motor del Global Quant Hub de Carlos. Predice la reacción bursátil a resultados trimestrales.
Nació del prompt maestro "Earnings Intelligence AI".

## Reglas inviolables

1. **Nunca inventar datos.** Sin dato: `null` + `verification: 'UNAVAILABLE'`. Todo valor lleva `Provenance`
   (fuente, fecha de publicación, periodo fiscal, fecha de consulta, verificación). Lo sintético es `SIMULATED` y solo vive en modo demo.
2. **Sin información futura.** PRE decide al cierre previo; POST al cierre del día 0. Trimestres de EDGAR solo
   desde su fecha `filed`; consenso solo si se observó antes del anuncio; entrenamiento con purga. Hay tests.
3. **La confianza sale de la validación fuera de muestra**, no de la probabilidad. Sin habilidad demostrada → BAJA y no se opera.
4. **La bitácora solo se agrega** (hash encadenado). Nunca reescribirla ni "corregir" predicciones pasadas.
5. **Solo lectura** de GBM y del hub. El hub lee este motor; este motor no escribe en otros almacenes.
6. **Llaves**: nunca en el frontend ni en el repo. `.env.local` no se edita con herramientas.

## Stack

Next.js 15, React 18, TypeScript strict, Tailwind v3, Vitest, Netlify Blobs, GitHub Actions. Sin dependencias de ML: el modelo es propio y determinista.

## Cómo trabajar

- Escribir en español. Leer el código antes de tocarlo. Cada corrección va con su test.
- Al terminar: `npm test`, `npx tsc --noEmit`, `npm run build`, y reportar el resultado real.
- Cambiar umbrales, costos por defecto o variables del modelo ⇒ subir `MODEL_VERSION`.
