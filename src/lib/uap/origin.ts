import {
  EquatorFromVector,
  MakeTime,
  Observer,
  RotateVector,
  Rotation_HOR_EQJ,
  Spherical,
  VectorFromHorizon,
} from "astronomy-engine";
import type { Contact } from "./types";

export type CatalogObject = {
  name: string;
  kind: "star" | "galaxy" | "center";
  raHours: number;
  decDeg: number;
  note: string;
};

export type SkyOrigin = {
  headingDeg: number | null;
  speedKts: number | null;
  verticalFpm: number | null;
  radiantAz: number | null;
  radiantEl: number | null;
  raHours: number | null;
  decDeg: number | null;
  nearest: (CatalogObject & { sepDeg: number }) | null;
  method: "reverse-track" | "ecef-velocity" | "zenith";
  note: string;
};

/** Bright named stars and nearby galaxies (J2000). Geometric references, not claims of origin. */
export const SKY_CATALOG: CatalogObject[] = [
  { name: "Sirius", kind: "star", raHours: 6.7525, decDeg: -16.7161, note: "α CMa · 8.6 ly" },
  { name: "Canopus", kind: "star", raHours: 6.3992, decDeg: -52.6956, note: "α Car · 310 ly" },
  { name: "Rigil Kentaurus", kind: "star", raHours: 14.6601, decDeg: -60.835, note: "α Cen · 4.3 ly" },
  { name: "Arcturus", kind: "star", raHours: 14.261, decDeg: 19.1824, note: "α Boo · 37 ly" },
  { name: "Vega", kind: "star", raHours: 18.6156, decDeg: 38.7838, note: "α Lyr · 25 ly" },
  { name: "Capella", kind: "star", raHours: 5.2782, decDeg: 45.998, note: "α Aur · 43 ly" },
  { name: "Rigel", kind: "star", raHours: 5.2423, decDeg: -8.2016, note: "β Ori · 860 ly" },
  { name: "Procyon", kind: "star", raHours: 7.655, decDeg: 5.225, note: "α CMi · 11 ly" },
  { name: "Betelgeuse", kind: "star", raHours: 5.9195, decDeg: 7.407, note: "α Ori · 640 ly" },
  { name: "Achernar", kind: "star", raHours: 1.6286, decDeg: -57.2368, note: "α Eri · 139 ly" },
  { name: "Hadar", kind: "star", raHours: 14.0637, decDeg: -60.373, note: "β Cen · 390 ly" },
  { name: "Altair", kind: "star", raHours: 19.8464, decDeg: 8.8683, note: "α Aql · 17 ly" },
  { name: "Acrux", kind: "star", raHours: 12.4433, decDeg: -63.0991, note: "α Cru · 320 ly" },
  { name: "Aldebaran", kind: "star", raHours: 4.5987, decDeg: 16.5093, note: "α Tau · 65 ly" },
  { name: "Antares", kind: "star", raHours: 16.4901, decDeg: -26.432, note: "α Sco · 550 ly" },
  { name: "Spica", kind: "star", raHours: 13.4199, decDeg: -11.1613, note: "α Vir · 250 ly" },
  { name: "Pollux", kind: "star", raHours: 7.7553, decDeg: 28.0262, note: "β Gem · 34 ly" },
  { name: "Fomalhaut", kind: "star", raHours: 22.9608, decDeg: -29.6222, note: "α PsA · 25 ly" },
  { name: "Deneb", kind: "star", raHours: 20.6905, decDeg: 45.2803, note: "α Cyg · 1,400 ly" },
  { name: "Regulus", kind: "star", raHours: 10.1395, decDeg: 11.9672, note: "α Leo · 79 ly" },
  { name: "Polaris", kind: "star", raHours: 2.5303, decDeg: 89.2641, note: "α UMi · 430 ly" },
  { name: "Castor", kind: "star", raHours: 7.5767, decDeg: 31.8883, note: "α Gem · 51 ly" },
  { name: "Bellatrix", kind: "star", raHours: 5.4189, decDeg: 6.3497, note: "γ Ori · 250 ly" },
  { name: "Alnilam", kind: "star", raHours: 5.6036, decDeg: -1.2019, note: "ε Ori · 2,000 ly" },
  { name: "Alioth", kind: "star", raHours: 12.9006, decDeg: 55.9598, note: "ε UMa · 83 ly" },
  { name: "Dubhe", kind: "star", raHours: 11.0622, decDeg: 61.751, note: "α UMa · 123 ly" },
  { name: "Alkaid", kind: "star", raHours: 13.7923, decDeg: 49.3133, note: "η UMa · 104 ly" },
  { name: "Mimosa", kind: "star", raHours: 12.7953, decDeg: -59.6888, note: "β Cru · 280 ly" },
  { name: "Shaula", kind: "star", raHours: 17.5601, decDeg: -37.1038, note: "λ Sco · 570 ly" },
  { name: "Andromeda (M31)", kind: "galaxy", raHours: 0.7122, decDeg: 41.2692, note: "2.5 million ly" },
  { name: "Triangulum (M33)", kind: "galaxy", raHours: 1.5642, decDeg: 30.6602, note: "2.7 million ly" },
  { name: "Large Magellanic Cloud", kind: "galaxy", raHours: 5.5667, decDeg: -69.7561, note: "163,000 ly" },
  { name: "Small Magellanic Cloud", kind: "galaxy", raHours: 0.8775, decDeg: -72.8003, note: "200,000 ly" },
  { name: "Virgo A (M87)", kind: "galaxy", raHours: 12.5137, decDeg: 12.3911, note: "53 million ly" },
  { name: "Galactic Center (Sgr A*)", kind: "center", raHours: 17.7611, decDeg: -29.0078, note: "26,000 ly · Milky Way core" },
];

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function wrap360(d: number) {
  return ((d % 360) + 360) % 360;
}

function angSepDeg(ra1h: number, dec1: number, ra2h: number, dec2: number) {
  const a1 = ra1h * 15 * DEG;
  const a2 = ra2h * 15 * DEG;
  const d1 = dec1 * DEG;
  const d2 = dec2 * DEG;
  const c = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(a1 - a2);
  return Math.acos(Math.min(1, Math.max(-1, c))) * RAD;
}

function nearestObject(raHours: number, decDeg: number) {
  let best: CatalogObject & { sepDeg: number } = { ...SKY_CATALOG[0], sepDeg: 999 };
  for (const o of SKY_CATALOG) {
    const sep = angSepDeg(raHours, decDeg, o.raHours, o.decDeg);
    if (sep < best.sepDeg) best = { ...o, sepDeg: sep };
  }
  return best;
}

function horizonToEquatorial(
  lat: number,
  lng: number,
  az: number,
  el: number,
  when: Date,
): { raHours: number; decDeg: number } | null {
  try {
    const time = MakeTime(when);
    const observer = new Observer(lat, lng, 0);
    const sphere = new Spherical(el, wrap360(az), 1);
    const hor = VectorFromHorizon(sphere, time, "normal");
    const rot = Rotation_HOR_EQJ(time, observer);
    const eqj = RotateVector(rot, hor);
    const eq = EquatorFromVector(eqj);
    if (!Number.isFinite(eq.ra) || !Number.isFinite(eq.dec)) return null;
    return { raHours: eq.ra, decDeg: eq.dec };
  } catch {
    return null;
  }
}

function pack(
  contact: Contact,
  az: number,
  el: number,
  method: SkyOrigin["method"],
  note: string,
): SkyOrigin {
  const when = new Date(contact.occurredAt);
  const eq = horizonToEquatorial(contact.lat, contact.lng, az, el, Number.isNaN(when.getTime()) ? new Date() : when);
  const nearest = eq ? nearestObject(eq.raHours, eq.decDeg) : null;
  return {
    headingDeg: contact.headingDeg ?? null,
    speedKts: contact.speedKts ?? null,
    verticalFpm: contact.verticalFpm ?? null,
    radiantAz: wrap360(az),
    radiantEl: el,
    raHours: eq?.raHours ?? null,
    decDeg: eq?.decDeg ?? null,
    nearest,
    method,
    note,
  };
}

/**
 * Reverse the observed flight path to a sky radiant — the direction the
 * object would have come from if the track continued backward into space.
 * Nearest catalog star/galaxy is a geometric line-of-sight reference.
 */
export function skyOrigin(contact: Contact): SkyOrigin {
  const heading = contact.headingDeg;
  const gsMs = (contact.speedKts ?? 0) * 0.514444;
  const vertMs = (contact.verticalFpm ?? 0) * 0.00508;

  if (heading != null && Number.isFinite(heading) && (gsMs > 0.5 || Math.abs(vertMs) > 0.5)) {
    const h = heading * DEG;
    const east = gsMs * Math.sin(h);
    const north = gsMs * Math.cos(h);
    const up = vertMs;
    const inE = -east;
    const inN = -north;
    const inU = -up;
    const horiz = Math.hypot(inE, inN);
    let az = wrap360(Math.atan2(inE, inN) * RAD);
    let el = Math.atan2(inU, Math.max(horiz, 1e-6)) * RAD;
    if (el < 4 && (contact.altitudeM ?? 0) > 6000) el = 18;
    if (el < 2) el = 6;
    return pack(
      contact,
      az,
      Math.min(88, el),
      "reverse-track",
      "Reverse of the observed ground track and vertical rate. The radiant is where a ballistic inbound from space would sit on the sky.",
    );
  }

  if (heading != null && Number.isFinite(heading)) {
    const az = wrap360(heading + 180);
    const el = (contact.altitudeM ?? 0) > 8000 ? 22 : 12;
    return pack(
      contact,
      az,
      el,
      "reverse-track",
      "No vertical rate. Incoming azimuth is 180° from heading; elevation assumed from altitude.",
    );
  }

  const az = 180;
  const el = 90;
  return pack(
    contact,
    az,
    el,
    "zenith",
    "No heading on file. Radiant defaults to local zenith — the sky directly above the plot — not a reconstructed launch path.",
  );
}

export function formatRa(hours: number) {
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function formatDec(deg: number) {
  const sign = deg >= 0 ? "+" : "−";
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  return `${sign}${d}° ${String(m).padStart(2, "0")}'`;
}
