type Entry<T> = { at: number; value: T };

const g = globalThis as typeof globalThis & {
  __aetherCache__?: Map<string, Entry<unknown>>;
};

function store() {
  if (!g.__aetherCache__) g.__aetherCache__ = new Map();
  return g.__aetherCache__;
}

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const mem = store();
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  mem.set(key, { at: Date.now(), value });
  return value;
}

export function peek<T>(key: string): T | null {
  const hit = store().get(key);
  return hit ? (hit.value as T) : null;
}

export async function fetchJson<T>(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "AETHER-UAP-Tracker/1.0 (research)",
        ...opts.headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchText(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml, application/json, */*;q=0.5",
        "User-Agent": "AETHER-UAP-Tracker/1.0 (research)",
        ...opts.headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchBuf(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ buf: ArrayBuffer; mime: string }> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "AETHER-UAP-Tracker/1.0 (research)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mime = res.headers.get("content-type") ?? "application/octet-stream";
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new Error("Image too large");
    return { buf, mime };
  } finally {
    clearTimeout(t);
  }
}
