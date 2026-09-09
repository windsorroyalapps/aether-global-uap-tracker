import type { Aircraft, Balloon, Contact, Hypothesis, SatelliteTrack } from "./types";
import { haversineKm } from "./geo";

/** Bass Strait plus the Tasman basin between SE Australia and NZ. */
export function inTasmanBasin(lat: number, lng: number) {
  return lat < -24 && lat > -48 && lng > 141 && lng < 174;
}

export function overOpenWater(lat: number, lng: number) {
  if (inTasmanBasin(lat, lng)) {
    const overTasmania = lat < -40.5 && lat > -43.8 && lng > 144.5 && lng < 148.5;
    const overNz = lng > 166 && lat < -34 && lat > -47;
    const overAusCoast = lng < 151 && lat > -38.5 && lat < -27;
    return !overTasmania && !overNz && !overAusCoast;
  }
  if (lat < -60) return true;
  return false;
}

/** Non-ballistic residual: heading change vs speed, or hover-then-sprint. */
export function kinematicJerk(c: Pick<Contact, "speedKts" | "verticalFpm" | "headingDeg" | "altitudeM">) {
  const reasons: string[] = [];
  let score = 0;
  const gs = c.speedKts ?? 0;
  const vz = Math.abs(c.verticalFpm ?? 0);
  if (gs < 40 && (c.altitudeM ?? 0) > 2500) {
    score += 22;
    reasons.push("loiter / near-hover at altitude");
  }
  if (gs > 400 && vz > 4000) {
    score += 18;
    reasons.push("high speed with extreme vertical");
  }
  if (vz > 8000) {
    score += 24;
    reasons.push("vertical rate beyond civil airframes");
  }
  if (c.headingDeg != null && vz > 5000 && gs > 200) {
    score += 10;
    reasons.push("tracked heading plus non-ballistic energy");
  }
  return { score, reasons };
}

/** Water-crossing / USO-style residual. */
export function transmediumScore(c: Pick<Contact, "lat" | "lng" | "altitudeM" | "verticalFpm" | "shape">) {
  if (!overOpenWater(c.lat, c.lng)) return { score: 0, reasons: [] as string[] };
  const reasons = ["open-water plot (Tasman / Southern Ocean box)"];
  let score = 10;
  const alt = c.altitudeM ?? 800;
  if (alt < 400) {
    score += 16;
    reasons.push("near-surface over water");
  }
  if ((c.verticalFpm ?? 0) < -2500 && alt < 1200) {
    score += 14;
    reasons.push("descending toward sea");
  }
  if (c.shape === "orb" || c.shape === "tic-tac") {
    score += 8;
    reasons.push("shape often reported in transmedium cases");
  }
  return { score, reasons };
}

/** High speed near the surface without a matching airframe envelope. */
export function draglessEnergy(c: Pick<Contact, "speedKts" | "altitudeM">) {
  const gs = c.speedKts ?? 0;
  const alt = c.altitudeM ?? 0;
  const reasons: string[] = [];
  let score = 0;
  if (gs > 250 && alt > 0 && alt < 600) {
    score += 20;
    reasons.push("high speed below 600 m — drag envelope unmatched");
  }
  if (gs > 600 && alt < 3000) {
    score += 16;
    reasons.push("supersonic-class speed at low/medium altitude");
  }
  return { score, reasons };
}

/** Long-lived luminous source vs a single-flash flare. */
export function persistentLuminous(c: Pick<Contact, "shape" | "durationSec">) {
  if ((c.shape !== "orb" && c.shape !== "lights") || !c.durationSec || c.durationSec < 90) {
    return { score: 0, reasons: [] as string[] };
  }
  return {
    score: c.durationSec > 600 ? 14 : 8,
    reasons: [`luminous source held ${c.durationSec}s — not a single-flash flare`],
  };
}

/** Empty ADS-B / balloon / sat box raises residual instead of discarding the plot. */
export function coincidenceGap(opts: {
  aircraft: Aircraft[];
  balloons: Balloon[];
  satellites: SatelliteTrack[];
  lat: number;
  lng: number;
}): Hypothesis[] {
  const air = opts.aircraft.filter((a) => haversineKm(a.lat, a.lng, opts.lat, opts.lng) < 40);
  const out: Hypothesis[] = [];
  if (air.length === 0) {
    out.push({
      label: "No ADS-B in 40 km",
      weight: 8,
      note: "Empty transponder box. Not proof of an anomaly — many aircraft are dark — but it is retained.",
    });
  }
  if (opts.balloons.length === 0 && opts.satellites.every((s) => (s.el ?? 0) < 15)) {
    out.push({
      label: "Thin prosaic sky",
      weight: 6,
      note: "No nearby radiosonde and no bright satellite above 15°. Residual stands.",
    });
  }
  return out;
}

export const RETAIN_HYPOTHESIS = new Set([
  "Optical follow-up available",
  "Insufficient prosaic correlators",
  "No ADS-B in 40 km",
  "Thin prosaic sky",
  "Transmedium / maritime residual",
  "Kinematic jerk residual",
  "Dragless / low-alt energy",
  "Persistent luminous",
  "Tasman basin watch box",
  "Dark IFF over water",
  "Periodic luminous pulse",
  "Pacing / formation residual",
  "Optical stare available",
  "IR/visual dual-band",
  "Aviation conflict residual",
  "Low over populated",
  "Public generating station watch",
  "Emergency squawk nearby",
  "Dark in dense airspace",
]);

export function detectionNotes(c: Contact): string[] {
  const notes = [
    ...kinematicJerk(c).reasons,
    ...transmediumScore(c).reasons,
    ...draglessEnergy(c).reasons,
    ...persistentLuminous(c).reasons,
    ...transponderDarkWater(c).reasons,
    ...periodicBeacon(c).reasons,
    ...thermalVisualSplit(c).reasons,
  ];
  if (inTasmanBasin(c.lat, c.lng)) notes.push("Tasman basin watch box");
  for (const r of c.reasons ?? []) {
    if (/aviation conflict/i.test(r) && !notes.includes(r)) notes.push(r);
  }
  return notes;
}

/** Dark (no-call / no-squawk) plot over open water — retained, not discarded. */
export function transponderDarkWater(c: Pick<Contact, "lat" | "lng" | "source" | "summary">) {
  if (!overOpenWater(c.lat, c.lng)) return { score: 0, reasons: [] as string[] };
  const dark = /no.call|no callsign|null squawk|icao /i.test(c.summary) || c.source === "sensor";
  if (!dark) return { score: 6, reasons: ["open-water plot with a transponder story"] };
  return {
    score: 16,
    reasons: ["dark or unnamed track over water — empty IFF box retained"],
  };
}

/** Short repeating luminous pulse vs a meteor flash. */
export function periodicBeacon(c: Pick<Contact, "shape" | "durationSec">) {
  const d = c.durationSec ?? 0;
  if ((c.shape !== "lights" && c.shape !== "orb") || d < 8 || d > 40) {
    return { score: 0, reasons: [] as string[] };
  }
  return { score: 11, reasons: [`${d}s luminous pulse — longer than a meteor, shorter than a hover`] };
}

/** Two residuals sharing heading and box — pacing / formation. */
export function formationPacing(list: Contact[], c: Contact) {
  const mates = list.filter((o) => {
    if (o.id === c.id) return false;
    const d = haversineKm(o.lat, o.lng, c.lat, c.lng);
    if (d < 2 || d > 80) return false;
    if (c.headingDeg == null || o.headingDeg == null) return d < 18;
    const dh = Math.abs(((c.headingDeg - o.headingDeg + 540) % 360) - 180);
    return dh < 18;
  });
  if (mates.length === 0) return { score: 0, reasons: [] as string[] };
  return {
    score: Math.min(18, 8 + mates.length * 4),
    reasons: [`${mates.length} nearby residual${mates.length > 1 ? "s" : ""} on similar heading — pacing retained`],
  };
}

/** EO mosaic available is a detection, not a reason to drop the plot. */
export function opticalStare(cameraCount: number) {
  if (cameraCount < 1) {
    return { score: 0, reasons: [] as string[], hypotheses: [] as { label: string; weight: number; note: string }[] };
  }
  return {
    score: Math.min(14, 4 + cameraCount),
    reasons: [`${cameraCount} public optic${cameraCount === 1 ? "" : "s"} in LOS`],
    hypotheses: [
      {
        label: "Optical stare available",
        weight: Math.min(16, 6 + cameraCount),
        note: `${cameraCount} camera${cameraCount === 1 ? "" : "s"} could see this plot. Frames are evidence, not a veto.`,
      },
    ],
  };
}

/** IR vs visual disagreement from live optics. */
export function thermalVisualSplit(c: Pick<Contact, "liveVerdict">) {
  const spec = c.liveVerdict?.spectra ?? [];
  if (!spec.includes("infrared") || spec.filter((s) => s !== "infrared").length === 0) {
    return { score: 0, reasons: [] as string[] };
  }
  return {
    score: 12,
    reasons: ["IR and visual frames both present — dual-band residual kept"],
  };
}

/** Unnamed track inside a busy transponder picture — residual, not discarded. */
export function darkInDenseAirspace(c: Pick<Contact, "summary" | "source">, nearbyAir: number) {
  const dark = /no.call|no callsign|null squawk|icao /i.test(c.summary) || c.source === "sensor";
  if (!dark || nearbyAir < 8) return { score: 0, reasons: [] as string[] };
  return {
    score: 14,
    reasons: [`dark track inside ${nearbyAir} ADS-B returns — empty IFF in dense airspace retained`],
  };
}
