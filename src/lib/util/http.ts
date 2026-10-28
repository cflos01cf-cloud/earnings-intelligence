/** HTTP con límite de peticiones, tiempo máximo y reintentos para fallas pasajeras. */

export class RateLimiter {
  private stamps: number[] = [];
  constructor(
    private readonly perWindow: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
    private readonly sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {
    if (!(perWindow > 0)) throw new Error('perWindow debe ser > 0');
  }
  async acquire(): Promise<void> {
    for (;;) {
      const t = this.now();
      this.stamps = this.stamps.filter((s) => t - s < this.windowMs);
      if (this.stamps.length < this.perWindow) {
        this.stamps.push(t);
        return;
      }
      await this.sleep(this.windowMs - (t - this.stamps[0]) + 25);
    }
  }
}

export interface HttpResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  text?: string;
  error?: string;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export async function getJson<T>(
  url: string,
  o: { headers?: Record<string, string>; limiter?: RateLimiter; timeoutMs?: number; retries?: number; fetcher?: Fetcher } = {},
): Promise<HttpResult<T>> {
  const fetcher = o.fetcher ?? fetch;
  const retries = o.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    await o.limiter?.acquire();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 30_000);
    try {
      const res = await fetcher(url, { headers: o.headers, signal: ctrl.signal });
      const text = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
        continue;
      }
      let data: T | null = null;
      try {
        data = text ? (JSON.parse(text) as T) : null;
      } catch {
        data = null;
      }
      return { ok: res.ok, status: res.status, data, text: data === null ? text.slice(0, 500) : undefined };
    } catch (e) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
        continue;
      }
      return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Oculta llaves de API en URLs antes de registrarlas o mostrarlas. */
export function redact(url: string): string {
  return url.replace(/(apikey|token|api_key|apiKey)=[^&]+/gi, '$1=***');
}
