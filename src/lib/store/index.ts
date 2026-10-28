/**
 * Almacén JSON.
 *  - netlify-blobs: producción (almacén propio `earnings-intelligence`, nunca el de GBM ni el del hub).
 *  - file: carpeta local `.data/` en tu PC.
 *  - memory: pruebas.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface JsonStore {
  readonly label: string;
  get<T>(key: string): Promise<T | null>;
  put(key: string, data: unknown): Promise<void>;
  list?(prefix: string): Promise<string[]>;
}

export const EI_BLOBS_STORE = 'earnings-intelligence';

export function memoryStore(): JsonStore & { dump(): Record<string, unknown> } {
  const m = new Map<string, string>();
  return {
    label: 'memoria',
    async get<T>(key: string) {
      const v = m.get(key);
      return v === undefined ? null : (JSON.parse(v) as T);
    },
    async put(key, data) {
      m.set(key, JSON.stringify(data));
    },
    async list(prefix) {
      return [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
    dump() {
      return Object.fromEntries([...m].map(([k, v]) => [k, JSON.parse(v)]));
    },
  };
}

export function fileStore(dir = path.join(process.cwd(), '.data')): JsonStore {
  const root = path.resolve(dir);
  const full = (key: string) => {
    const p = path.resolve(root, `${key}.json`);
    if (!p.startsWith(root + path.sep)) throw new Error(`Clave fuera del almacén: ${key}`);
    return p;
  };
  return {
    label: `archivos (${dir})`,
    async get<T>(key: string) {
      try {
        return JSON.parse(await fs.readFile(full(key), 'utf8')) as T;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async put(key, data) {
      const p = full(key);
      await fs.mkdir(path.dirname(p), { recursive: true });
      const tmp = `${p}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data));
      await fs.rename(tmp, p);
    },
    async list(prefix) {
      const out: string[] = [];
      const walk = async (d: string) => {
        let ents: import('node:fs').Dirent[] = [];
        try {
          ents = await fs.readdir(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of ents) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) await walk(p);
          else if (e.name.endsWith('.json')) out.push(path.relative(root, p).slice(0, -5).split(path.sep).join('/'));
        }
      };
      await walk(root);
      return out.filter((k) => k.startsWith(prefix)).sort();
    },
  };
}

export function netlifyBlobsStore(env: Record<string, string | undefined>): JsonStore {
  const siteID = env.NETLIFY_SITE_ID;
  const token = env.NETLIFY_BLOBS_TOKEN;
  const open = async () => {
    const { getStore } = await import('@netlify/blobs');
    return siteID && token ? getStore({ name: EI_BLOBS_STORE, siteID, token }) : getStore(EI_BLOBS_STORE);
  };
  return {
    label: siteID && token ? 'Netlify Blobs (API)' : 'Netlify Blobs',
    async get<T>(key: string) {
      return ((await (await open()).get(key, { type: 'json' })) ?? null) as T | null;
    },
    async put(key, data) {
      await (await open()).setJSON(key, data);
    },
    async list(prefix) {
      const r = await (await open()).list({ prefix });
      return r.blobs.map((b) => b.key).sort();
    },
  };
}

export function getStore(env: Record<string, string | undefined> = process.env): JsonStore {
  const kind = env.STORAGE || (env.NETLIFY || env.NETLIFY_BLOBS_CONTEXT ? 'netlify-blobs' : 'file');
  if (kind === 'netlify-blobs') return netlifyBlobsStore(env);
  if (kind === 'memory') return memoryStore();
  return fileStore(env.STORAGE_DIR || path.join(process.cwd(), '.data'));
}

export const KEYS = {
  registry: 'universe/registry',
  snapshot: 'latest/earnings',
  backtest: 'latest/backtest',
  consensus: (date: string) => `consensus/${date}`,
  raw: (provider: string, symbol: string) => `raw/${provider}/${symbol.replace('.', '-')}`,
  ledgerMonth: (ym: string) => `ledger/predictions/${ym}`,
  ledgerHead: 'ledger/head',
  outcomes: 'ledger/outcomes',
  budget: 'meta/budget',
  runs: 'meta/runs',
};
