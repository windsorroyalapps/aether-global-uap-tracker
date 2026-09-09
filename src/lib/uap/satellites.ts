import { cached, fetchJson } from "./cache";
import { haversineKm } from "./geo";
import type { SatelliteTrack } from "./types";

/**
 * Pure-JS TLE propagator (Kepler + J2 secular). Accurate enough for
 * "is this bird above the horizon?" without satellite.js WASM, which
 * Vite cannot bundle into the client IIFE worker format.
 */
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const MU = 398600.4418;
const RE = 6378.137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const J2 = 1.08262668e-3;

const SATCATS = [
  25544, // ISS
  48274, // CSS Tianhe
  20580, // Hubble
  25994, // Terra
  27424, // Aqua
  37849, // Suomi NPP
  39084, // Landsat 8
  43689, // NOAA-20
  28485, // Aura
  44713, // CSS Wentian
  54216, // CSS Mengtian
];

type TleJson = {
  satelliteId?: number;
  name?: string;
  line1?: string;
  line2?: string;
  member?: TleJson[];
};

type Rec = {
  id: string;
  name: string;
  epoch: Date;
  n: number;
  a: number;
  e: number;
  i: number;
  raan: number;
  aop: number;
  m0: number;
  raanDot: number;
  aopDot: number;
  mDot: number;
};

function julianDate(d: Date): number {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const ut =
    (d.getUTCHours() +
      d.getUTCMinutes() / 60 +
      d.getUTCSeconds() / 3600 +
      d.getUTCMilliseconds() / 3.6e6) /
    24;
  const a = Math.floor((14 - m) / 12);
  const y2 = y + 4800 - a;
  const m2 = m + 12 * a - 3;
  const jdn =
    day +
    Math.floor((153 * m2 + 2) / 5) +
    365 * y2 +
    Math.floor(y2 / 4) -
    Math.floor(y2 / 100) +
    Math.floor(y2 / 400) -
    32045;
  return jdn - 0.5 + ut;
}

function gstime(d: Date): number {
  const t = (julianDate(d) - 2451545.0) / 36525;
  let gmst =
    67310.54841 + (876600 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t * t * t;
  gmst = ((gmst % 86400) + 86400) % 86400;
  return (gmst / 86400) * 2 * Math.PI;
}

function tleEpoch(line1: string): Date | null {
  const yrRaw = Number(line1.slice(18, 20));
  const doy = Number(line1.slice(20, 32));
  if (!Number.isFinite(yrRaw) || !Number.isFinite(doy)) return null;
  const year = yrRaw < 57 ? 2000 + yrRaw : 1900 + yrRaw;
  return new Date(Date.UTC(year, 0, 1) + (doy - 1) * 86400000);
}

function parseRec(id: string, name: string, line1: string, line2: string): Rec | null {
  if (line1.length < 32 || line2.length < 63) return null;
  const epoch = tleEpoch(line1);
  const inc = Number(line2.slice(8, 16));
  const raan = Number(line2.slice(17, 25));
  const ecc = Number(`0.${line2.slice(26, 33).trim().replace(/ /g, "0")}`);
  const aop = Number(line2.slice(34, 42));
  const m0 = Number(line2.slice(43, 51));
  const nRev = Number(line2.slice(52, 63));
  if (!epoch || ![inc, raan, ecc, aop, m0, nRev].every(Number.isFinite) || nRev <= 0) return null;
  const n = (nRev * 2 * Math.PI) / 86400;
  const a = (MU / (n * n)) ** (1 / 3);
  const i = inc * DEG;
  const e = ecc;
  const p = a * (1 - e * e);
  if (p <= 0) return null;
  const factor = 1.5 * J2 * (RE / p) ** 2 * n;
  const s2 = Math.sin(i) ** 2;
  return {
    id,
    name,
    epoch,
    n,
    a,
    e,
    i,
    raan: raan * DEG,
    aop: aop * DEG,
    m0: m0 * DEG,
    raanDot: -factor * Math.cos(i),
    aopDot: factor * (2 - 2.5 * s2),
    mDot: n + factor * Math.sqrt(1 - e * e) * (1 - 1.5 * s2),
  };
}

function eccentricAnomaly(M: number, e: number): number {
  let E = M;
  for (let k = 0; k < 14; k++) {
    const dE = (M - E + e * Math.sin(E)) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

function geodetic(x: number, y: number, z: number): { lat: number; lng: number; altKm: number } {
  const r = Math.hypot(x, y);
  let lat = Math.atan2(z, r * (1 - E2));
  for (let k = 0; k < 8; k++) {
    const s = Math.sin(lat);
    const N = RE / Math.sqrt(1 - E2 * s * s);
    lat = Math.atan2(z + N * E2 * s, r);
  }
  const s = Math.sin(lat);
  const N = RE / Math.sqrt(1 - E2 * s * s);
  const altKm = r / Math.cos(lat) - N;
  return { lat: lat * RAD, lng: Math.atan2(y, x) * RAD, altKm };
}

function eciToEcef(x: number, y: number, z: number, gmst: number) {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  return { x: x * c + y * s, y: -x * s + y * c, z };
}

function propagateEci(rec: Rec, when: Date): { x: number; y: number; z: number } | null {
  const dt = (when.getTime() - rec.epoch.getTime()) / 1000;
  if (!Number.isFinite(dt) || Math.abs(dt) > 14 * 86400) return null;
  const M = rec.m0 + rec.mDot * dt;
  const E = eccentricAnomaly(M, rec.e);
  const xp = rec.a * (Math.cos(E) - rec.e);
  const yp = rec.a * Math.sqrt(1 - rec.e * rec.e) * Math.sin(E);
  const raan = rec.raan + rec.raanDot * dt;
  const aop = rec.aop + rec.aopDot * dt;
  const cw = Math.cos(aop);
  const sw = Math.sin(aop);
  const co = Math.cos(raan);
  const so = Math.sin(raan);
  const ci = Math.cos(rec.i);
  const si = Math.sin(rec.i);
  const x = (co * cw - so * sw * ci) * xp + (-co * sw - so * cw * ci) * yp;
  const y = (so * cw + co * sw * ci) * xp + (-so * sw + co * cw * ci) * yp;
  const z = sw * si * xp + cw * si * yp;
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

function lookAngles(
  sat: { x: number; y: number; z: number },
  latDeg: number,
  lngDeg: number,
): { az: number; el: number; rangeKm: number } {
  const lat = latDeg * DEG;
  const lng = lngDeg * DEG;
  const sl = Math.sin(lat);
  const cl = Math.cos(lat);
  const so = Math.sin(lng);
  const co = Math.cos(lng);
  const n = RE / Math.sqrt(1 - E2 * sl * sl);
  const ox = n * cl * co;
  const oy = n * cl * so;
  const oz = n * (1 - E2) * sl;
  const rx = sat.x - ox;
  const ry = sat.y - oy;
  const rz = sat.z - oz;
  const east = -so * rx + co * ry;
  const north = -sl * co * rx - sl * so * ry + cl * rz;
  const up = cl * co * rx + cl * so * ry + sl * rz;
  const rangeKm = Math.hypot(east, north, up);
  return {
    az: ((Math.atan2(east, north) * RAD) + 360) % 360,
    el: Math.asin(up / rangeKm) * RAD,
    rangeKm,
  };
}

function propagateOne(rec: Rec, when: Date): SatelliteTrack | null {
  const eci = propagateEci(rec, when);
  if (!eci) return null;
  const ecef = eciToEcef(eci.x, eci.y, eci.z, gstime(when));
  const geo = geodetic(ecef.x, ecef.y, ecef.z);
  if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) return null;
  return {
    id: rec.id,
    name: rec.name.replace(/[()]/g, "").trim(),
    lat: geo.lat,
    lng: ((geo.lng + 540) % 360) - 180,
    altKm: geo.altKm,
    az: null,
    el: null,
    rangeKm: null,
  };
}

async function loadRecs(): Promise<Rec[]> {
  return cached("tle-catalog", 3 * 60 * 60_000, async () => {
    const rows = await Promise.all(
      SATCATS.map((id) =>
        fetchJson<TleJson>(`https://tle.ivanstanojevic.me/api/tle/${id}`, { timeoutMs: 7000 }).catch(
          () => null,
        ),
      ),
    );
    const extra = await fetchJson<TleJson>(
      "https://tle.ivanstanojevic.me/api/tle?search=TIANHE&page-size=6",
      { timeoutMs: 7000 },
    ).catch(() => null);
    const bag = [...rows, ...(extra?.member ?? [])];
    const out: Rec[] = [];
    const seen = new Set<string>();
    for (const t of bag) {
      if (!t?.line1 || !t.line2) continue;
      const id = String(t.satelliteId ?? t.line1.slice(2, 7).trim());
      if (seen.has(id)) continue;
      const rec = parseRec(id, t.name ?? `NORAD ${id}`, t.line1, t.line2);
      if (!rec) continue;
      seen.add(id);
      out.push(rec);
    }
    return out;
  });
}

export async function fetchSatellites(): Promise<SatelliteTrack[]> {
  const recs = await loadRecs().catch(() => [] as Rec[]);
  const when = new Date();
  return recs.map((r) => propagateOne(r, when)).filter((x): x is SatelliteTrack => x !== null);
}

export async function satellitesOver(lat: number, lng: number): Promise<SatelliteTrack[]> {
  const recs = await loadRecs().catch(() => [] as Rec[]);
  const when = new Date();
  const gmst = gstime(when);
  const out: SatelliteTrack[] = [];
  for (const rec of recs) {
    const eci = propagateEci(rec, when);
    if (!eci) continue;
    const ecef = eciToEcef(eci.x, eci.y, eci.z, gmst);
    const geo = geodetic(ecef.x, ecef.y, ecef.z);
    if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) continue;
    const look = lookAngles(ecef, lat, lng);
    if (look.el < 12) continue;
    out.push({
      id: rec.id,
      name: rec.name.replace(/[()]/g, "").trim(),
      lat: geo.lat,
      lng: ((geo.lng + 540) % 360) - 180,
      altKm: geo.altKm,
      az: look.az,
      el: look.el,
      rangeKm: look.rangeKm,
    });
  }
  out.sort((a, b) => (b.el ?? 0) - (a.el ?? 0));
  return out.slice(0, 8);
}

export function satelliteNear(
  list: SatelliteTrack[],
  lat: number,
  lng: number,
  km = 1800,
) {
  return list
    .map((s) => ({ s, d: haversineKm(s.lat, s.lng, lat, lng) }))
    .filter((x) => x.d <= km)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.s);
}
