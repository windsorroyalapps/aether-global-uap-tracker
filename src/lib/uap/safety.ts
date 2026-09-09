import { CITIES } from "./cities";
import { overOpenWater } from "./detect";
import { angularDiff, haversineKm } from "./geo";
import type { Aircraft, Contact, SafetyNote, SatelliteTrack, WeatherSnap } from "./types";

/** Public civilian airports — approach correlator and aviation-safety box. */
export const AIRPORTS: { id: string; name: string; lat: number; lng: number }[] = [
  { id: "LAX", name: "Los Angeles", lat: 33.94, lng: -118.41 },
  { id: "JFK", name: "New York JFK", lat: 40.64, lng: -73.78 },
  { id: "LHR", name: "London Heathrow", lat: 51.47, lng: -0.46 },
  { id: "HND", name: "Tokyo Haneda", lat: 35.55, lng: 139.78 },
  { id: "SYD", name: "Sydney", lat: -33.95, lng: 151.18 },
  { id: "ORD", name: "Chicago O'Hare", lat: 41.98, lng: -87.91 },
  { id: "FRA", name: "Frankfurt", lat: 50.03, lng: 8.57 },
  { id: "DXB", name: "Dubai", lat: 25.25, lng: 55.36 },
  { id: "SIN", name: "Singapore", lat: 1.36, lng: 103.99 },
  { id: "GRU", name: "Sao Paulo", lat: -23.43, lng: -46.47 },
  { id: "HNL", name: "Honolulu", lat: 21.32, lng: -157.92 },
  { id: "SEA", name: "Seattle", lat: 47.45, lng: -122.31 },
  { id: "MIA", name: "Miami", lat: 25.8, lng: -80.29 },
  { id: "DEN", name: "Denver", lat: 39.86, lng: -104.67 },
  { id: "IAD", name: "Washington Dulles", lat: 38.95, lng: -77.46 },
  { id: "LAS", name: "Las Vegas", lat: 36.08, lng: -115.15 },
  { id: "YVR", name: "Vancouver", lat: 49.19, lng: -123.18 },
  { id: "MEL", name: "Melbourne", lat: -37.67, lng: 144.84 },
  { id: "AKL", name: "Auckland", lat: -37.01, lng: 174.79 },
  { id: "CHC", name: "Christchurch", lat: -43.49, lng: 172.53 },
  { id: "ATL", name: "Atlanta", lat: 33.64, lng: -84.43 },
  { id: "SFO", name: "San Francisco", lat: 37.62, lng: -122.38 },
  { id: "PHX", name: "Phoenix", lat: 33.43, lng: -112.01 },
  { id: "MEX", name: "Mexico City", lat: 19.44, lng: -99.07 },
  { id: "CDG", name: "Paris CDG", lat: 49.01, lng: 2.55 },
];

/** Publicly mapped civilian generating stations — inform, never a targeting list. */
const PLANTS: { name: string; lat: number; lng: number }[] = [
  { name: "Diablo Canyon", lat: 35.211, lng: -120.855 },
  { name: "Palo Verde", lat: 33.388, lng: -112.861 },
  { name: "Vogtle", lat: 33.143, lng: -81.762 },
  { name: "Pickering", lat: 43.812, lng: -79.066 },
  { name: "Bruce", lat: 44.327, lng: -81.599 },
  { name: "Sizewell", lat: 52.215, lng: 1.62 },
  { name: "Gravelines", lat: 51.015, lng: 2.135 },
  { name: "Koeberg", lat: -33.676, lng: 18.431 },
  { name: "Kashiwazaki-Kariwa", lat: 37.428, lng: 138.601 },
  { name: "Hanul", lat: 37.093, lng: 129.383 },
  { name: "Qinshan", lat: 30.436, lng: 120.957 },
  { name: "Kudankulam", lat: 8.168, lng: 77.712 },
  { name: "Barakah", lat: 23.968, lng: 52.28 },
  { name: "Angra", lat: -23.008, lng: -44.458 },
  { name: "Heysham", lat: 54.029, lng: -2.916 },
];

export function nearestAirport(lat: number, lng: number) {
  let best = { id: "", name: "", km: Infinity };
  for (const a of AIRPORTS) {
    const km = haversineKm(lat, lng, a.lat, a.lng);
    if (km < best.km) best = { id: a.id, name: a.name, km };
  }
  return best.km < 80 ? best : null;
}

export function onAirportApproach(a: Pick<Aircraft, "lat" | "lng" | "altFt" | "gsKts" | "baroRate">) {
  const ap = nearestAirport(a.lat, a.lng);
  if (!ap || ap.km > 22) return false;
  const alt = a.altFt ?? 99_000;
  const gs = a.gsKts ?? 0;
  const sink = (a.baroRate ?? 0) < -200;
  return alt < 9000 && gs < 280 && (sink || alt < 4000);
}

export function nearestPlant(lat: number, lng: number) {
  let best = { name: "", km: Infinity };
  for (const p of PLANTS) {
    const km = haversineKm(lat, lng, p.lat, p.lng);
    if (km < best.km) best = { name: p.name, km };
  }
  return best.km <= 80 ? best : null;
}

export function nearestCity(lat: number, lng: number) {
  let best = { name: "", km: Infinity };
  for (const c of CITIES) {
    const km = haversineKm(lat, lng, c.lat, c.lng);
    if (km < best.km) best = { name: c.name, km };
  }
  return best.km <= 40 ? best : null;
}

export function aviationCpa(
  c: Pick<Contact, "lat" | "lng" | "altitudeM" | "locationLabel">,
  aircraft: Aircraft[],
) {
  let best: { callsign: string; km: number; dAltM: number } | null = null;
  const alt = c.altitudeM ?? null;
  for (const a of aircraft) {
    if (a.callsign && c.locationLabel && a.callsign === c.locationLabel) continue;
    const km = haversineKm(c.lat, c.lng, a.lat, a.lng);
    if (km > 12) continue;
    const aAlt = a.altFt != null ? a.altFt * 0.3048 : null;
    const dAlt = alt != null && aAlt != null ? Math.abs(alt - aAlt) : 400;
    if (dAlt > 900) continue;
    if (!best || km < best.km) best = { callsign: a.callsign, km, dAltM: dAlt };
  }
  return best;
}

export function azimuthMatch(
  headingDeg: number | null | undefined,
  bodies: { name: string; az: number; el: number }[],
  minEl = 12,
  maxDiff = 14,
) {
  if (headingDeg == null) return null;
  let hit: { name: string; el: number; diff: number } | null = null;
  for (const b of bodies) {
    if (b.el < minEl) continue;
    const diff = angularDiff(headingDeg, b.az);
    if (diff > maxDiff) continue;
    if (!hit || diff < hit.diff) hit = { name: b.name, el: b.el, diff };
  }
  return hit;
}

export function starlinkTrain(satellites: SatelliteTrack[]) {
  const train = satellites.filter((s) => /STARLINK/i.test(s.name) && (s.el ?? 0) >= 15);
  return train.length >= 3 ? train : [];
}

export function buildSafetyNotes(input: {
  contact: Pick<Contact, "lat" | "lng" | "altitudeM" | "speedKts" | "locationLabel" | "shape">;
  aircraft: Aircraft[];
  weather: WeatherSnap | null;
}): SafetyNote[] {
  const out: SafetyNote[] = [];
  const cpa = aviationCpa(input.contact, input.aircraft);
  if (cpa) {
    out.push({
      level: cpa.km < 5 ? "elevated" : "watch",
      label: "Aviation conflict box",
      note: `${cpa.callsign} ${cpa.km.toFixed(1)} km / ${Math.round(cpa.dAltM)} m vertical. Stay clear — this is a traffic problem first.`,
    });
  }
  const emer = input.aircraft.filter((a) => a.squawk === "7700" || a.squawk === "7600" || a.squawk === "7500");
  for (const a of emer.slice(0, 2)) {
    const km = haversineKm(input.contact.lat, input.contact.lng, a.lat, a.lng);
    if (km > 60) continue;
    out.push({
      level: "elevated",
      label: `Emergency squawk ${a.squawk}`,
      note: `${a.callsign} ${km.toFixed(0)} km away. Correlator: distress traffic, not a UAP by default.`,
    });
  }
  const city = nearestCity(input.contact.lat, input.contact.lng);
  const alt = input.contact.altitudeM ?? 2000;
  if (city && alt < 400 && !overOpenWater(input.contact.lat, input.contact.lng)) {
    out.push({
      level: "watch",
      label: "Low over populated",
      note: `${Math.round(alt)} m AGL near ${city.name} (${city.km.toFixed(0)} km). Inform, do not intercept.`,
    });
  }
  const plant = nearestPlant(input.contact.lat, input.contact.lng);
  if (plant) {
    out.push({
      level: "watch",
      label: "Public generating station",
      note: `${plant.name} ${plant.km.toFixed(0)} km — publicly mapped civilian site. Watch box only; do not approach.`,
    });
  }
  if (overOpenWater(input.contact.lat, input.contact.lng) && alt < 250) {
    out.push({
      level: "watch",
      label: "Near-surface over water",
      note: "Maritime residual. Surface craft have right of way; this is not a chase cue.",
    });
  }
  if (input.weather?.thunder) {
    out.push({
      level: "info",
      label: "Thunderstorm",
      note: "Lightning / sprite / cloud illumination is the first prosaic read.",
    });
  }
  return out.slice(0, 5);
}

export function uavEnvelope(c: Pick<Contact, "altitudeM" | "speedKts" | "lat" | "lng" | "verticalFpm">) {
  const alt = c.altitudeM ?? 9999;
  const gs = c.speedKts ?? 999;
  const vz = Math.abs(c.verticalFpm ?? 0);
  if (overOpenWater(c.lat, c.lng)) return { score: 0, reasons: [] as string[] };
  if (alt < 150 && gs < 70 && vz < 2500) {
    return { score: 48, reasons: ["low/slow inland — sUAS / drone envelope"] };
  }
  return { score: 0, reasons: [] as string[] };
}
