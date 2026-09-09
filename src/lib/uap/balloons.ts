import { cached, fetchJson } from "./cache";
import { haversineKm, hashId, regionOf } from "./geo";
import type { Balloon, Contact } from "./types";

type Frame = {
  serial?: string;
  lat?: number;
  lon?: number;
  alt?: number;
  vel_h?: number;
  type?: string;
  subtype?: string;
  datetime?: string;
  manufacturer?: string;
};

function asFrame(v: unknown): Frame | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.lat === "number" && typeof o.lon === "number") return o as Frame;
  return null;
}

function latestFromValue(val: unknown): Frame | null {
  const direct = asFrame(val);
  if (direct) return direct;
  if (Array.isArray(val)) {
    for (let i = val.length - 1; i >= 0; i -= 1) {
      const f = asFrame(val[i]);
      if (f) return f;
    }
    return null;
  }
  if (val && typeof val === "object") {
    const frames = Object.values(val as Record<string, unknown>);
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const f = asFrame(frames[i]);
      if (f) return f;
    }
  }
  return null;
}

function toBalloon(serial: string, f: Frame): Balloon | null {
  const lat = Number(f.lat);
  const lng = Number(f.lon);
  const alt = Number(f.alt);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(alt)) return null;
  if (alt < 400) return null;
  return {
    id: serial,
    name: serial,
    lat,
    lng,
    altM: alt,
    velMs: typeof f.vel_h === "number" ? f.vel_h : null,
    kind: f.subtype || f.type || f.manufacturer || "radiosonde",
  };
}

export async function fetchBalloons(): Promise<Balloon[]> {
  return cached("sondehub-2h", 90_000, async () => {
    const json = await fetchJson<Record<string, unknown>>(
      "https://api.v2.sondehub.org/sondes?duration=2h",
      { timeoutMs: 10000 },
    );
    const out: Balloon[] = [];
    for (const [serial, val] of Object.entries(json ?? {})) {
      const frame = latestFromValue(val);
      if (!frame) continue;
      const b = toBalloon(serial, frame);
      if (b) out.push(b);
    }
    return out;
  }).catch(() => [] as Balloon[]);
}

export function balloonsNear(list: Balloon[], lat: number, lng: number, km = 120) {
  return list
    .map((b) => ({ b, d: haversineKm(b.lat, b.lng, lat, lng) }))
    .filter((x) => x.d <= km)
    .sort((a, c) => a.d - c.d)
    .slice(0, 10)
    .map((x) => x.b);
}

export function detectionsFromBalloons(list: Balloon[]): Contact[] {
  const now = new Date().toISOString();
  const high = list.filter((b) => b.altM >= 16000).slice(0, 18);
  return high.map((b) => {
    const residual = Math.min(42, 18 + Math.round(b.altM / 2000));
    return {
      id: hashId(`sonde:${b.id}`),
      lat: b.lat,
      lng: b.lng,
      locationLabel: `Balloon ${b.id}`,
      region: regionOf(b.lat, b.lng),
      occurredAt: now,
      shape: "orb" as const,
      durationSec: null,
      summary: `Live radiosonde at ${(b.altM / 1000).toFixed(1)} km (${b.kind ?? "sonde"})${b.velMs != null ? `, ${b.velMs.toFixed(0)} m/s` : ""}. High-altitude balloons are a frequent prosaic correlator for slow white-orb reports.`,
      classification: "likely-prosaic" as const,
      confidence: residual,
      source: "balloon" as const,
      createdAt: now,
      live: true,
      stream: "SondeHub",
      altitudeM: b.altM,
      speedKts: b.velMs != null ? b.velMs * 1.94384 : null,
      residual,
      reasons: ["weather balloon / radiosonde"],
      url: `https://sondehub.org/?sondeId=${encodeURIComponent(b.id)}`,
    };
  });
}
