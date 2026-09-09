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
import { coincidenceGap, draglessEnergy, formationPacing, kinematicJerk, opticalStare, periodicBeacon, persistentLuminous, RETAIN_HYPOTHESIS, thermalVisualSplit, transmediumScore, transponderDarkWater, darkInDenseAirspace } from "./detect";
import { haversineKm, hashId, regionOf } from "./geo";
import { aviationCpa, azimuthMatch, nearestAirport, nearestPlant, onAirportApproach, starlinkTrain, uavEnvelope } from "./safety";

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
  if (a.squawk === "7600") {
    score += 14;
    reasons.push("radio-fail squawk 7600");
  }
  if (onAirportApproach(a) && a.squawk !== "7700" && Math.abs(a.baroRate ?? 0) < 8000) {
    return null;
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
    const tm = transmediumScore({
      lat: a.lat,
      lng: a.lng,
      altitudeM: a.altFt ? a.altFt * 0.3048 : null,
      verticalFpm: a.baroRate,
      shape: "unknown",
    });
    const jerk = kinematicJerk({
      speedKts: a.gsKts,
      verticalFpm: a.baroRate,
      headingDeg: a.track,
      altitudeM: a.altFt ? a.altFt * 0.3048 : null,
    });
    const drag = draglessEnergy({
      speedKts: a.gsKts,
      altitudeM: a.altFt ? a.altFt * 0.3048 : null,
    });
    const residual = Math.min(
      88,
      scored.score +
        (a.callsign === "NO-CALL" ? 6 : 0) +
        Math.round(tm.score / 4) +
        Math.round(jerk.score / 5) +
        Math.round(drag.score / 5),
    );
    const classification =
      residual >= 70 ? "anomalous" : residual >= 50 ? "sensor-contact" : "unidentified";
    const altM = a.altFt ? a.altFt * 0.3048 : null;
    const cpa = aviationCpa(
      { lat: a.lat, lng: a.lng, altitudeM: altM, locationLabel: a.callsign },
      list.filter((x) => x.hex !== a.hex),
    );
    const safetyBits = cpa
      ? [`aviation conflict ${cpa.callsign} ${cpa.km.toFixed(1)} km`]
      : [];
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
      residual: Math.min(92, residual + (cpa ? 6 : 0)),
      reasons: [...scored.reasons, ...tm.reasons, ...jerk.reasons, ...drag.reasons, ...safetyBits],
    });
  }
  for (const c of out) {
    const pace = formationPacing(out, c);
    if (pace.score > 0) {
      c.reasons = [...(c.reasons ?? []), ...pace.reasons];
      c.residual = Math.min(92, (c.residual ?? 0) + pace.score);
    }
  }
  return out;
}

export function buildHypotheses(input: {
  contact: Pick<
    Contact,
    "source" | "classification" | "altitudeM" | "speedKts" | "reasons" | "shape" | "durationSec" | "summary" | "liveVerdict" | "headingDeg" | "verticalFpm" | "locationLabel"
  >;
  aircraft: Aircraft[];
  balloons: Balloon[];
  satellites: SatelliteTrack[];
  sky: SkyBody[];
  issDistKm: number | null;
  weather: WeatherSnap | null;
  spaceWeather: SpaceWeather;
  cameraCount: number;
  lat: number;
  lng?: number;
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
  h.push(
    ...coincidenceGap({
      aircraft: input.aircraft,
      balloons: input.balloons,
      satellites: input.satellites,
      lat: input.lat,
      lng: input.lng ?? 0,
    }),
  );
  const tm = transmediumScore({
    lat: input.lat,
    lng: input.lng ?? 0,
    altitudeM: input.contact.altitudeM,
    verticalFpm: null,
    shape: input.contact.shape,
  });
  if (tm.score >= 10) {
    h.push({
      label: "Transmedium / maritime residual",
      weight: Math.min(36, tm.score),
      note: tm.reasons.join("; ") + " — retained, not discarded.",
    });
  }
  const jerk = kinematicJerk({
    speedKts: input.contact.speedKts,
    verticalFpm: input.contact.verticalFpm ?? null,
    headingDeg: input.contact.headingDeg ?? null,
    altitudeM: input.contact.altitudeM,
  });
  if (jerk.score >= 18) {
    h.push({
      label: "Kinematic jerk residual",
      weight: Math.min(28, jerk.score),
      note: jerk.reasons.join("; ") + " — energy envelope retained.",
    });
  }
  const drag = draglessEnergy({
    speedKts: input.contact.speedKts,
    altitudeM: input.contact.altitudeM,
  });
  if (drag.score >= 16) {
    h.push({
      label: "Dragless / low-alt energy",
      weight: Math.min(24, drag.score),
      note: drag.reasons.join("; "),
    });
  }
  const glow = persistentLuminous({
    shape: input.contact.shape,
    durationSec: input.contact.durationSec ?? null,
  });
  if (glow.score >= 8) {
    h.push({
      label: "Persistent luminous",
      weight: glow.score,
      note: glow.reasons.join("; "),
    });
  }
  const dark = transponderDarkWater({
    lat: input.lat,
    lng: input.lng ?? 0,
    source: input.contact.source,
    summary: input.contact.summary ?? "",
  });
  if (dark.score >= 6) {
    h.push({
      label: "Dark IFF over water",
      weight: Math.min(22, dark.score),
      note: dark.reasons.join("; "),
    });
  }
  const pulse = periodicBeacon({
    shape: input.contact.shape,
    durationSec: input.contact.durationSec ?? null,
  });
  if (pulse.score >= 8) {
    h.push({
      label: "Periodic luminous pulse",
      weight: pulse.score,
      note: pulse.reasons.join("; "),
    });
  }
  h.push(...opticalStare(input.cameraCount).hypotheses);
  const ir = thermalVisualSplit({ liveVerdict: input.contact.liveVerdict });
  if (ir.score >= 8) {
    h.push({
      label: "IR/visual dual-band",
      weight: ir.score,
      note: ir.reasons.join("; "),
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

  const lng = input.lng ?? 0;
  const ap = nearestAirport(input.lat, lng);
  if (ap && ap.km < 22 && (input.contact.altitudeM ?? 2000) < 2800) {
    h.push({
      label: "Airport approach traffic",
      weight: Math.min(58, 42 - Math.round(ap.km)),
      note: `${ap.id} ${ap.name} ${ap.km.toFixed(1)} km — slow/low here is usually a landing.`,
    });
  }
  const drone = uavEnvelope({
    altitudeM: input.contact.altitudeM,
    speedKts: input.contact.speedKts,
    lat: input.lat,
    lng,
    verticalFpm: input.contact.verticalFpm ?? null,
  });
  if (drone.score >= 20) {
    h.push({
      label: "UAV / sUAS envelope",
      weight: drone.score,
      note: drone.reasons.join("; ") + " Prefer drone until kinematics break that envelope.",
    });
  }
  const train = starlinkTrain(input.satellites);
  if (train.length >= 3) {
    h.push({
      label: "Starlink train",
      weight: Math.min(74, 40 + train.length * 4),
      note: `${train.length} Starlink birds above 15°. A string of lights is usually the constellation.`,
    });
  }
  const sun = input.sky.find((b) => b.name === "Sun");
  if (sun && sun.el > 8 && (input.contact.shape === "orb" || input.contact.shape === "lights")) {
    h.push({
      label: "Sun / sundog / glare",
      weight: 32,
      note: `Sun at ${sun.el.toFixed(0)}° — daytime orbs are glare until proven otherwise.`,
    });
  }
  if (sun && sun.el > -7 && sun.el < 8) {
    const flareSats = input.satellites.filter((s) => (s.el ?? 0) >= 20);
    if (flareSats.length > 0) {
      h.push({
        label: "Twilight satellite flare",
        weight: 52,
        note: `Civil twilight with ${flareSats.length} high satellite${flareSats.length > 1 ? "s" : ""}. Classic flare window.`,
      });
    }
  }
  const jupiter = input.sky.find((b) => b.name === "Jupiter" && b.el > 18);
  if (jupiter && (input.contact.shape === "orb" || input.contact.shape === "lights")) {
    h.push({
      label: "Jupiter",
      weight: Math.min(50, 16 + jupiter.el / 2),
      note: `Jupiter at ${jupiter.el.toFixed(0)}° — bright-planet mis-id.`,
    });
  }
  const azSat = azimuthMatch(
    input.contact.headingDeg,
    input.satellites
      .filter((s) => s.az != null && (s.el ?? 0) >= 15)
      .map((s) => ({ name: s.name, az: s.az as number, el: s.el ?? 0 })),
  );
  if (azSat) {
    h.push({
      label: "Azimuth-matched satellite",
      weight: Math.min(66, 36 + azSat.el / 2),
      note: `${azSat.name} within ${azSat.diff.toFixed(0)}° of track heading.`,
    });
  }
  const azPlanet = azimuthMatch(
    input.contact.headingDeg,
    input.sky.filter((b) => b.name !== "Sun"),
    10,
    12,
  );
  if (azPlanet && (azPlanet.name === "Venus" || azPlanet.name === "Jupiter" || azPlanet.name === "Moon")) {
    h.push({
      label: `${azPlanet.name} on heading`,
      weight: 58,
      note: `Track heading matches ${azPlanet.name} (${azPlanet.diff.toFixed(0)}°).`,
    });
  }
  if (input.weather?.thunder) {
    h.push({
      label: "Thunderstorm / lightning",
      weight: 44,
      note: "WMO thunder code. Sprites, bolts, and illuminated cloud are first-pass prosaic.",
    });
  }
  if ((input.weather?.visibilityKm ?? 99) < 3) {
    h.push({
      label: "Low visibility",
      weight: 22,
      note: `Visibility ${input.weather?.visibilityKm?.toFixed(1)} km — optics degrade, lights bloom.`,
    });
  }

  const cpa = aviationCpa(
    {
      lat: input.lat,
      lng,
      altitudeM: input.contact.altitudeM,
      locationLabel: input.contact.locationLabel ?? "",
    },
    nearbyAir,
  );
  if (cpa) {
    h.push({
      label: "Aviation conflict residual",
      weight: Math.min(28, 12 + Math.round((12 - cpa.km) * 1.2)),
      note: `${cpa.callsign} ${cpa.km.toFixed(1)} km / ${Math.round(cpa.dAltM)} m vertical. Traffic conflict retained as a safety residual.`,
    });
  }
  const dense = darkInDenseAirspace(
    { summary: input.contact.summary ?? "", source: input.contact.source },
    nearbyAir.length,
  );
  if (dense.score >= 8) {
    h.push({
      label: "Dark in dense airspace",
      weight: dense.score,
      note: dense.reasons.join("; "),
    });
  }
  const plant = nearestPlant(input.lat, lng);
  if (plant) {
    h.push({
      label: "Public generating station watch",
      weight: 10,
      note: `${plant.name} ${plant.km.toFixed(0)} km. Public civilian site — inform, do not approach.`,
    });
  }
  const emer = nearbyAir.filter((a) => a.squawk === "7700" || a.squawk === "7600" || a.squawk === "7500");
  if (emer.length > 0) {
    h.push({
      label: "Emergency squawk nearby",
      weight: 12,
      note: `${emer[0].callsign} squawk ${emer[0].squawk}. Distress traffic is the correlator.`,
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
  return h.slice(0, 8);
}

export function residualScore(hypotheses: Hypothesis[], base = 62) {
  const explained = hypotheses
    .filter((h) => !RETAIN_HYPOTHESIS.has(h.label))
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
