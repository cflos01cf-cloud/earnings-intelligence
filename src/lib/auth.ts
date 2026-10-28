/** Verifica un header Authorization: Basic contra la contraseña de la app. El usuario se ignora. */
export function basicAuthOk(header: string | null, password: string): boolean {
  if (!header?.startsWith('Basic ')) return false;
  let decoded: string;
  try { decoded = atob(header.slice(6).trim()); } catch { return false; }
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  const given = decoded.slice(i + 1);
  if (given.length !== password.length) return false;
  let diff = 0;
  for (let k = 0; k < given.length; k++) diff |= given.charCodeAt(k) ^ password.charCodeAt(k);
  return diff === 0;
}
