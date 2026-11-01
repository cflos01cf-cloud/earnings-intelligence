/**
 * Credenciales pegadas a mano (secretos de GitHub, variables de Netlify, .env.local).
 * Al copiar se suelen colar espacios o un salto de línea al principio o al final: se recortan,
 * porque nunca forman parte de un Site ID ni de un token. Lo que queda en medio no se toca.
 */
const EDGE = /^[\s﻿​-‍⁠]+|[\s﻿​-‍⁠]+$/g;

export function cleanCredential(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const v = value.replace(EDGE, '');
  return v === '' ? undefined : v;
}

/** Detecta credenciales copiadas de una pantalla que las oculta (•••) o con caracteres no válidos en medio. */
export function credentialProblem(name: string, value: string | undefined): string | null {
  const v = cleanCredential(value);
  if (!v) return null;
  if (/[•●*]{3,}/.test(v)) return `${name} contiene puntos de ocultamiento (•••): se copió el valor oculto, no el real. Crea un token nuevo y pégalo completo.`;
  if (/[^\x21-\x7E]/.test(v)) return `${name} contiene espacios u otros caracteres no válidos en medio del valor. Vuelve a copiarlo completo, sin cortes.`;
  return null;
}
