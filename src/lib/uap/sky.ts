export type SkyObject = {
  name: string;
  short: string;
  ra: number;
  dec: number;
  dist: string;
};

export const SKY_CATALOG: SkyObject[] = [
  { name: "Andromeda (M31)", short: "Andromeda", ra: 10.68, dec: 41.27, dist: "2.5 Mly" },
  { name: "Proxima Centauri", short: "Proxima", ra: 217.43, dec: -62.68, dist: "4.24 ly" },
  { name: "Alpha Centauri", short: "α Cen", ra: 219.9, dec: -60.83, dist: "4.37 ly" },
  { name: "Barnard's Star", short: "Barnard", ra: 269.45, dec: 4.69, dist: "5.96 ly" },
  { name: "Wolf 359", short: "Wolf 359", ra: 164.12, dec: 7.09, dist: "7.9 ly" },
  { name: "Sirius", short: "Sirius", ra: 101.29, dec: -16.72, dist: "8.6 ly" },
  { name: "Epsilon Eridani", short: "ε Eri", ra: 53.23, dec: -9.46, dist: "10.5 ly" },
  { name: "Procyon", short: "Procyon", ra: 114.83, dec: 5.22, dist: "11.5 ly" },
  { name: "Tau Ceti", short: "τ Ceti", ra: 26.02, dec: -15.94, dist: "11.9 ly" },
  { name: "TRAPPIST-1", short: "TRAPPIST-1", ra: 346.62, dec: -5.04, dist: "40.5 ly" },
  { name: "Vega", short: "Vega", ra: 279.23, dec: 38.78, dist: "25 ly" },
  { name: "Deneb", short: "Deneb", ra: 310.36, dec: 45.28, dist: "2.6 kly" },
  { name: "Betelgeuse", short: "Betelgeuse", ra: 88.79, dec: 7.41, dist: "548 ly" },
  { name: "Pleiades", short: "Pleiades", ra: 56.87, dec: 24.12, dist: "444 ly" },
  { name: "Polaris", short: "Polaris", ra: 37.95, dec: 89.26, dist: "433 ly" },
  { name: "Canopus", short: "Canopus", ra: 95.99, dec: -52.7, dist: "310 ly" },
  { name: "Fomalhaut", short: "Fomalhaut", ra: 344.41, dec: -29.62, dist: "25 ly" },
  { name: "Galactic Center", short: "Sgr A*", ra: 266.42, dec: -29.01, dist: "26 kly" },
  { name: "Large Magellanic Cloud", short: "LMC", ra: 80.89, dec: -69.76, dist: "163 kly" },
  { name: "Small Magellanic Cloud", short: "SMC", ra: 13.19, dec: -72.83, dist: "200 kly" },
  { name: "M87", short: "M87", ra: 187.71, dec: 12.39, dist: "53 Mly" },
  { name: "Triangulum (M33)", short: "M33", ra: 23.46, dec: 30.66, dist: "2.7 Mly" },
];

export type SkyHit = {
  object: SkyObject;
  ra: number;
  dec: number;
  sepDeg: number;
};

function gmstDeg(date: Date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;
  let g = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t;
  g = ((g % 360) + 360) % 360;
  return g;
}

function angSep(ra1: number, dec1: number, ra2: number, dec2: number) {
  const d1 = (dec1 * Math.PI) / 180;
  const d2 = (dec2 * Math.PI) / 180;
  const r = ((ra1 - ra2) * Math.PI) / 180;
  const c = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(r);
  return (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI;
}

export function nearestSky(ra: number, dec: number): SkyHit {
  let best = SKY_CATALOG[0]!;
  let bestSep = 1e9;
  for (const obj of SKY_CATALOG) {
    const sep = angSep(ra, dec, obj.ra, obj.dec);
    if (sep < bestSep) {
      best = obj;
      bestSep = sep;
    }
  }
  return { object: best, ra, dec, sepDeg: bestSep };
}

export function zenithSky(iso: string, lat: number, lng: number): SkyHit {
  const date = new Date(iso);
  const lst = (gmstDeg(date) + lng + 360) % 360;
  return nearestSky(lst, lat);
}

export function radiantFromEcef(
  iso: string,
  vx: number,
  vy: number,
  vz: number,
): SkyHit | null {
  const speed = Math.hypot(vx, vy, vz);
  if (!Number.isFinite(speed) || speed < 0.4) return null;
  const gmst = (gmstDeg(new Date(iso)) * Math.PI) / 180;
  const cg = Math.cos(gmst);
  const sg = Math.sin(gmst);
  const ix = vx * cg - vy * sg;
  const iy = vx * sg + vy * cg;
  const iz = vz;
  const r = Math.hypot(-ix, -iy, -iz);
  const dec = (Math.asin(-iz / r) * 180) / Math.PI;
  let ra = (Math.atan2(-iy, -ix) * 180) / Math.PI;
  if (ra < 0) ra += 360;
  return nearestSky(ra, dec);
}

export function formatRa(deg: number) {
  const hours = ((deg / 15) % 24 + 24) % 24;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${String(h).padStart(2, "0")}h ${String(m % 60).padStart(2, "0")}m`;
}

export function formatDec(deg: number) {
  const sign = deg >= 0 ? "+" : "−";
  const a = Math.abs(deg);
  return `${sign}${a.toFixed(1)}°`;
}

export function regionFor(lat: number, lng: number) {
  if (lat >= 66) return "Arctic";
  if (lat <= -60) return "Antarctica";
  if (lng >= -170 && lng < -50 && lat > 7) return "North America";
  if (lng >= -90 && lng < -30 && lat <= 12 && lat > -60) return "South America";
  if (lng >= -30 && lng < 55 && lat >= 35) return "Europe";
  if (lng >= -20 && lng < 52 && lat < 35 && lat > -35) return "Africa";
  if (lng >= 26 && lng < 75 && lat > 10 && lat < 45) return "Middle East";
  if (lng >= 60 && lng < 100 && lat > 5) return "South Asia";
  if (lng >= 95 && lng < 150 && lat > 18) return "East Asia";
  if (lng >= 95 && lng < 155 && lat <= 18 && lat > -12) return "Southeast Asia";
  if (lng >= 110 && lng < 180 && lat <= -10) return "Oceania";
  if (lng >= 20 && lng < 100 && lat < 0) return "Indian Ocean";
  if (lng >= -80 && lng < 20) return "Atlantic";
  return "Pacific";
}

export function skyLine(s: {
  originLabel: string | null;
  originRa: number | null;
  originDec: number | null;
  originDist: string | null;
}) {
  if (!s.originLabel) return "Inbound sky direction unknown";
  const ra = s.originRa != null ? formatRa(s.originRa) : "—";
  const dec = s.originDec != null ? formatDec(s.originDec) : "—";
  return `${s.originLabel} · ${ra} ${dec}${s.originDist ? ` · ${s.originDist}` : ""}`;
}

export function uapIndexFor(opts: {
  vel: number | null;
  alt: number | null;
  energy: number | null;
  live: boolean;
  classification?: string;
  confidence?: number;
}) {
  if (!opts.live) {
    const conf = opts.confidence ?? 40;
    if (opts.classification === "anomalous") return Math.min(96, Math.max(55, conf));
    if (opts.classification === "likely-prosaic") return Math.min(42, Math.round(conf * 0.55));
    if (opts.classification === "sensor-contact") return Math.min(78, Math.max(28, conf - 8));
    return Math.min(72, Math.max(24, conf));
  }
  let n = 20;
  if (opts.vel === null) n += 14;
  else {
    if (opts.vel > 22) n += 8;
    if (opts.vel > 30) n += 12;
    if (opts.vel > 42) n += 22;
  }
  if (opts.alt != null && opts.alt > 48) n += 8;
  if (opts.energy != null && opts.energy > 8) n += 6;
  if (opts.energy != null && opts.energy < 0.2) n += 4;
  return Math.min(96, Math.max(8, Math.round(n)));
}

export function globalUapIndex(
  contacts: { source: string; occurredAt: string; classification: string; uapIndex: number; confidence: number }[],
) {
  if (contacts.length === 0) return 0;
  const live = contacts.filter((s) => s.source === "live");
  const day = Date.now() - 48 * 3600_000;
  const recent = live.filter((s) => Date.parse(s.occurredAt) >= day).length;
  const anom = contacts.filter((s) => s.classification === "anomalous").length / contacts.length;
  const avg = contacts.reduce((a, s) => a + (s.uapIndex ?? s.confidence), 0) / contacts.length;
  return Math.round(
    Math.min(
      99,
      Math.max(4, avg * 0.48 + anom * 32 + Math.min(18, recent * 6) + Math.min(12, live.length)),
    ),
  );
}

export function primaryInbound(contacts: { originLabel: string | null }[]) {
  const counts = new Map<string, number>();
  for (const s of contacts) {
    if (!s.originLabel) continue;
    counts.set(s.originLabel, (counts.get(s.originLabel) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of counts) {
    if (v > n) {
      best = k;
      n = v;
    }
  }
  return best;
}

export function subsolar(date = new Date()) {
  const utc = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lng = 15 * (12 - utc);
  lng = ((lng + 180) % 360 + 360) % 360 - 180;
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = (date.getTime() - start) / 86400000;
  const lat = -23.44 * Math.cos((2 * Math.PI * (doy + 10)) / 365);
  return { lat, lng };
}

export function solarCosine(lat: number, lng: number, sun: { lat: number; lng: number }) {
  const φ = (lat * Math.PI) / 180;
  const φs = (sun.lat * Math.PI) / 180;
  const dλ = ((lng - sun.lng) * Math.PI) / 180;
  return Math.sin(φ) * Math.sin(φs) + Math.cos(φ) * Math.cos(φs) * Math.cos(dλ);
}
