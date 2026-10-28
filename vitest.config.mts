import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Los escenarios generan años de velas sintéticas: en equipos o runners lentos tardan más de los 5 s por defecto.
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 30_000 },
});
