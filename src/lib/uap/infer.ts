import type {
  Aircraft,
  Balloon,
  Contact,
  Hypothesis,
  SatelliteTrack,
  SkyBody,
  SpaceWeather,
  WeatherSnap,
} from "./types";
import { haversineKm, hashId, regionOf } from "./geo";

const HELI = /^(H\d|EC\d|B06|B407|B429|A109|A139|S76|R44|R66|AS3|UH|AH-|CH-|MH-|SH-|S92|AW13)/i;

export function isHelicopter(a: Aircraft) {
  if (!a.type) return false;
  return HELI.test(a.type);
}

export function scoreAnomaly(a: Aircraft): { score: number; reasons: string[] } | null {
  if (a.altFt === null || a.altFt < 400) return null;
  const reasons: string[] = [];
  let score = 0;
  const heli = isHelicopter(a);
  if (!heli && a.altFt > 7000 && (a.gsKts ?? 999) < 45) {
    score += 38;
    reasons.push("near-stationary at altitude");
  }
  if (Math.abs(a.baroRate ?? 0) > 6500) {
    score += 28;
    reasons.push("extreme vertical rate");
  }
  if (a.callsign === "NO-CALL" && a.altFt > 28000 && (a.gsKts ?? 0) < 120) {
    score += 16;
    reasons.push("no callsign, slow high");
  }
  if (a.mil && (a.gsKts ?? 999) < 70 && a.altFt > 12000 && !heli) {
    score += 12;
    reasons.push("slow military track");
  }
  if (a.squawk === "0000" && a.altFt > 10000) {
    score += 8;
    reasons.push("null squawk");
  }
  if (a.squawk === "7700") {
    score += 22;
    reasons.push("emergency squawk 7700");
  }
  if (score < 32) return null;
  return { score: Math.min(96, score), reasons };
}

export function detectionsFromAircraft(list: Aircraft[]): Contact[] {
  const now = new Date().toISOString();
  const out: Contact[] = [];
  for (const a of list) {
    const scored = scoreAnomaly(a);
    if (!scored) continue;
    const residual = Math.min(88, scored.score + (a.callsign === "NO-CALL" ? 6 : 0));
    const classification =
      residual >= 70 ? "anomalous" : residual >= 50 ? "sensor-contact" : "unidentified";
    out.push({
      id: hashId(`adsb:${a.hex}`),
      lat: a.lat,
      lng: a.lng,
      locationLabel: a.callsign !== "NO-CALL" ? a.callsign : `ICAO ${a.hex.slice(0, 6)}`,
      region: regionOf(a.lat, a.lng),
      occurredAt: now,
      shape: "unknown",
      durationSec: null,
      summary: `Live ADS-B residual. ${a.type ?? "Unknown type"} at ${a.altFt ?? "?"} ft, ${a.gsKts ?? "?"} kts, vertical ${a.baroRate ?? 0} fpm. ${scored.reasons.join("; ")}. Not identified as a scheduled airliner track.`,
      classification,
      confidence: residual,
      source: "adsb",
      createdAt: now,
      live: true,
      stream: "ADS-B (adsb.lol)",
      altitudeM: a.altFt ? a.altFt * 0.3048 : null,
      speedKts: a.gsKts,
      headingDeg: a.track,
      verticalFpm: a.baroRate,
      residual,
      reasons: scored.reasons,
    });
  }
  return out;
}

export function buildHypotheses(input: {
  contact: Pick<Contact, "source" | "classification" | "altitudeM" | "speedKts" | "reasons" | "shape">;
  aircraft: Aircraft[];
  balloons: Balloon[];
  satellites: SatelliteTrack[];
  sky: SkyBody[];
  issDistKm: number | null;
  weather: WeatherSnap | null;
  spaceWeather: SpaceWeather;
  cameraCount: number;
  lat: number;
}): Hypothesis[] {
  const h: Hypothesis[] = [];
  const nearbyAir = input.aircraft.filter((a) => (a.altFt ?? 0) > 200);
  if (input.contact.source === "fireball") {
    h.push({ label: "Bolide / meteor", weight: 78, note: "CNEOS energy and velocity match atmospheric entry." });
  }
  if (input.contact.source === "balloon") {
    h.push({
      label: "Radiosonde / weather balloon",
      weight: 86,
      note: "Direct SondeHub telemetry on this plot.",
    });
  }
  const overhead = input.satellites.filter((s) => (s.el ?? 0) >= 25);
  if (overhead.length > 0) {
    const top = overhead[0];
    h.push({
      label: "Bright satellite",
      weight: Math.min(72, 28 + (top.el ?? 0)),
      note: `${top.name} at ${Math.round(top.el ?? 0)}° elevation, ${Math.round(top.rangeKm ?? 0)} km slant range.`,
    });
  }
  if (input.issDistKm !== null && input.issDistKm < 1800) {
    h.push({
      label: "ISS / bright satellite",
      weight: Math.max(12, 70 - input.issDistKm / 40),
      note: `Station footprint ~${Math.round(input.issDistKm)} km from the plot.`,
    });
  }
  const venus = input.sky.find((b) => b.name === "Venus" && b.el > 8);
  if (venus && (input.contact.shape === "orb" || input.contact.shape === "lights" || input.contact.shape === "unknown")) {
    h.push({
      label: "Venus",
      weight: Math.min(64, 20 + venus.el),
      note: `Venus at ${venus.el.toFixed(0)}° elevation, azimuth ${venus.az.toFixed(0)}°. Classic slow-orb misidentification.`,
    });
  }
  const moon = input.sky.find((b) => b.name === "Moon" && b.el > 5);
  if (moon && input.contact.shape === "orb") {
    h.push({
      label: "Moon / lunar glare",
      weight: 24,
      note: `Moon at ${moon.el.toFixed(0)}° elevation.`,
    });
  }
  if (input.balloons.length > 0) {
    const b = input.balloons[0];
    h.push({
      label: "Weather balloon",
      weight: Math.min(70, 30 + input.balloons.length * 8),
      note: `${input.balloons.length} radiosonde${input.balloons.length > 1 ? "s" : ""} in the box — ${b.name} at ${(b.altM / 1000).toFixed(1)} km.`,
    });
  }
  if (nearbyAir.length >= 8) {
    h.push({
      label: "Misidentified air traffic",
      weight: Math.min(62, 20 + nearbyAir.length * 2),
      note: `${nearbyAir.length} ADS-B tracks inside the watch box.`,
    });
  }
  if ((input.weather?.cloudCover ?? 0) > 75) {
    h.push({
      label: "Cloud / lighting artifact",
      weight: 28,
      note: `Cloud cover ${input.weather?.cloudCover}%.`,
    });
  }
  if (input.spaceWeather.kp >= 5 && input.lat > 48) {
    h.push({
      label: "Aurora / space-weather sensor noise",
      weight: 22 + input.spaceWeather.kp * 4,
      note: input.spaceWeather.kpLabel,
    });
  } else if (input.spaceWeather.kp >= 5) {
    h.push({
      label: "Aurora / space-weather sensor noise",
      weight: 16,
      note: input.spaceWeather.kpLabel,
    });
  }
  const heli = nearbyAir.filter(isHelicopter).length;
  if (heli > 0 && (input.contact.speedKts ?? 99) < 80) {
    h.push({ label: "Helicopter / rotorcraft", weight: 34, note: `${heli} rotorcraft in the box.` });
  }
  if (input.contact.source === "social") {
    h.push({ label: "Unverified media report", weight: 55, note: "No sensor correlator attached." });
  }
  if (input.cameraCount > 0) {
    h.push({
      label: "Optical follow-up available",
      weight: 8,
      note: `${input.cameraCount} public cameras with a possible view.`,
    });
  }
  if (h.length === 0) {
    h.push({
      label: "Insufficient prosaic correlators",
      weight: 20,
      note: "Residual remains after ADS-B, satellites, balloons, weather, and space-weather checks.",
    });
  }
  h.sort((a, b) => b.weight - a.weight);
  return h.slice(0, 6);
}

export function residualScore(hypotheses: Hypothesis[], base = 62) {
  const explained = hypotheses
    .filter(
      (h) =>
        h.label !== "Optical follow-up available" && h.label !== "Insufficient prosaic correlators",
    )
    .reduce((a, h) => a + h.weight, 0);
  return Math.max(8, Math.min(96, Math.round(base - explained * 0.35)));
}

/** Residual chance this plot is still a UAP after prosaic correlators. */
export function uapProbability(c: Pick<Contact, "classification" | "confidence" | "residual">) {
  if (c.classification === "likely-prosaic") return Math.min(c.residual ?? c.confidence, 35);
  const raw = c.residual ?? c.confidence;
  return Math.max(0, Math.min(99, Math.round(raw)));
}

export function isUapCandidate(c: Pick<Contact, "classification" | "confidence" | "residual">) {
  return uapProbability(c) > 50;
}

export function dedupeContacts(list: Contact[]) {
  const seen = new Set<number>();
  const out: Contact[] = [];
  for (const c of list) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

export function nearestAircraft(list: Aircraft[], lat: number, lng: number, limit = 12) {
  return [...list]
    .map((a) => ({ a, d: haversineKm(a.lat, a.lng, lat, lng) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, limit)
    .map((x) => x.a);
}
